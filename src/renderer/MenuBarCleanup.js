const hideDebugMenuItem = () => {
    const menuBars = document.querySelectorAll('[class*="menu-bar_menu-bar_"]');
    for (const menuBar of menuBars) {
        const exactDebugItems = menuBar.querySelectorAll('[aria-label="Debug"]');
        exactDebugItems.forEach(item => {
            item.style.setProperty('display', 'none', 'important');
            item.setAttribute('aria-hidden', 'true');
        });

        const candidates = menuBar.querySelectorAll(
            '[class*="menu-bar_menu-bar-item_"], [class*="menu-bar_hoverable_"], button, [role="button"]'
        );
        for (const candidate of candidates) {
            if ((candidate.textContent || '').trim() !== 'Debug') continue;
            candidate.style.setProperty('display', 'none', 'important');
            candidate.setAttribute('aria-hidden', 'true');
        }
    }
};

let refreshScheduled = false;
const scheduleRefresh = () => {
    if (refreshScheduled) return;
    refreshScheduled = true;
    window.requestAnimationFrame(() => {
        refreshScheduled = false;
        hideDebugMenuItem();
    });
};

const startMenuBarCleanup = () => {
    hideDebugMenuItem();
    const observer = new MutationObserver(scheduleRefresh);
    observer.observe(document.documentElement, {
        childList: true,
        subtree: true
    });
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startMenuBarCleanup, {once: true});
} else {
    startMenuBarCleanup();
}
