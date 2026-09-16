import NativeBridge from './NativeBridge';

const isScratchProjectInput = target => target &&
    target.tagName === 'INPUT' &&
    target.type === 'file' &&
    target.files &&
    target.files.length > 0;

const rememberScratchProject = async file => {
    if (!file || !file.name || !file.name.toLowerCase().endsWith('.sb3')) return;
    const handler = window.webkit &&
        window.webkit.messageHandlers &&
        window.webkit.messageHandlers.yiyiFileBridge;
    if (!handler) return;
    try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        handler.postMessage({
            data: NativeBridge.bytesToBase64(bytes),
            filename: file.name
        });
    } catch (error) {
        console.warn('[iOS files] failed to remember opened project:', error);
    }
};

document.addEventListener('change', event => {
    const target = event.target;
    if (!isScratchProjectInput(target)) return;
    rememberScratchProject(target.files[0]);
}, true);
