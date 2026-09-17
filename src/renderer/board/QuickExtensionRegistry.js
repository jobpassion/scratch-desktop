const STORAGE_KEY = 'yiyi-quick-extensions-v1';
const QUICK_EXTENSION_PREFIX = 'yyext';
const ID_PATTERN = /^yyext[a-z0-9]+$/;
const OPCODE_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;
const ARGUMENT_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const BLOCK_TYPES = new Set(['command', 'reporter', 'Boolean']);
const ARGUMENT_TYPES = new Set(['string', 'number', 'Boolean']);
const PYTHON_TYPES = new Set(['auto', 'string', 'number', 'boolean', 'raw']);

const normalizeBlockType = value => value === 'boolean' ? 'Boolean' : value;
const normalizeArgumentType = value => value === 'boolean' ? 'Boolean' : value;
const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const clone = value => JSON.parse(JSON.stringify(value));

const validateStringArray = (value, label) => {
    if (typeof value === 'undefined') return [];
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
        throw new Error(`${label} 必须是字符串数组。`);
    }
    return value.filter(item => item.trim()).map(item => item.trim());
};

const normalizeMenu = (menu, menuName) => {
    if (!isObject(menu) || !Array.isArray(menu.items) || !menu.items.length) {
        throw new Error(`菜单 ${menuName} 必须包含 items 数组。`);
    }
    return {
        acceptReporters: Boolean(menu.acceptReporters),
        items: menu.items.map(item => {
            if (typeof item === 'string' || typeof item === 'number') return String(item);
            if (!isObject(item) || typeof item.text === 'undefined' || typeof item.value === 'undefined') {
                throw new Error(`菜单 ${menuName} 中存在无效选项。`);
            }
            return {text: String(item.text), value: String(item.value)};
        })
    };
};

const normalizeArgument = (argument, blockOpcode, argumentName) => {
    if (!isObject(argument)) throw new Error(`积木 ${blockOpcode} 的参数 ${argumentName} 配置无效。`);
    const type = normalizeArgumentType(argument.type || 'string');
    if (!ARGUMENT_TYPES.has(type)) {
        throw new Error(`参数 ${argumentName} 的 type 仅支持 string、number、boolean。`);
    }
    const pythonType = argument.pythonType || 'auto';
    if (!PYTHON_TYPES.has(pythonType)) throw new Error(`参数 ${argumentName} 的 pythonType 无效。`);
    const normalized = {type, pythonType};
    if (typeof argument.menu !== 'undefined') normalized.menu = String(argument.menu);
    if (typeof argument.defaultValue !== 'undefined') normalized.defaultValue = argument.defaultValue;
    return normalized;
};

const normalizeBlock = block => {
    if (!isObject(block) || !OPCODE_PATTERN.test(String(block.opcode || ''))) {
        throw new Error('每个积木都必须提供合法 opcode。');
    }
    const opcode = String(block.opcode);
    const blockType = normalizeBlockType(block.blockType || 'command');
    if (!BLOCK_TYPES.has(blockType)) {
        throw new Error(`积木 ${opcode} 的 blockType 仅支持 command、reporter、boolean。`);
    }
    if (typeof block.text !== 'string' || !block.text.trim()) throw new Error(`积木 ${opcode} 缺少 text。`);
    if (typeof block.python !== 'string' || !block.python.trim()) throw new Error(`积木 ${opcode} 缺少 python 生成模板。`);
    const argumentsConfig = {};
    Object.entries(block.arguments || {}).forEach(([name, argument]) => {
        if (!ARGUMENT_PATTERN.test(name)) {
            throw new Error(`积木 ${opcode} 的参数名 ${name} 必须使用大写字母、数字或下划线。`);
        }
        argumentsConfig[name] = normalizeArgument(argument, opcode, name);
    });
    return {opcode, blockType, text: block.text.trim(), arguments: argumentsConfig, python: block.python.trim()};
};

