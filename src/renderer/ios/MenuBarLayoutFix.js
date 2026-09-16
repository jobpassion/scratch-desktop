const applyTitleFieldWidth = () => {
    const titleInput = document.querySelector('div[class*="menu-bar_menu-bar"] input');
    if (!titleInput || !titleInput.parentElement) return;

    const container = titleInput.parentElement;
    container.style.setProperty('min-width', '110px', 'important');
    titleInput.style.setProperty('width', '100%', 'important');
    titleInput.style.setProperty('min-width', '0', 'important');
};

const startMenuBarLayoutFix = () => {
    applyTitleFieldWidth();

    const observer = new MutationObserver(applyTitleFieldWidth);
    observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style']
    });

    window.setInterval(applyTitleFieldWidth, 500);
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startMenuBarLayoutFix, {once: true});
} else {
    startMenuBarLayoutFix();
}
