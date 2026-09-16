import NativeBridge from './NativeBridge';

const channelSubscriptions = new Map();

const decodeProjectResult = result => {
    if (!result || !result.data) return undefined;
    return NativeBridge.base64ToBytes(result.data);
};

const invoke = async (channel, payload = {}) => {
    switch (channel) {
    case 'get-initial-project-data':
        return decodeProjectResult(await NativeBridge.call('getInitialProjectData'));
    case 'quick-save-project': {
        const bytes = await NativeBridge.projectDataToBytes(payload.projectData);
        return NativeBridge.call('quickSaveProject', {
            data: NativeBridge.bytesToBase64(bytes),
            title: payload.projectTitle || '未命名作品'
        });
    }
    case 'speak-block-text':
        return NativeBridge.call('speakText', payload);
    case 'capture-board-simulation': {
        const result = await NativeBridge.call('captureSimulation');
        return result && result.content ? result.content : null;
    }
    case 'close-board-simulation':
        return NativeBridge.call('closeSimulation');
    case 'open-board-simulation':
        if (!payload.serverUrl) {
            throw new Error('iPad 不支持本机 Docker 仿真，请先配置局域网或公网 Velxio 服务器。');
        }
        return NativeBridge.call('openSimulation', payload);
    case 'getTelemetryDidOptIn':
        return false;
    default:
        console.debug(`[iOS electron shim] ignored invoke: ${channel}`);
        return undefined;
    }
};

const send = (channel, payload) => {
    switch (channel) {
    case 'open-about-window':
        NativeBridge.call('openAbout').catch(console.error);
        break;
    case 'open-privacy-policy-window':
        NativeBridge.call('openPrivacy').catch(console.error);
        break;
    case 'setTelemetryDidOptIn':
        break;
    default:
        console.debug(`[iOS electron shim] ignored send: ${channel}`, payload);
    }
};

const eventNameForChannel = channel => {
    switch (channel) {
    case 'board-simulation-snapshot':
        return 'boardSimulationSnapshot';
    case 'board-simulation-status':
        return 'boardSimulationStatus';
    case 'enter-board-programming':
        return 'enterBoardProgramming';
    case 'setTitleFromSave':
        return 'setTitleFromSave';
    case 'board-bluetooth-debug':
        return 'boardBluetoothDebug';
    default:
        return null;
    }
};

const on = (channel, handler) => {
    const eventName = eventNameForChannel(channel);
    if (!eventName) return ipcRenderer;
    const unsubscribe = NativeBridge.on(eventName, payload => {
        if (channel === 'board-simulation-snapshot') {
            handler({}, payload && payload.content ? payload.content : payload, false);
        } else if (channel === 'board-simulation-status') {
            handler({}, payload && payload.status ? payload.status : payload);
        } else {
            handler({}, payload);
        }
    });
    let handlers = channelSubscriptions.get(channel);
    if (!handlers) {
        handlers = new Map();
        channelSubscriptions.set(channel, handlers);
    }
    handlers.set(handler, unsubscribe);
    return ipcRenderer;
};

const removeListener = (channel, handler) => {
    const handlers = channelSubscriptions.get(channel);
    if (!handlers) return ipcRenderer;
    const unsubscribe = handlers.get(handler);
    if (unsubscribe) unsubscribe();
    handlers.delete(handler);
    if (!handlers.size) channelSubscriptions.delete(channel);
    return ipcRenderer;
};

export const ipcRenderer = {
    invoke,
    send,
    sendSync: channel => channel === 'getTelemetryDidOptIn' ? false : undefined,
    on,
    removeListener
};

export const remote = {
    getCurrentWindow: () => null,
    dialog: {
        showMessageBox: (_window, options = {}) => NativeBridge.call('showError', {
            title: options.title || '提示',
            message: options.message || '',
            detail: options.detail || ''
        })
    }
};

export default {
    ipcRenderer,
    remote
};
