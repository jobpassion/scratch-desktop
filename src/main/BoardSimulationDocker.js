import {execFile} from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {promisify} from 'util';

const runFile = promisify(execFile);
const IMAGE = 'davidmonterocrespo/velxio:master';
const OLD_IMAGE = 'ghcr.io/davidmonterocrespo24/velxio:master';
const CONTAINER = 'scratch-desktop-velxio';
const URL = 'http://127.0.0.1:3080';
const dockerPaths = [
    '/usr/local/bin/docker',
    '/opt/homebrew/bin/docker',
    path.join(os.homedir(), '.docker/bin/docker')
];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

const getDocker = () => {
    const docker = dockerPaths.find(candidate => fs.existsSync(candidate));
    if (!docker) throw new Error('请先安装 Docker Desktop，然后再试一次。');
    return docker;
};

const command = async (docker, args, timeout = 30000) => {
    try {
        const {stdout} = await runFile(docker, args, {timeout, maxBuffer: 8 * 1024 * 1024});
        return stdout.trim();
    } catch (error) {
        throw new Error((error.stderr || error.message || '').trim());
    }
};

const waitForDocker = async docker => {
    try {
        await command(docker, ['info'], 10000);
        return;
    } catch (error) {
        if (!fs.existsSync('/Applications/Docker.app')) {
            throw new Error('Docker Desktop 未运行，请启动后重试。');
        }
        await runFile('/usr/bin/open', ['-gj', '-a', 'Docker'], {timeout: 10000});
    }
    for (let attempt = 0; attempt < 45; attempt++) {
        await delay(2000);
        try {
            await command(docker, ['info'], 10000);
            return;
        } catch (error) {
            // Docker Desktop is still starting.
        }
    }
    throw new Error('Docker Desktop 启动超时，请确认它已正常运行。');
};

const waitForService = async docker => {
    for (let attempt = 0; attempt < 360; attempt++) {
        try {
            const response = await fetch(`${URL}/health`, {signal: AbortSignal.timeout(2000)});
            if (response.ok) return URL;
        } catch (error) {
            // The container is still starting.
        }
        if (attempt % 6 === 5) {
            const running = await command(docker, ['inspect', '--format', '{{.State.Running}}', CONTAINER]);
            if (running !== 'true') {
                throw new Error('Velxio 容器启动失败，请在 Docker Desktop 中查看容器日志。');
            }
        }
        await delay(5000);
    }
    throw new Error('Velxio 首次初始化超过 30 分钟，请在 Docker Desktop 中查看容器日志。');
};

const startBoardSimulationDocker = async (onStatus = () => {}) => {
    if (process.platform !== 'darwin') throw new Error('本机仿真目前只支持 macOS。');
    const docker = getDocker();
    onStatus('正在检查 Docker Desktop…');
    await waitForDocker(docker);
    const existing = await command(docker, ['ps', '-a', '--filter', `name=^/${CONTAINER}$`,
        '--format', '{{.Names}}']);
    let createContainer = !existing;
    let imagePulled = false;
    if (existing) {
        const image = await command(docker, ['inspect', '--format', '{{.Config.Image}}', CONTAINER]);
        if (image === OLD_IMAGE) {
            onStatus('正在从 Docker Hub 下载 Velxio 镜像…');
            await command(docker, ['pull', IMAGE], 15 * 60 * 1000);
            imagePulled = true;
            onStatus('正在切换 Velxio 容器…');
            await command(docker, ['rm', '-f', CONTAINER], 60000);
            createContainer = true;
        } else if (image === IMAGE) {
            const bindings = JSON.parse(await command(docker, [
                'inspect', '--format', '{{json .HostConfig.PortBindings}}', CONTAINER
            ]));
            const port = (bindings['80/tcp'] || [])[0];
            if (!port || port.HostIp !== '0.0.0.0' || port.HostPort !== '3080') {
                onStatus('正在开放 Velxio 局域网访问…');
                await command(docker, ['rm', '-f', CONTAINER], 60000);
                createContainer = true;
                imagePulled = true;
            } else {
                const running = await command(docker, ['inspect', '--format', '{{.State.Running}}', CONTAINER]);
                if (running !== 'true') {
                    onStatus('正在启动 Velxio…');
                    await command(docker, ['start', CONTAINER], 60000);
                }
            }
        } else {
            throw new Error('同名 Docker 容器不是 Velxio，请检查后重试。');
        }
    }
    if (createContainer) {
        if (!existing) onStatus('正在从 Docker Hub 下载 Velxio 镜像…');
        if (!imagePulled) await command(docker, ['pull', IMAGE], 15 * 60 * 1000);
        onStatus('正在创建 Velxio 容器…');
        await command(docker, ['run', '-d', '--name', CONTAINER,
            '-p', '0.0.0.0:3080:80',
            '-v', 'scratch-velxio-data:/app/data',
            '-v', 'scratch-velxio-arduino:/root/.arduino15',
            '-v', 'scratch-velxio-libraries:/root/Arduino',
            '-v', 'scratch-velxio-ccache:/var/cache/ccache',
            '-v', 'scratch-velxio-build:/var/lib/velxio-build', IMAGE], 60000);
    }
    onStatus('正在初始化仿真服务，首次启动需下载板卡工具…');
    return waitForService(docker);
};

export default startBoardSimulationDocker;