export const normalizeQuickExtensionConfig = source => {
    const config = typeof source === 'string' ? JSON.parse(source) : clone(source);
    if (!isObject(config)) throw new Error('扩展 JSON 必须是对象。');
    if (Number(config.schemaVersion) !== 1) throw new Error('schemaVersion 当前只支持 1。');
    const id = String(config.id || '').trim();
    if (!ID_PATTERN.test(id)) {
        throw new Error('扩展 id 必须以 yyext 开头，且只能包含小写字母和数字，例如 yyextneopixel。');
    }
    if (typeof config.name !== 'string' || !config.name.trim()) throw new Error('扩展缺少 name。');
    if (!Array.isArray(config.blocks) || !config.blocks.length) throw new Error('扩展至少需要一个积木。');
    const blocks = config.blocks.map(normalizeBlock);
    const opcodeSet = new Set();
    blocks.forEach(block => {
        if (opcodeSet.has(block.opcode)) throw new Error(`积木 opcode 重复：${block.opcode}`);
        opcodeSet.add(block.opcode);
    });
    const menus = {};
    Object.entries(config.menus || {}).forEach(([name, menu]) => {
        if (!OPCODE_PATTERN.test(name)) throw new Error(`菜单名 ${name} 无效。`);
        menus[name] = normalizeMenu(menu, name);
    });
    blocks.forEach(block => Object.entries(block.arguments).forEach(([name, argument]) => {
        if (argument.menu && !menus[argument.menu]) {
            throw new Error(`积木 ${block.opcode} 的参数 ${name} 引用了不存在的菜单 ${argument.menu}。`);
        }
    }));
    const python = isObject(config.python) ? config.python : {};
    return {
        schemaVersion: 1,
        id,
        name: config.name.trim(),
        description: typeof config.description === 'string' ? config.description.trim() : '自定义 ESP32 扩展',
        color1: typeof config.color1 === 'string' && config.color1 ? config.color1 : '#0fbd8c',
        color2: typeof config.color2 === 'string' && config.color2 ? config.color2 : '#0c956f',
        iconURL: typeof config.iconURL === 'string' ? config.iconURL.trim() : '',
        blocks,
        menus,
        python: {
            imports: validateStringArray(python.imports, 'python.imports'),
            helpers: validateStringArray(python.helpers, 'python.helpers')
        }
    };
};

const readStoredExtensions = () => {
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.reduce((result, item) => {
            try {
                result.push(normalizeQuickExtensionConfig(item));
            } catch (error) {
                console.warn('[quick-extension] ignored invalid saved extension', error);
            }
            return result;
        }, []);
    } catch (error) {
        console.warn('[quick-extension] failed to read saved extensions', error);
        return [];
    }
};

const writeStoredExtensions = extensions => window.localStorage.setItem(STORAGE_KEY, JSON.stringify(extensions));

export const loadQuickExtensions = () => readStoredExtensions();
export const getQuickExtension = id => readStoredExtensions().find(config => config.id === id) || null;

export const saveQuickExtensionConfig = source => {
    const config = normalizeQuickExtensionConfig(source);
    const extensions = readStoredExtensions();
    const index = extensions.findIndex(item => item.id === config.id);
    if (index === -1) extensions.push(config);
    else extensions[index] = config;
    extensions.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
    writeStoredExtensions(extensions);
    return config;
};

export const deleteQuickExtensionConfig = id => {
    const extensions = readStoredExtensions();
    const next = extensions.filter(item => item.id !== id);
    if (next.length === extensions.length) return false;
    writeStoredExtensions(next);
    return true;
};

export const isQuickExtensionId = id => typeof id === 'string' && id.startsWith(QUICK_EXTENSION_PREFIX);
export const isQuickExtensionOpcode = opcode => typeof opcode === 'string' && opcode.startsWith(QUICK_EXTENSION_PREFIX);

const toScratchArgument = argument => {
    const result = {type: argument.type};
    if (argument.menu) result.menu = argument.menu;
    if (typeof argument.defaultValue !== 'undefined') result.defaultValue = argument.defaultValue;
    return result;
};

class QuickESP32Extension {
    constructor (config) {
        this.config = config;
        config.blocks.forEach(block => {
            if (block.blockType === 'Boolean') this[block.opcode] = () => false;
            else if (block.blockType === 'reporter') this[block.opcode] = () => 0;
            else this[block.opcode] = () => {};
        });
    }

    getInfo () {
        return {
            id: this.config.id,
            name: this.config.name,
            color1: this.config.color1,
            color2: this.config.color2,
            blocks: this.config.blocks.map(block => ({
                opcode: block.opcode,
                blockType: block.blockType,
                text: block.text,
                arguments: Object.entries(block.arguments).reduce((result, [name, argument]) => {
                    result[name] = toScratchArgument(argument);
                    return result;
                }, {})
            })),
            menus: this.config.menus
        };
    }
}

export const registerQuickExtension = (vm, source) => {
    const config = typeof source === 'string' ? getQuickExtension(source) : normalizeQuickExtensionConfig(source);
    if (!config) return Promise.reject(new Error(`找不到快捷扩展：${source}`));
    const manager = vm && vm.extensionManager;
    if (!manager) return Promise.reject(new Error('Scratch 扩展管理器尚未就绪。'));
    if (manager.isExtensionLoaded(config.id)) return Promise.resolve(manager._loadedExtensions.get(config.id));
    try {
        const serviceName = manager._registerInternalExtension(new QuickESP32Extension(config));
        manager._loadedExtensions.set(config.id, serviceName);
        return Promise.resolve(serviceName);
    } catch (error) {
        return Promise.reject(error);
    }
};

