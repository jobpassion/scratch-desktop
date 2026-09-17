import {isQuickExtensionId} from './QuickExtensionRegistry';

const CATEGORIES = new Set(['events', 'control', 'operators', 'variables', 'myBlocks', 'esp32gpio']);
const BLOCKS = {
    events: new Set(['event_whenflagclicked']),
    control: new Set([
        'control_wait', 'control_repeat', 'control_forever',
        'control_if', 'control_if_else', 'control_repeat_until', 'control_wait_until'
    ]),
    operators: new Set([
        'operator_add', 'operator_subtract', 'operator_multiply', 'operator_divide',
        'operator_random', 'operator_gt', 'operator_lt', 'operator_equals',
        'operator_and', 'operator_or', 'operator_not', 'operator_mod',
        'operator_round', 'operator_join', 'operator_length', 'operator_contains', 'operator_letter_of'
    ]),
    esp32gpio: new Set(['esp32gpio_setOnboardLed', 'esp32gpio_setDigital', 'esp32gpio_readDigital',
        'esp32gpio_printText', 'esp32gpio_writeAnalog', 'esp32gpio_readAnalog'])
};

const filterBoardToolbox = (source, boardMode) => {
    const document = new DOMParser().parseFromString(source, 'text/xml');
    if (document.querySelector('parsererror')) throw new Error('无法读取 Scratch 积木列表。');
    const root = document.documentElement;
    Array.from(root.children).forEach(category => {
        const id = category.getAttribute('id');
        const quickCategory = isQuickExtensionId(id);
        if (!boardMode) {
            if (id === 'esp32gpio' || quickCategory) root.removeChild(category);
            return;
        }
        if (category.tagName !== 'category' || (!CATEGORIES.has(id) && !quickCategory)) {
            root.removeChild(category);
            return;
        }
        if (id === 'variables') category.setAttribute('custom', 'BOARD_VARIABLE');
        const allowed = BLOCKS[id];
        if (allowed) {
            Array.from(category.children).forEach(block => {
                if (block.tagName !== 'block' || !allowed.has(block.getAttribute('type'))) {
                    category.removeChild(block);
                }
            });
        }
    });
    return new XMLSerializer().serializeToString(document);
};

export default filterBoardToolbox;
