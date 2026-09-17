import {getQuickExtension, isQuickExtensionId} from './QuickExtensionRegistry';
import {
    QUICK_EXTENSION_STATE_EVENT,
    isQuickExtensionEnabled
} from './QuickExtensionState';

const shouldShowCategory = category => {
    const id = category && category.id;
    if (!isQuickExtensionId(id)) return true;
    return Boolean(getQuickExtension(id)) && isQuickExtensionEnabled(id);
};

export const refreshQuickExtensionPalette = vm => {
    if (!vm || typeof vm.refreshWorkspace !== 'function') return;
    vm.refreshWorkspace();
};

export const installQuickExtensionPaletteFilter = vm => {
    const runtime = vm && vm.runtime;
    if (!runtime || typeof runtime.getBlocksXML !== 'function') return;

    if (!runtime.__yiyiQuickExtensionOriginalGetBlocksXML) {
        const originalGetBlocksXML = runtime.getBlocksXML.bind(runtime);
        runtime.__yiyiQuickExtensionOriginalGetBlocksXML = originalGetBlocksXML;
        runtime.getBlocksXML = target => originalGetBlocksXML(target).filter(shouldShowCategory);
    }

    if (!vm.__yiyiQuickExtensionStateListener) {
        vm.__yiyiQuickExtensionStateListener = () => refreshQuickExtensionPalette(vm);
        window.addEventListener(QUICK_EXTENSION_STATE_EVENT, vm.__yiyiQuickExtensionStateListener);
    }
};

export const removeQuickExtensionPaletteFilter = vm => {
    if (!vm) return;
    if (vm.__yiyiQuickExtensionStateListener) {
        window.removeEventListener(QUICK_EXTENSION_STATE_EVENT, vm.__yiyiQuickExtensionStateListener);
        delete vm.__yiyiQuickExtensionStateListener;
    }
};
