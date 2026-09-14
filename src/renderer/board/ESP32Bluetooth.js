import {createHash} from 'crypto';
import {ipcRenderer} from 'electron';

ipcRenderer.on('board-bluetooth-debug', (_event, message) => {
    console.info(`[ESP32 蓝牙] ${message}`);
});

const SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const RX = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
const TX = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';

class ESP32Bluetooth {
    constructor () {
        this.device = null;
        this.rx = null;
        this.tx = null;
        this.received = '';
        this.waiters = [];
        this.rawMode = false;
        this.onOutput = null;
        this.decoder = new TextDecoder();
        this.onNotification = this.onNotification.bind(this);
    }

    get connected () {
        return Boolean(this.device && this.device.gatt.connected && this.rx);
    }

    get canAutoReconnect () {
        return Boolean(this.device || (navigator.bluetooth && navigator.bluetooth.getDevices));
    }

    onNotification (event) {
        const chunk = this.decoder.decode(event.target.value, {stream: true});
        if (this.rawMode) {
            this.received += chunk;
            this.waiters.forEach(waiter => waiter());
        } else if (this.onOutput && chunk) {
            this.onOutput(chunk);
        }
    }

    async connect (requestPermission = false) {
        if (this.connected) return;
        if (!navigator.bluetooth) throw new Error('当前应用无法使用蓝牙。');
        if (requestPermission) {
            let selected;
            const startedAt = Date.now();
            console.info('[ESP32 蓝牙] 开始请求设备');
            try {
                selected = await navigator.bluetooth.requestDevice({
                    acceptAllDevices: true,
                    optionalServices: [SERVICE]
                });
            } catch (error) {
                console.info(`[ESP32 蓝牙] 设备请求失败：${Date.now() - startedAt} ms，` +
                    `${error.name}：${error.message}`);
                if (error.name === 'NotFoundError' && error.message.includes('requestDevice() chooser')) {
                    throw new Error('蓝牙设备选择未完成，请确认开发板正在广播后重试。');
                }
                throw error;
            }
            console.info(`[ESP32 蓝牙] 已选择 ${selected.name || '未命名设备'}，开始连接`);
            await this.connectDevice(selected);
            return;
        }
        const isBoard = device => device.name && (
            device.name.startsWith('YY-Board') || device.name.startsWith('MPY ESP32')
        );
        const known = navigator.bluetooth.getDevices ? await navigator.bluetooth.getDevices() : [];
        const devices = [this.device, ...known].filter(device => device && isBoard(device));
        let lastError;
        for (const device of devices) {
            try {
                await this.connectDevice(device);
                return;
            } catch (error) {
                lastError = error;
            }
        }
        throw lastError || new Error('请点击“立即连接”授权开发板。');
    }

    async connectDevice (device) {
        try {
            const server = await device.gatt.connect();
            const service = await server.getPrimaryService(SERVICE);
            const rx = await service.getCharacteristic(RX);
            const tx = await service.getCharacteristic(TX);
            await tx.startNotifications();
            tx.addEventListener('characteristicvaluechanged', this.onNotification);
            this.device = device;
            this.rx = rx;
            this.tx = tx;
        } catch (error) {
            device.gatt.disconnect();
            throw new Error(`连接开发板失败：${error.message}`);
        }
    }

    async refreshConnection () {
        const device = this.device;
        if (!device) throw new Error('请先连接 ESP32。');
        if (this.tx) this.tx.removeEventListener('characteristicvaluechanged', this.onNotification);
        this.rx = null;
        this.tx = null;
        if (device.gatt.connected) device.gatt.disconnect();
        await this.connectDevice(device);
    }

    waitFor (marker, timeout = 10000) {
        const matches = typeof marker === 'function' ? marker : received => received.includes(marker);
        if (matches(this.received)) return Promise.resolve(this.received);
        return new Promise((resolve, reject) => {
            const pending = {timer: null};
            const check = () => {
                if (matches(this.received)) {
                    clearTimeout(pending.timer);
                    this.waiters = this.waiters.filter(waiter => waiter !== check);
                    resolve(this.received);
                }
            };
            this.waiters.push(check);
            pending.timer = setTimeout(() => {
                this.waiters = this.waiters.filter(waiter => waiter !== check);
                reject(new Error('等待开发板回应超时，请检查蓝牙连接和固件。'));
            }, timeout);
        });
    }

