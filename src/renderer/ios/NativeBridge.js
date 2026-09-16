const pending = new Map();
const listeners = new Map();
let nextId = 1;

const getHandler = () => window.webkit &&
    window.webkit.messageHandlers &&
    window.webkit.messageHandlers.yiyiBridge;

const emit = (name, payload) => {
    const handlers = listeners.get(name);
    if (!handlers) return;
    [...handlers].forEach(handler => {
        try {
            handler(payload);
        } catch (error) {
            console.error(`[iOS bridge] event handler failed: ${name}`, error);
        }
    });
};

window.__YYNativeBridgeResolve = (id, success, payload) => {
    const request = pending.get(id);
    if (!request) return;
    pending.delete(id);
    if (success) {
        request.resolve(payload);
    } else {
        const message = payload && payload.message ? payload.message : String(payload || 'Native call failed');
        request.reject(new Error(message));
    }
};

window.__YYNativeBridgeEvent = (name, payload) => {
    emit(name, payload);
};

const call = (method, params = {}) => new Promise((resolve, reject) => {
    const handler = getHandler();
    if (!handler) {
        reject(new Error(`iOS native bridge unavailable: ${method}`));
        return;
    }
    const id = nextId++;
    pending.set(id, {resolve, reject});
    try {
        handler.postMessage({id, method, params});
    } catch (error) {
        pending.delete(id);
        reject(error);
    }
});

const on = (name, handler) => {
    let handlers = listeners.get(name);
    if (!handlers) {
        handlers = new Set();
        listeners.set(name, handlers);
    }
    handlers.add(handler);
    return () => {
        handlers.delete(handler);
        if (!handlers.size) listeners.delete(name);
    };
};

const bytesToBase64 = bytes => {
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let binary = '';
    const chunkSize = 0x8000;
    for (let offset = 0; offset < view.length; offset += chunkSize) {
        const chunk = view.subarray(offset, Math.min(offset + chunkSize, view.length));
        binary += String.fromCharCode.apply(null, chunk);
    }
    return btoa(binary);
};

const base64ToBytes = base64 => {
    const binary = atob(base64 || '');
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) {
        bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
};

const projectDataToBytes = async projectData => {
    if (projectData instanceof Uint8Array) return projectData;
    if (ArrayBuffer.isView(projectData)) {
        return new Uint8Array(projectData.buffer, projectData.byteOffset, projectData.byteLength);
    }
    if (projectData instanceof ArrayBuffer) return new Uint8Array(projectData);
    if (projectData && typeof projectData.arrayBuffer === 'function') {
        return new Uint8Array(await projectData.arrayBuffer());
    }
    throw new Error('Unsupported project data type.');
};

export default {
    call,
    on,
    bytesToBase64,
    base64ToBytes,
    projectDataToBytes
};
