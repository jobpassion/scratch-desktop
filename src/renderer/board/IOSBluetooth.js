import NativeBridge from '../ios/NativeBridge';

const BOARD_PRINT_PREFIX = '__YY_PRINT__';

const formatOutputTime = date => {
    const pad = (value, length = 2) => String(value).padStart(length, '0');
    return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.` +
        `${pad(date.getMilliseconds(), 3)}`;
};

const sha256Hex = async bytes => {
    const digest = await window.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest))
        .map(value => value.toString(16).padStart(2, '0'))
        .join('');
};

class IOSBluetooth {
    constructor () {
        this.isConnected = false;
        this.hasAuthorized = false;
        this.received = '';
        this.waiters = [];
        this.rawMode = false;
        this.onOutput = null;
        this.outputBuffer = '';
        this.decoder = new TextDecoder();
        this.unsubscribeNotification = NativeBridge.on('bluetoothNotification', payload => {
            this.onNotification(payload);
        });
        this.unsubscribeState = NativeBridge.on('bluetoothState', payload => {
            this.isConnected = Boolean(payload && payload.connected);
            if (!this.isConnected) {
                this.outputBuffer = '';
            }
        });
    }

    get connected () {
        return this.isConnected;
    }

    get canAutoReconnect () {
        return this.hasAuthorized;
    }

    dispose () {
        if (this.unsubscribeNotification) this.unsubscribeNotification();
        if (this.unsubscribeState) this.unsubscribeState();
    }

    onNotification (payload) {
        if (!payload || !payload.data) return;
        const bytes = NativeBridge.base64ToBytes(payload.data);
        const chunk = this.decoder.decode(bytes, {stream: true});
        if (this.rawMode) {
            this.received += chunk;
            this.waiters.forEach(waiter => waiter());
        } else if (chunk) {
            this.handleProgramOutput(chunk);
        }
    }

    handleProgramOutput (chunk) {
        this.outputBuffer += chunk;
        let newline = this.outputBuffer.indexOf('\n');
        while (newline >= 0) {
            let line = this.outputBuffer.slice(0, newline);
            this.outputBuffer = this.outputBuffer.slice(newline + 1);
            if (line.endsWith('\r')) line = line.slice(0, -1);
            if (line.startsWith(BOARD_PRINT_PREFIX) && this.onOutput) {
                const time = formatOutputTime(new Date());
                this.onOutput(`[${time}] ${line.slice(BOARD_PRINT_PREFIX.length)}\n`);
            }
            newline = this.outputBuffer.indexOf('\n');
        }
    }

    async connect (requestPermission = false) {
        if (this.connected) return;
        await NativeBridge.call('bluetoothConnect', {requestPermission});
        this.isConnected = true;
        this.hasAuthorized = true;
        await this.primeConnection();
    }

    async primeConnection () {
        try {
            await this.writeBytes(new Uint8Array(0));
        } catch (error) {
            await this.writeBytes(new Uint8Array([13]));
        }
    }

    async refreshConnection () {
        await NativeBridge.call('bluetoothDisconnect');
        this.isConnected = false;
        await this.connect(true);
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

    async writeBytes (bytes) {
        await NativeBridge.call('bluetoothWrite', {
            data: NativeBridge.bytesToBase64(bytes)
        });
    }

    async write (text) {
        const bytes = new TextEncoder().encode(text);
        for (let offset = 0; offset < bytes.length; offset += 20) {
            await this.writeBytes(bytes.slice(offset, offset + 20));
        }
    }

    async enterRawREPL () {
        this.rawMode = true;
        this.received = '';
        this.outputBuffer = '';
        try {
            await this.write('\r\x03\x03\r\x01');
        } catch (error) {
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
        const checksum = await sha256Hex(bytes);
        let rawReady = false;
        try {
            onProgress(0, '准备发送');
            await this.enterRawREPL();
            rawReady = true;
            await this.execRaw('import ubinascii, os, hashlib');
            await this.execRaw("_board_file = open('main.py.tmp', 'wb')");
            for (let offset = 0; offset < bytes.length; offset += 36) {
                const chunk = bytes.slice(offset, offset + 36);
                const encoded = NativeBridge.bytesToBase64(chunk);
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
                }
                try {
                    await this.execRaw(
                        "if 'main.py' not in os.listdir() and 'main.py.bak' in os.listdir(): " +
                        "os.rename('main.py.bak', 'main.py')"
                    );
                } catch (ignored) {
                }
            }
            throw error;
        } finally {
            try {
                if (this.connected) await this.write('\x02');
            } finally {
                this.rawMode = false;
                this.received = '';
                this.outputBuffer = '';
            }
        }
        await this.write('\x04');
        await NativeBridge.call('bluetoothDisconnect');
        this.isConnected = false;
        onProgress(100, '已启动');
    }
}

export default IOSBluetooth;