export const installQuickExtensionLoader = (vm, onLoaded) => {
    const manager = vm && vm.extensionManager;
    if (!manager) return;
    manager.__yiyiQuickExtensionOnLoaded = onLoaded;
    if (manager.__yiyiQuickExtensionLoaderInstalled) return;
    const originalLoadExtensionURL = manager.loadExtensionURL.bind(manager);
    manager.loadExtensionURL = extensionURL => {
        const id = String(extensionURL || '');
        const config = getQuickExtension(id);
        if (!config) return originalLoadExtensionURL(extensionURL);
        return registerQuickExtension(vm, config).then(result => {
            if (typeof manager.__yiyiQuickExtensionOnLoaded === 'function') {
                manager.__yiyiQuickExtensionOnLoaded(config);
            }
            return result;
        });
    };
    manager.__yiyiQuickExtensionLoaderInstalled = true;
};

const inputBlock = (blocks, block, name) => {
    const entry = block.inputs && block.inputs[name];
    return entry && blocks[entry.block || entry.shadow];
};
const fieldValue = (block, name) => block.fields && block.fields[name] && block.fields[name].value;

const pythonBoolean = value => {
    if (typeof value === 'boolean') return value ? 'True' : 'False';
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return 'True';
    if (['0', 'false', 'no', 'off', ''].includes(normalized)) return 'False';
    throw new Error(`无法把 ${value} 转换为 Python 布尔值。`);
};

const fieldToPython = (value, argument, name) => {
    const pythonType = argument.pythonType === 'auto' ?
        (argument.type === 'number' ? 'number' : argument.type === 'Boolean' ? 'boolean' : 'string') :
        argument.pythonType;
    switch (pythonType) {
    case 'number': {
        const number = Number(value);
        if (!Number.isFinite(number)) throw new Error(`参数 ${name} 不是有效数字。`);
        return String(number);
    }
    case 'boolean': return pythonBoolean(value);
    case 'raw': return String(value);
    case 'string':
    default: return JSON.stringify(String(value === null || typeof value === 'undefined' ? '' : value));
    }
};

const argumentToPython = (blocks, block, name, argument, context, expressionResolver) => {
    const child = inputBlock(blocks, block, name);
    if (child) return expressionResolver(blocks, child, context);
    const value = fieldValue(block, name);
    if (typeof value !== 'undefined') return fieldToPython(value, argument, name);
    if (typeof argument.defaultValue !== 'undefined') return fieldToPython(argument.defaultValue, argument, name);
    throw new Error(`积木 ${block.opcode} 缺少参数 ${name}。`);
};

const findQuickBlock = fullOpcode => {
    for (const config of readStoredExtensions()) {
        for (const block of config.blocks) {
            if (`${config.id}_${block.opcode}` === fullOpcode) return {config, block};
        }
    }
    return null;
};

const renderQuickPython = (blocks, runtimeBlock, definition, context, expressionResolver) => {
    if (context && typeof context.useQuickExtension === 'function') context.useQuickExtension(definition.config.id);
    return definition.block.python.replace(/\{\{([A-Z][A-Z0-9_]*)\}\}/g, (match, name) => {
        const argument = definition.block.arguments[name];
        if (!argument) throw new Error(`Python 模板引用了不存在的参数 ${name}。`);
        return argumentToPython(blocks, runtimeBlock, name, argument, context, expressionResolver);
    });
};

export const compileQuickExtensionCommand = (blocks, block, context, expressionResolver) => {
    const definition = findQuickBlock(block.opcode);
    if (!definition || definition.block.blockType !== 'command') return null;
    return renderQuickPython(blocks, block, definition, context, expressionResolver);
};

export const compileQuickExtensionReporter = (blocks, block, context, expressionResolver) => {
    const definition = findQuickBlock(block.opcode);
    if (!definition || !['reporter', 'Boolean'].includes(definition.block.blockType)) return null;
    const code = renderQuickPython(blocks, block, definition, context, expressionResolver);
    if (code.includes('\n')) throw new Error(`记者积木 ${block.opcode} 的 python 必须是单行表达式。`);
    return code;
};

export const getQuickExtensionPythonSupport = usedIds => {
    const ids = usedIds instanceof Set ? usedIds : new Set(usedIds || []);
    const imports = new Set();
    const helpers = new Set();
    readStoredExtensions().forEach(config => {
        if (!ids.has(config.id)) return;
        config.python.imports.forEach(line => imports.add(line));
        config.python.helpers.forEach(code => helpers.add(code));
    });
    return {imports: [...imports], helpers: [...helpers]};
};

