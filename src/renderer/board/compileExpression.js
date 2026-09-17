import {compileQuickExtensionReporter} from './QuickExtensionRegistry';

export const field = (block, name) => block.fields && block.fields[name] && block.fields[name].value;

export const input = (blocks, block, name) => {
    const entry = block.inputs && block.inputs[name];
    return entry && blocks[entry.block || entry.shadow];
};

export const unsupported = block => {
    throw new Error(`积木“${block.opcode}”暂不支持板上运行，请删除或替换后再发送。`);
};

export const literal = value => {
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (typeof value === 'boolean') return value ? 'True' : 'False';
    return JSON.stringify(String(value === null || typeof value === 'undefined' ? '' : value));
};

export const expression = (blocks, block, context) => {
    if (!block) return '0';
    const binary = (left, right, operator) =>
        `(${expression(blocks, input(blocks, block, left), context)} ${operator} ` +
        `${expression(blocks, input(blocks, block, right), context)})`;
    switch (block.opcode) {
    case 'math_number':
    case 'math_integer':
    case 'math_whole_number':
    case 'math_positive_number':
    case 'math_decimal': {
        const value = Number(field(block, 'NUM'));
        if (!Number.isFinite(value)) throw new Error('数值积木中有无效数字。');
        return String(value);
    }
    case 'text': return literal(field(block, 'TEXT'));
    case 'data_variable': return context.variable(block);
    case 'argument_reporter_string_number':
    case 'argument_reporter_boolean': {
        const name = field(block, 'VALUE');
        if (!context.parameters || !context.parameters.has(name)) throw new Error(`找不到自制积木参数“${name}”。`);
        return context.parameters.get(name);
    }
    case 'esp32gpio_readDigital': {
        const pin = String(field(block, 'PIN'));
        if (!context.pins.has(pin)) throw new Error('ESP32 引脚设置无效。');
        return `Pin(${pin}, Pin.IN).value()`;
    }
    case 'esp32gpio_readAnalog': {
        const pin = String(field(block, 'PIN'));
        if (!context.analogPins.has(pin)) throw new Error('ESP32 模拟输入引脚无效。');
        return `_read_analog(${pin})`;
    }
    case 'operator_add': return binary('NUM1', 'NUM2', '+');
    case 'operator_subtract': return binary('NUM1', 'NUM2', '-');
    case 'operator_multiply': return binary('NUM1', 'NUM2', '*');
    case 'operator_divide': return binary('NUM1', 'NUM2', '/');
    case 'operator_mod': return binary('NUM1', 'NUM2', '%');
    case 'operator_gt': return binary('OPERAND1', 'OPERAND2', '>');
    case 'operator_lt': return binary('OPERAND1', 'OPERAND2', '<');
    case 'operator_equals': return binary('OPERAND1', 'OPERAND2', '==');
    case 'operator_and': return binary('OPERAND1', 'OPERAND2', 'and');
    case 'operator_or': return binary('OPERAND1', 'OPERAND2', 'or');
    case 'operator_not': return `(not ${expression(blocks, input(blocks, block, 'OPERAND'), context)})`;
    case 'operator_random':
        return `random.randint(int(${expression(blocks, input(blocks, block, 'FROM'), context)}), ` +
            `int(${expression(blocks, input(blocks, block, 'TO'), context)}))`;
    case 'operator_round': return `round(${expression(blocks, input(blocks, block, 'NUM'), context)})`;
    case 'operator_join':
        return `(str(${expression(blocks, input(blocks, block, 'STRING1'), context)}) + ` +
            `str(${expression(blocks, input(blocks, block, 'STRING2'), context)}))`;
    case 'operator_length': return `len(str(${expression(blocks, input(blocks, block, 'STRING'), context)}))`;
    case 'operator_contains':
        return `(str(${expression(blocks, input(blocks, block, 'STRING2'), context)}) in ` +
            `str(${expression(blocks, input(blocks, block, 'STRING1'), context)}))`;
    case 'operator_letter_of':
        return `str(${expression(blocks, input(blocks, block, 'STRING'), context)})[` +
            `int(${expression(blocks, input(blocks, block, 'LETTER'), context)}) - 1]`;
    default: {
        const quickExpression = compileQuickExtensionReporter(blocks, block, context, expression);
        if (quickExpression !== null) return quickExpression;
        return unsupported(block);
    }
    }
};
