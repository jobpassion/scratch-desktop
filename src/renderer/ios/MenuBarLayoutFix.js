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