export const QUICK_EXTENSION_EXAMPLE = {
    schemaVersion: 1,
    id: 'yyextneopixel',
    name: '多彩 LED',
    description: 'WS2812 / NeoPixel 串联 RGB 灯',
    color1: '#cf63cf',
    color2: '#a64fa6',
    menus: {
        pins: {
            acceptReporters: false,
            items: ['2', '4', '5', '12', '13', '14', '15', '16', '17', '18', '19', '21', '22', '23', '25', '26', '27', '32', '33']
        }
    },
    python: {
        imports: ['import neopixel'],
        helpers: [
            '_yy_neopixels = {}\ndef _yy_neopixel(pin, count):\n    key = (int(pin), max(1, int(count)))\n    if key not in _yy_neopixels:\n        _yy_neopixels[key] = neopixel.NeoPixel(Pin(key[0]), key[1])\n    return _yy_neopixels[key]',
            'def _yy_np_color(r, g, b):\n    return (max(0, min(255, int(r))), max(0, min(255, int(g))), max(0, min(255, int(b))))',
            'def _yy_np_set(pin, count, index, r, g, b):\n    strip = _yy_neopixel(pin, count)\n    i = max(0, min(len(strip) - 1, int(index)))\n    strip[i] = _yy_np_color(r, g, b)\n    strip.write()',
            'def _yy_np_fill(pin, count, r, g, b):\n    strip = _yy_neopixel(pin, count)\n    color = _yy_np_color(r, g, b)\n    for i in range(len(strip)):\n        strip[i] = color\n    strip.write()'
        ]
    },
    blocks: [
        {
            opcode: 'setPixel',
            blockType: 'command',
            text: '多彩 LED 引脚 [PIN] 数量 [COUNT] 第 [INDEX] 颗 R [R] G [G] B [B]',
            arguments: {
                PIN: {type: 'string', menu: 'pins', defaultValue: '23', pythonType: 'number'},
                COUNT: {type: 'number', defaultValue: 8},
                INDEX: {type: 'number', defaultValue: 0},
                R: {type: 'number', defaultValue: 255},
                G: {type: 'number', defaultValue: 0},
                B: {type: 'number', defaultValue: 0}
            },
            python: '_yy_np_set({{PIN}}, {{COUNT}}, {{INDEX}}, {{R}}, {{G}}, {{B}})'
        },
        {
            opcode: 'fill',
            blockType: 'command',
            text: '多彩 LED 引脚 [PIN] 数量 [COUNT] 全部设为 R [R] G [G] B [B]',
            arguments: {
                PIN: {type: 'string', menu: 'pins', defaultValue: '23', pythonType: 'number'},
                COUNT: {type: 'number', defaultValue: 8},
                R: {type: 'number', defaultValue: 0},
                G: {type: 'number', defaultValue: 255},
                B: {type: 'number', defaultValue: 0}
            },
            python: '_yy_np_fill({{PIN}}, {{COUNT}}, {{R}}, {{G}}, {{B}})'
        },
        {
            opcode: 'clear',
            blockType: 'command',
            text: '熄灭多彩 LED 引脚 [PIN] 数量 [COUNT]',
            arguments: {
                PIN: {type: 'string', menu: 'pins', defaultValue: '23', pythonType: 'number'},
                COUNT: {type: 'number', defaultValue: 8}
            },
            python: '_yy_np_fill({{PIN}}, {{COUNT}}, 0, 0, 0)'
        }
    ]
};

export const getQuickExtensionAIPrompt = () => `请为“一一编程乐园”的 ESP32 板上编程生成一份快捷扩展 JSON。\n\n` +
    `只返回合法 JSON，不要 Markdown，不要解释。必须遵守：\n` +
    `1. schemaVersion 固定为 1。\n` +
    `2. id 必须以 yyext 开头，只能使用小写字母和数字，例如 yyextneopixel；Scratch VM 的扩展 id 不允许下划线。\n` +
    `3. 每个 blocks 项必须包含 opcode、blockType、text、arguments、python。\n` +
    `4. blockType 只允许 command、reporter、boolean。\n` +
    `5. text 中参数写成 [PIN] 这种大写占位符；arguments 中必须存在同名参数。\n` +
    `6. 参数 type 只允许 string、number、boolean。菜单参数可加 menu；如果菜单值要直接生成数字或 Python 常量，用 pythonType: number 或 raw。\n` +
    `7. 积木 python 用 {{ARG}} 引用参数。command 可生成多行语句；reporter/boolean 必须生成单行 Python 表达式。\n` +
    `8. 扩展级 python.imports 放 MicroPython import；python.helpers 放辅助函数/全局缓存。不要依赖需要额外 pip 安装的桌面 Python 包。\n` +
    `9. 生成的代码面向 ESP32 MicroPython。若用于仿真，仿真器本身也必须支持对应 MicroPython 模块和元件；不要假设 JSON 能新增仿真器底层元件。\n` +
    `10. 颜色使用 #RRGGBB。\n\n示例：\n${JSON.stringify(QUICK_EXTENSION_EXAMPLE, null, 2)}`;
