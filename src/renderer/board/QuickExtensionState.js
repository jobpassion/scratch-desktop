const DISABLED_STORAGE_KEY = 'yiyi-quick-extension-disabled-v1';

export const QUICK_EXTENSION_STATE_EVENT = 'yiyi-quick-extension-state-change';

const readDisabledIds = () => {
    try {
        const raw = window.localStorage.getItem(DISABLED_STORAGE_KEY);
        if (!raw) return new Set();
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return new Set();
        return new Set(parsed.filter(id => typeof id === 'string' && id));
    } catch (error) {
        console.warn('[quick-extension] failed to read disabled extension ids', error);
        return new Set();
    }
};

const writeDisabledIds = ids => {
    window.localStorage.setItem(DISABLED_STORAGE_KEY, JSON.stringify([...ids].sort()));
};

const notifyStateChanged = (id, enabled) => {
    window.dispatchEvent(new CustomEvent(QUICK_EXTENSION_STATE_EVENT, {
        detail: {id, enabled}
    }));
};

export const isQuickExtensionEnabled = id => !readDisabledIds().has(id);

export const setQuickExtensionEnabled = (id, enabled) => {
    const ids = readDisabledIds();
    if (enabled) ids.delete(id);
    else ids.add(id);
    writeDisabledIds(ids);
    notifyStateChanged(id, enabled);
    return enabled;
};

export const forgetQuickExtensionState = id => {
    const ids = readDisabledIds();
    if (!ids.delete(id)) return false;
    writeDisabledIds(ids);
    notifyStateChanged(id, true);
    return true;
};
