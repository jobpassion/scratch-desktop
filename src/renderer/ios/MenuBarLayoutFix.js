const compactButtonText = element => {
    if (!element) return;

    const text = (element.textContent || '').trim();
    switch (element.id) {
    case 'desktop-board-programming-button':
        if (text === '返回普通编程') {
            element.textContent = '返回';
            element.title = '返回普通编程';
        }
        break;
    case 'desktop-board-connect-button':
        if (text === '立即连接') {
            element.textContent = '连接';
            element.title = '立即连接 ESP32';
        } else if (text === 'ESP32 已连接') {
            element.textContent = '已连接';
            element.title = 'ESP32 已连接';
        }
        break;
    case 'desktop-board-upload-button':
        if (text === '连接后发送' || text === '发送到板上') {
            element.textContent = '发送';
            element.title = text;
        } else if (text.startsWith('发送中 ')) {
            element.textContent = text.replace('发送中 ', '发送 ');
            element.title = text;
        }
        break;
    case 'desktop-board-simulation-button':
        if (text === '仿真板运行') {
            element.textContent = '仿真';
            element.title = '仿真板运行';
        }
        break;
    case 'desktop-board-simulation-server-button':
        if (text === '仿真服务设置') {
            element.textContent = '仿真设置';
            element.title = '仿真服务设置';
        }
        break;
    case 'desktop-board-simulation-import-button':
        if (text === '导入电路') {
            element.textContent = '导入';
            element.title = '导入电路';
        }
        break;
    default:
        break;
    }
};

const applyMenuBarLayout = () => {
    const titleInput = document.querySelector('div[class*="menu-bar_menu-bar"] input');
    if (!titleInput || !titleInput.parentElement) return;

    const titleFieldContainer = titleInput.parentElement;
    const titleRowContainer = titleFieldContainer.parentElement;

    titleFieldContainer.style.setProperty('min-width', '110px', 'important');
    titleFieldContainer.style.setProperty('flex-shrink', '0', 'important');
    titleInput.style.setProperty('width', '100%', 'important');
    titleInput.style.setProperty('min-width', '0', 'important');

    if (titleRowContainer) {
        titleRowContainer.style.setProperty('min-width', '0', 'important');
        titleRowContainer.style.setProperty('max-width', '100%', 'important');
        titleRowContainer.style.setProperty('overflow-x', 'auto', 'important');
        titleRowContainer.style.setProperty('overflow-y', 'hidden', 'important');
        titleRowContainer.style.setProperty('flex-wrap', 'nowrap', 'important');
        titleRowContainer.style.setProperty('column-gap', '4px', 'important');
        titleRowContainer.style.setProperty('-webkit-overflow-scrolling', 'touch');
        titleRowContainer.style.setProperty('touch-action', 'pan-x', 'important');
        titleRowContainer.style.setProperty('scrollbar-width', 'none');
    }

    [
        'desktop-board-programming-button',
        'desktop-board-connect-button',
        'desktop-board-upload-button',
        'desktop-board-simulation-button',
        'desktop-board-simulation-server-button',
        'desktop-board-simulation-import-button'
    ].forEach(id => compactButtonText(document.getElementById(id)));

    // The action buttons already expose connection/upload state on iOS, so the
    // separate desktop status pill only consumes scarce horizontal space.
    const status = document.getElementById('desktop-board-status');
    if (status) {
        status.style.setProperty('display', 'none', 'important');
    }
};

const startMenuBarLayoutFix = () => {
    applyMenuBarLayout();

    const observer = new MutationObserver(applyMenuBarLayout);
    observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['style']
    });

    window.setInterval(applyMenuBarLayout, 500);
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startMenuBarLayoutFix, {once: true});
} else {
    startMenuBarLayoutFix();
}
