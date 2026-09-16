const hiddenActionIds = [
    'desktop-board-simulation-server-button',
    'desktop-board-simulation-import-button'
];

const moreButtonId = 'desktop-board-more-button';
const menuId = 'desktop-board-more-menu';
const iosSafeFont = '"PingFang SC", "Microsoft YaHei", "Hiragino Sans GB", sans-serif';

const closeMenu = () => {
    const menu = document.getElementById(menuId);
    if (menu) menu.remove();
    const button = document.getElementById(moreButtonId);
    if (button) button.setAttribute('aria-expanded', 'false');
};

const positionMenu = (button, menu) => {
    const rect = button.getBoundingClientRect();
    const width = 188;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    menu.style.left = `${left}px`;
    menu.style.top = `${rect.bottom + 6}px`;
};

const makeMenuItem = (sourceButton, label) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.textContent = label;
    item.disabled = Boolean(sourceButton && sourceButton.disabled);
    Object.assign(item.style, {
        display: 'block',
        width: '100%',
        border: '0',
        borderRadius: '6px',
        padding: '10px 12px',
        background: 'transparent',
        color: '#222',
        fontFamily: iosSafeFont,
        fontSize: '14px',
        fontWeight: '600',
        textAlign: 'left',
        whiteSpace: 'nowrap',
        cursor: item.disabled ? 'default' : 'pointer',
        opacity: item.disabled ? '0.5' : '1'
    });
    item.addEventListener('click', () => {
        if (item.disabled || !sourceButton) return;
        closeMenu();
        sourceButton.click();
    });
    item.addEventListener('mouseenter', () => {
        if (!item.disabled) item.style.background = '#f3f4f6';
    });
    item.addEventListener('mouseleave', () => {
        item.style.background = 'transparent';
    });
    return item;
};

const openMenu = button => {
    closeMenu();

    const serverButton = document.getElementById('desktop-board-simulation-server-button');
    const importButton = document.getElementById('desktop-board-simulation-import-button');
    if (!serverButton && !importButton) return;

    const menu = document.createElement('div');
    menu.id = menuId;
    menu.setAttribute('role', 'menu');
    Object.assign(menu.style, {
        position: 'fixed',
        zIndex: '100000',
        width: '188px',
        padding: '6px',
        borderRadius: '10px',
        background: '#fff',
        boxShadow: '0 6px 24px rgba(0, 0, 0, 0.22)',
        boxSizing: 'border-box'
    });

    if (serverButton) menu.appendChild(makeMenuItem(serverButton, '仿真服务设置'));
    if (importButton) menu.appendChild(makeMenuItem(importButton, '导入电路'));

    document.body.appendChild(menu);
    positionMenu(button, menu);
    button.setAttribute('aria-expanded', 'true');
};

const ensureMoreButton = () => {
    const programmingButton = document.getElementById('desktop-board-programming-button');
    const serverButton = document.getElementById('desktop-board-simulation-server-button');
    const importButton = document.getElementById('desktop-board-simulation-import-button');
    const titleRowContainer = programmingButton && programmingButton.parentElement;

    hiddenActionIds.forEach(id => {
        const action = document.getElementById(id);
        if (action) action.style.setProperty('display', 'none', 'important');
    });

    let moreButton = document.getElementById(moreButtonId);
    if (!titleRowContainer || (!serverButton && !importButton)) {
        if (moreButton) moreButton.remove();
        closeMenu();
        return;
    }

    if (!moreButton) {
        moreButton = document.createElement('button');
        moreButton.id = moreButtonId;
        moreButton.type = 'button';
        moreButton.textContent = '更多 ▾';
        moreButton.setAttribute('aria-haspopup', 'menu');
        moreButton.setAttribute('aria-expanded', 'false');
        moreButton.addEventListener('click', event => {
            event.stopPropagation();
            const isOpen = moreButton.getAttribute('aria-expanded') === 'true';
            if (isOpen) closeMenu();
            else openMenu(moreButton);
        });
    }

    Object.assign(moreButton.style, {
        flexShrink: '0',
        border: '0',
        borderRadius: '8px',
        height: '40px',
        padding: '0 12px',
        backgroundColor: '#0c956f',
        color: '#fff',
        fontFamily: iosSafeFont,
        fontWeight: '700',
        fontSize: '14px',
        whiteSpace: 'nowrap',
        cursor: 'pointer'
    });

    if (moreButton.parentElement !== titleRowContainer) {
        titleRowContainer.appendChild(moreButton);
    }
};

const startBoardControlsDropdown = () => {
    ensureMoreButton();

    const observer = new MutationObserver(ensureMoreButton);
    observer.observe(document.documentElement, {
        childList: true,
        subtree: true
    });

    window.setInterval(ensureMoreButton, 500);

    document.addEventListener('click', event => {
        const button = document.getElementById(moreButtonId);
        const menu = document.getElementById(menuId);
        if (!menu) return;
        if (menu.contains(event.target) || (button && button.contains(event.target))) return;
        closeMenu();
    }, true);

    window.addEventListener('resize', closeMenu);
    window.addEventListener('blur', closeMenu);
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startBoardControlsDropdown, {once: true});
} else {
    startBoardControlsDropdown();
}
