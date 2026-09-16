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
        titleRowContainer.style.setProperty('overflow', 'visible', 'important');
        titleRowContainer.style.setProperty('flex-wrap', 'nowrap', 'important');
        // The measured iPad layout fits once Debug is removed, the Tutorial group
        // is allowed to shrink, and the visible gaps use 3px. Do not make the
        // whole Scratch menu bar a scroll container: its File/Edit/Settings menus
        // are absolutely positioned below this row and must be able to overflow it.
        titleRowContainer.style.setProperty('column-gap', '3px', 'important');
        titleRowContainer.style.setProperty('touch-action', 'auto', 'important');
    }

    // Scratch keeps the shared Tutorial/Debug group at an inline 64px width even
    // after Debug is hidden. Tutorial itself measures 56px, so let the group size
    // to its remaining visible child and recover the otherwise unused 8px.
    const tutorialButton = document.querySelector('[aria-label="教程"]');
    const tutorialGroup = tutorialButton && tutorialButton.parentElement;
    if (tutorialGroup && titleRowContainer && titleRowContainer.contains(tutorialGroup)) {
        tutorialGroup.style.setProperty('width', 'auto', 'important');
        tutorialGroup.style.setProperty('min-width', '0', 'important');
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
