/* global document, navigator, window */
import {contextBridge, ipcRenderer} from 'electron';

contextBridge.exposeInMainWorld('__VELXIO_API_BASE__', `${window.location.origin}/api`);

const copyText = async text => {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        try {
            await navigator.clipboard.writeText(text);
            return;
        } catch {
            // Fall back to the legacy copy path for non-secure remote Velxio servers.
        }
    }
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.cssText = 'position:fixed;left:-10000px;top:-10000px;opacity:0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const copied = document.execCommand('copy');
    textarea.remove();
    if (!copied) throw new Error('无法写入剪贴板。');
};

const copyCircuitData = async () => {
    const content = await ipcRenderer.invoke('capture-board-simulation');
    if (!content) throw new Error('没有可复制的电路数据。');
    await copyText(content);
    return true;
};

contextBridge.exposeInMainWorld('__SCRATCH_COPY_VLX__', copyCircuitData);