    async write (text) {
        const bytes = new TextEncoder().encode(text);
        for (let offset = 0; offset < bytes.length; offset += 20) {
            await this.rx.writeValue(bytes.slice(offset, offset + 20));
        }
    }

    async enterRawREPL () {
        this.rawMode = true;
        this.received = '';
        try {
            await this.write('\r\x03\x03\r\x01');
        } catch (error) {
            if (!/GATT Service no longer exists/i.test(error.message)) throw error;
            await this.refreshConnection();
            this.received = '';
            await this.write('\r\x03\x03\r\x01');
        }
        await this.waitFor('raw REPL; CTRL-B to exit\r\n>');
    }

    async execRaw (code) {
        this.received = '';
        await this.write(`${code}\x04`);
        const output = await this.waitFor(received => {
            const start = received.indexOf('OK');
            if (start < 0) return false;
            const stdoutEnd = received.indexOf('\x04', start + 2);
            const stderrEnd = received.indexOf('\x04', stdoutEnd + 1);
            return stdoutEnd >= 0 && stderrEnd >= 0 && received.indexOf('>', stderrEnd + 1) >= 0;
        });
        const start = output.indexOf('OK') + 2;
        const stdoutEnd = output.indexOf('\x04', start);
        const stderrEnd = output.indexOf('\x04', stdoutEnd + 1);
        const error = output.slice(stdoutEnd + 1, stderrEnd).trim();
        if (error) throw new Error(`开发板执行失败：${error}`);
        return output.slice(start, stdoutEnd);
    }

    async uploadMain (source, onProgress = () => {}) {
        if (!this.connected) throw new Error('请先连接 ESP32。');
        const bytes = new TextEncoder().encode(source);
        const checksum = createHash('sha256')
            .update(Buffer.from(bytes))
            .digest('hex');
        let rawReady = false;
        try {
            onProgress(0, '准备发送');
            await this.enterRawREPL();
            rawReady = true;
            await this.execRaw('import ubinascii, os, hashlib');
            await this.execRaw("_board_file = open('main.py.tmp', 'wb')");
            for (let offset = 0; offset < bytes.length; offset += 36) {
                const chunk = bytes.slice(offset, offset + 36);
                const encoded = btoa(String.fromCharCode(...chunk));
                await this.execRaw(`_board_file.write(ubinascii.a2b_base64('${encoded}'))`);
                onProgress(Math.round(5 + (((offset + chunk.length) / bytes.length) * 75)), '写入程序');
            }
            await this.execRaw('_board_file.close()');
            onProgress(85, '校验文件');
            const size = await this.execRaw("print(os.stat('main.py.tmp')[6])");
            if (Number(size.trim()) !== bytes.length) throw new Error('开发板上的文件大小校验失败。');
            const remoteHash = await this.execRaw(
                "_hash = hashlib.sha256(); _check = open('main.py.tmp', 'rb')\n" +
                'while True:\n' +
                '    _part = _check.read(512)\n' +
                '    if not _part: break\n' +
                '    _hash.update(_part)\n' +
                '_check.close()\n' +
                'print(ubinascii.hexlify(_hash.digest()).decode())'
            );
            if (remoteHash.trim() !== checksum) throw new Error('开发板上的文件内容校验失败。');
            await this.execRaw("if 'main.py.bak' in os.listdir(): os.remove('main.py.bak')");
            await this.execRaw("if 'main.py' in os.listdir(): os.rename('main.py', 'main.py.bak')");
            await this.execRaw("os.rename('main.py.tmp', 'main.py')");
            onProgress(95, '重启开发板');
        } catch (error) {
            if (rawReady) {
                try {
                    await this.execRaw("if '_board_file' in globals(): _board_file.close()");
                } catch (ignored) {
                    // Keep the original upload error.
                }
                try {
                    await this.execRaw(
                        "if 'main.py' not in os.listdir() and 'main.py.bak' in os.listdir(): " +
                        "os.rename('main.py.bak', 'main.py')"
                    );
                } catch (ignored) {
                    // Keep the original upload error.
                }
            }
            throw error;
        } finally {
            try {
                if (this.connected) await this.write('\x02');
            } finally {
                this.rawMode = false;
                this.received = '';
            }
        }
        await this.write('\x04');
        this.device.gatt.disconnect();
        onProgress(100, '已启动');
    }
}

export default ESP32Bluetooth;
