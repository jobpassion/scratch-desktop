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

const installCopyButton = () => {
    if (!document.body || document.getElementById('scratch-copy-vlx-button')) return;
    const button = document.createElement('button');
    button.id = 'scratch-copy-vlx-button';
    button.type = 'button';
    button.textContent = '复制电路数据';
    button.title = '复制完整 .vlx 电路数据，方便粘贴给 AI';
    button.style.cssText = [
        'position:fixed',
        'top:14px',
        'right:16px',
        'z-index:2147483647',
        'height:34px',
        'padding:0 14px',
        'border:1px solid rgba(255,255,255,.28)',
        'border-radius:7px',
        'background:#2563eb',
        'color:#fff',
        'font-size:13px',
        'font-weight:600',
        'cursor:pointer',
        'box-shadow:0 2px 8px rgba(0,0,0,.22)'
    ].join(';');
    button.addEventListener('click', async () => {
        if (button.disabled) return;
        const originalText = '复制电路数据';
        button.disabled = true;
        button.textContent = '复制中…';
        button.style.opacity = '0.75';
        try {
            const content = await ipcRenderer.invoke('capture-board-simulation');
            if (!content) throw new Error('没有可复制的电路数据。');
            await copyText(content);
            button.textContent = '已复制';
        } catch (error) {
            console.error('[Velxio] 复制电路数据失败', error);
            button.textContent = '复制失败';
        } finally {
            window.setTimeout(() => {
                button.disabled = false;
                button.textContent = originalText;
                button.style.opacity = '1';
            }, 1500);
        }
    });
    document.body.appendChild(button);
};

if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', installCopyButton, {once: true});
} else {
    installCopyButton();
}
