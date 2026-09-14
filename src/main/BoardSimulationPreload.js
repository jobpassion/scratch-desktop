/* global document, MutationObserver, navigator, window */
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
};

const findMenuRow = label => {
    const elements = document.querySelectorAll('body *');
    for (const element of elements) {
        if ((element.textContent || '').trim() !== label) continue;
        let best = element;
        let bestWidth = element.getBoundingClientRect().width;
        let node = element.parentElement;
        for (let depth = 0; node && depth < 4; depth++, node = node.parentElement) {
            if ((node.textContent || '').trim() !== label) break;
            const rect = node.getBoundingClientRect();
            if (rect.height >= 24 && rect.height <= 72 && rect.width >= bestWidth) {
                best = node;
                bestWidth = rect.width;
            }
        }
        return best;
    }
    return null;
};

const replaceMenuLabel = (row, oldLabel, newLabel) => {
    const descendants = row.querySelectorAll('*');
    for (const element of descendants) {
        if (element.children.length === 0 && (element.textContent || '').trim() === oldLabel) {
            element.textContent = newLabel;
            return element;
        }
    }
    row.textContent = newLabel;
    return row;
};

const installCopyMenuItem = () => {
    if (!document.body || document.getElementById('scratch-copy-vlx-menu-item')) return;
    const exportItem = findMenuRow('Export project (.vlx)');
    if (!exportItem || !exportItem.parentElement) return;

    const item = exportItem.cloneNode(true);
    item.id = 'scratch-copy-vlx-menu-item';
    item.querySelectorAll('[id]').forEach(element => element.removeAttribute('id'));
    item.removeAttribute('aria-disabled');
    const labelElement = replaceMenuLabel(item, 'Export project (.vlx)', '复制电路数据');

    item.addEventListener('click', async event => {
        event.preventDefault();
        event.stopPropagation();
        if (item.dataset.copying === 'true') return;
        item.dataset.copying = 'true';
        const originalLabel = '复制电路数据';
        labelElement.textContent = '正在复制…';
        try {
            await copyCircuitData();
            labelElement.textContent = '已复制';
        } catch (error) {
            console.error('[Velxio] 复制电路数据失败', error);
            labelElement.textContent = '复制失败';
        } finally {
            window.setTimeout(() => {
                item.dataset.copying = 'false';
                labelElement.textContent = originalLabel;
            }, 1200);
        }
    });

    exportItem.insertAdjacentElement('afterend', item);
};

const observer = new MutationObserver(installCopyMenuItem);

const startMenuInjection = () => {
    installCopyMenuItem();
    observer.observe(document.body, {childList: true, subtree: true});
};

if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', startMenuInjection, {once: true});
} else {
    startMenuInjection();
}
