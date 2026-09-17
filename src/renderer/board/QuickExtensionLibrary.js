import extensionLibraryContent from '@scratch/scratch-gui/src/lib/libraries/extensions/index.jsx';

import {loadQuickExtensions} from './QuickExtensionRegistry';

const QUICK_LIBRARY_MARKER = '__yiyiQuickExtension';

export const syncQuickExtensionsToLibrary = () => {
    for (let index = extensionLibraryContent.length - 1; index >= 0; index--) {
        if (extensionLibraryContent[index][QUICK_LIBRARY_MARKER]) {
            extensionLibraryContent.splice(index, 1);
        }
    }
    const cards = loadQuickExtensions().map(config => {
        const card = {
            name: config.name,
            extensionId: config.id,
            description: config.description,
            collaborator: '一一编程乐园快捷扩展',
            featured: true,
            [QUICK_LIBRARY_MARKER]: true
        };
        if (config.iconURL) {
            card.iconURL = config.iconURL;
            card.insetIconURL = config.iconURL;
        }
        return card;
    });
    if (cards.length) extensionLibraryContent.splice(0, 0, ...cards);
};

export default syncQuickExtensionsToLibrary;
