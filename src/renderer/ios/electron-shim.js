import NativeBridge from './NativeBridge';

const channelSubscriptions = new Map();
const boardModeStorageKey = 'yiyi-board-programming-mode';

const decodeProjectResult = result => {
    if (!result || !result.data) return undefined;
    return NativeBridge.base64ToBytes(result.data);
};

const readStoredBoardMode = () => {
    try {
        const value = window.localStorage.getItem(boardModeStorageKey);
        if (value === 'board') return true;
        if (value === 'normal') return false;
    } catch (error) {
        console.warn('[iOS] failed to read board programming mode', error);
    }
    return null;
};

const writeStoredBoardMode = boardMode => {
    try {
        window.localStorage.setItem(boardModeStorageKey, boardMode ? 'board' : 'normal');
    } catch (error) {
        console.warn('[iOS] failed to save board programming mode', error);
    }
};

const getBoardModeFromButton = button => Boolean(button) &&
    (button.textContent || '').trim().includes('返回普通编程');

const restoreBoardProgrammingMode = () => {
    const preferredBoardMode = readStoredBoardMode();
    if (preferredBoardMode === null) return;

    const button = document.getElementById('desktop-board-programming-button');
    if (!button) return;

    const currentBoardMode = getBoardModeFromButton(button);
    if (currentBoardMode !== preferredBoardMode) {
        button.click();
    }
};

const scheduleBoardProgrammingModeRestore = () => {
    [0, 250, 750].forEach(delay => {
        window.setTimeout(restoreBoardProgrammingMode, delay);
    });
};

if (typeof document !== 'undefined') {
    document.addEventListener('click', event => {
        const target = event.target && event.target.closest ?
            event.target.closest('#desktop-board-programming-button') : null;
        if (!target) return;

        // The shared Scratch HOC toggles boardMode synchronously in its click
        // handler. Read the button on the next tick so the persisted value is the
        // resulting mode, not the mode before the click.
        window.setTimeout(() => {
            const button = document.getElementById('desktop-board-programming-button');
            if (button) {
                writeStoredBoardMode(getBoardModeFromButton(button));
            }
        }, 0);
    }, true);

    // Fallback for startup paths which do not emit projectDidLoad.
    window.setTimeout(scheduleBoardProgrammingModeRestore, 1000);
}

const invoke = async (channel, payload = {}) => {
    switch (channel) {
    case 'get-initial-project-data':
        return decodeProjectResult(await NativeBridge.call('getInitialProjectData'));
    case 'quick-save-project': {
        const bytes = await NativeBridge.projectDataToBytes(payload.projectData);
        const createNewProject = Boolean(window.__YYCreateNewProjectPending);

        if (createNewProject) {
            await NativeBridge.call('clearCurrentProject');
        }

        const result = await NativeBridge.call('quickSaveProject', {
            data: NativeBridge.bytesToBase64(bytes),
            title: payload.projectTitle || '未命名作品'
        });

        if (createNewProject) {
            window.__YYCreateNewProjectPending = false;
        }
        return result;
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
            throw new Error('iOS 不支持本机 Docker 仿真，请先配置局域网或公网 Velxio 服务器。');
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
    case 'projectWasCreated':
        // This event is emitted by Scratch after a real New-project transition.
        // The iOS save path must treat the next save as a brand-new document so
        // the previously opened .sb3 is never overwritten or renamed away.
        window.__YYCreateNewProjectPending = true;
        NativeBridge.call('clearCurrentProject').catch(error => {
            console.error('[iOS] failed to clear current project after projectWasCreated', error);
        });
        break;
    case 'projectDidLoad':
        // Loading a project can change boardMode based on its block contents in
        // the shared desktop HOC. Re-apply the user's last UI mode after loading.
        scheduleBoardProgrammingModeRestore();
        break;
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

const hasOwn = (value, key) => Boolean(value) &&
    Object.prototype.hasOwnProperty.call(value, key);

const on = (channel, handler) => {
    const eventName = eventNameForChannel(channel);
    if (!eventName) return ipcRenderer;
    const unsubscribe = NativeBridge.on(eventName, payload => {
        if (channel === 'board-simulation-snapshot') {
            handler({}, hasOwn(payload, 'content') ? payload.content : payload, false);
        } else if (channel === 'board-simulation-status') {
            handler({}, hasOwn(payload, 'status') ? payload.status : payload);
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
