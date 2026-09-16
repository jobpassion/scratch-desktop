const dynamicControlIds = [
    'desktop-quick-save-button',
    'desktop-board-programming-button',
    'desktop-board-connect-button',
    'desktop-board-upload-button',
    'desktop-board-simulation-button',
    'desktop-board-simulation-server-button',
    'desktop-board-simulation-import-button',
    'desktop-board-status',
    'desktop-quick-save-feedback'
];

const iosChineseFont = '"PingFang SC", "Hiragino Sans GB", sans-serif';

const applyFontFix = root => {
    dynamicControlIds.forEach(id => {
        const element = (root && root.id === id) ? root : document.getElementById(id);
        if (element && element.style.fontFamily !== iosChineseFont) {
            element.style.fontFamily = iosChineseFont;
        }
    });
};

const startFontFix = () => {
    applyFontFix();

    const observer = new MutationObserver(mutations => {
        let shouldRefresh = false;
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (!(node instanceof HTMLElement)) continue;
                if (dynamicControlIds.includes(node.id)) {
                    applyFontFix(node);
                    continue;
                }
                if (node.querySelector && dynamicControlIds.some(id => node.querySelector(`#${id}`))) {
                    shouldRefresh = true;
                }
            }
        }
        if (shouldRefresh) applyFontFix();
    });

    observer.observe(document.documentElement, {
        childList: true,
        subtree: true
    });
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startFontFix, {once: true});
} else {
    startFontFix();
}
