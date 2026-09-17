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
    const value = name => expression(blocks, input(blocks, block, name), context);
    const binaryCall = (left, right, helper) => `${helper}(${value(left)}, ${value(right)})`;
    switch (block.opcode) {
    case 'math_number':
    case 'math_integer':
    case 'math_whole_number':
    case 'math_positive_number':
    case 'math_decimal': {
        const number = Number(field(block, 'NUM'));
        if (!Number.isFinite(number)) throw new Error('数值积木中有无效数字。');
        return String(number);
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
    case 'operator_add': return binaryCall('NUM1', 'NUM2', '_scratch_add');
    case 'operator_subtract': return `(_scratch_num(${value('NUM1')}) - _scratch_num(${value('NUM2')}))`;
    case 'operator_multiply': return `(_scratch_num(${value('NUM1')}) * _scratch_num(${value('NUM2')}))`;
    case 'operator_divide': return binaryCall('NUM1', 'NUM2', '_scratch_div');
    case 'operator_mod': return binaryCall('NUM1', 'NUM2', '_scratch_mod');
    case 'operator_gt': return `(_scratch_compare(${value('OPERAND1')}, ${value('OPERAND2')}) > 0)`;
    case 'operator_lt': return `(_scratch_compare(${value('OPERAND1')}, ${value('OPERAND2')}) < 0)`;
    case 'operator_equals': return `(_scratch_compare(${value('OPERAND1')}, ${value('OPERAND2')}) == 0)`;
    case 'operator_and': return `(_scratch_bool(${value('OPERAND1')}) and _scratch_bool(${value('OPERAND2')}))`;
    case 'operator_or': return `(_scratch_bool(${value('OPERAND1')}) or _scratch_bool(${value('OPERAND2')}))`;
    case 'operator_not': return `(not _scratch_bool(${value('OPERAND')}))`;
    case 'operator_random': return binaryCall('FROM', 'TO', '_scratch_random');
    case 'operator_round': return `round(_scratch_num(${value('NUM')}))`;
    case 'operator_join': return `(_scratch_str(${value('STRING1')}) + _scratch_str(${value('STRING2')}))`;
    case 'operator_length': return `len(_scratch_str(${value('STRING')}))`;
    case 'operator_contains':
        return `(_scratch_str(${value('STRING2')}).lower() in _scratch_str(${value('STRING1')}).lower())`;
    case 'operator_letter_of': return `_scratch_letter(${value('LETTER')}, ${value('STRING')})`;
    default: {
        const quickExpression = compileQuickExtensionReporter(blocks, block, context, expression);
        if (quickExpression !== null) return quickExpression;
        return unsupported(block);
    }
    }
};
