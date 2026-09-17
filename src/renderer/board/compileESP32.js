import {expression, field, input, literal, unsupported} from './compileExpression';
import {
    compileQuickExtensionCommand,
    getQuickExtensionPythonSupport
} from './QuickExtensionRegistry';

const PINS = new Set([
    '2', '4', '5', '12', '13', '14', '15', '16', '17', '18', '19',
    '21', '22', '23', '25', '26', '27', '32', '33'
]);
const ANALOG_PINS = new Set(['32', '33', '34', '35', '36', '39']);
const BOARD_PRINT_PREFIX = '__YY_PRINT__';

const variableId = block => block.fields && block.fields.VARIABLE && block.fields.VARIABLE.id;
const safeSymbol = id => Array.from(String(id))
    .map(char => char.charCodeAt(0).toString(16))
    .join('_');
const procedureKey = (target, code) => `${target.id}:${code}`;
const indentSnippet = (source, indent) => String(source)
    .split('\n')
    .map(line => `${indent}${line}`)
    .join('\n');

const compileStack = (blocks, firstId, indent, context, seen = new Set()) => {
    const lines = [];
    let id = firstId;
    while (id) {
        if (seen.has(id)) throw new Error('积木连接形成了循环。');
        seen.add(id);
        const block = blocks[id];
        if (!block) throw new Error('作品中的积木连接不完整。');
        const value = name => expression(blocks, input(blocks, block, name), context);
        const body = name => {
            const first = input(blocks, block, name);
            return compileStack(blocks, first && first.id, `${indent}    `, context, seen) || `${indent}    pass`;
        };
        switch (block.opcode) {
        case 'esp32gpio_setOnboardLed': {
            const level = String(field(block, 'VALUE'));
            if (!['0', '1'].includes(level)) throw new Error('板载 LED 状态无效。');
            lines.push(`${indent}Pin(2, Pin.OUT).value(${level})`);
            break;
        }
        case 'esp32gpio_setDigital': {
            const pin = String(field(block, 'PIN'));
            const level = String(field(block, 'VALUE'));
            if (!PINS.has(pin) || !['0', '1'].includes(level)) throw new Error('ESP32 引脚或电平设置无效。');
            lines.push(`${indent}Pin(${pin}, Pin.OUT).value(${level})`);
            break;
        }
        case 'esp32gpio_printText':
            lines.push(`${indent}_board_print(${value('TEXT')})`);
            break;
        case 'esp32gpio_writeAnalog': {
            const pin = String(field(block, 'PIN'));
            if (!PINS.has(pin)) throw new Error('ESP32 PWM 输出引脚无效。');
            lines.push(`${indent}_write_pwm(${pin}, ${value('VALUE')})`);
            break;
        }
        case 'control_wait': lines.push(`${indent}sleep(max(0, _scratch_num(${value('DURATION')})))`); break;
        case 'control_repeat':
            lines.push(`${indent}for _ in range(max(0, int(round(_scratch_num(${value('TIMES')}))))):`);
            lines.push(body('SUBSTACK'));
            break;
        case 'control_forever':
            lines.push(`${indent}while True:`);
            lines.push(body('SUBSTACK'));
            break;
        case 'control_if':
            lines.push(`${indent}if _scratch_bool(${value('CONDITION')}):`);
            lines.push(body('SUBSTACK'));
            break;
        case 'control_if_else':
            lines.push(`${indent}if _scratch_bool(${value('CONDITION')}):`);
            lines.push(body('SUBSTACK'));
            lines.push(`${indent}else:`);
            lines.push(body('SUBSTACK2'));
            break;
        case 'control_repeat_until':
            lines.push(`${indent}while not _scratch_bool(${value('CONDITION')}):`);
            lines.push(body('SUBSTACK'));
            break;
        case 'control_wait_until':
            lines.push(`${indent}while not _scratch_bool(${value('CONDITION')}):`);
            lines.push(`${indent}    sleep(0.01)`);
            break;
        case 'data_setvariableto':
            lines.push(`${indent}${context.variable(block)} = ${value('VALUE')}`);
            break;
        case 'data_changevariableby':
            lines.push(`${indent}${context.variable(block)} = _scratch_add(${context.variable(block)}, ${value('VALUE')})`);
            break;
        case 'procedures_call': {
            const code = block.mutation && block.mutation.proccode;
            const definition = context.procedures.get(procedureKey(context.target, code));
            if (!definition) throw new Error(`找不到自制积木“${code}”的定义。`);
            const args = definition.ids.map((argId, index) => {
                const child = input(blocks, block, argId);
                return child ? expression(blocks, child, context) : literal(definition.defaults[index]);
            });
            lines.push(`${indent}${definition.symbol}(${args.join(', ')})`);
            break;
        }
        default: {
            const quickCode = compileQuickExtensionCommand(blocks, block, context, expression);
            if (quickCode === null) unsupported(block);
            lines.push(indentSnippet(quickCode, indent));
        }
        }
        id = block.next;
    }
    return lines.join('\n');
};

const compileESP32 = vm => {
    const stage = vm.runtime.targets.find(target => target.isStage);
    if (stage && Object.values(stage.blocks._blocks).some(block => block.topLevel && !block.shadow)) {
        throw new Error('舞台脚本不能发送到 ESP32；请在角色中编写板上程序。');
    }
    const targets = vm.runtime.targets.filter(target => !target.isStage && target.isOriginal);
    const variables = new Map();
    [stage, ...targets].filter(Boolean).forEach(target => {
        Object.entries(target.variables || {}).forEach(([id, variable]) => {
            if (variable.type === '') variables.set(id, {symbol: `_v_${safeSymbol(id)}`, initial: variable.value});
        });
    });
    const procedures = new Map();
    targets.forEach(target => {
        Object.values(target.blocks._blocks).forEach(block => {
            if (block.opcode !== 'procedures_definition') return;
            const prototype = input(target.blocks._blocks, block, 'custom_block');
            const mutation = prototype && prototype.mutation;
            if (!mutation || !mutation.proccode) throw new Error('自制积木定义不完整。');
            const key = procedureKey(target, mutation.proccode);
            if (procedures.has(key)) throw new Error(`自制积木“${mutation.proccode}”重复定义。`);
            procedures.set(key, {
                block,
                target,
                symbol: `_proc_${procedures.size}`,
                names: JSON.parse(mutation.argumentnames || '[]'),
                ids: JSON.parse(mutation.argumentids || '[]'),
                defaults: JSON.parse(mutation.argumentdefaults || '[]')
            });
        });
    });
    const usedQuickExtensions = new Set();
    const globalNames = [...variables.values()].map(variable => variable.symbol).join(', ');
    const makeContext = (target, parameters = null) => ({
        target,
        parameters,
        procedures,
        pins: PINS,
        analogPins: ANALOG_PINS,
        useQuickExtension: id => usedQuickExtensions.add(id),
        variable: block => {
            const variable = variables.get(variableId(block));
            if (!variable) throw new Error(`找不到变量“${field(block, 'VARIABLE')}”。`);
            return variable.symbol;
        }
    });
    const functions = [...procedures.values()].map(definition => {
        const params = new Map(definition.names.map((name, index) => [name, `_p_${index}`]));
        const args = [...params.values()].join(', ');
        const body = compileStack(definition.target.blocks._blocks, definition.block.next, '    ',
            makeContext(definition.target, params));
        return `def ${definition.symbol}(${args}):\n` +
            `${globalNames ? `    global ${globalNames}\n` : ''}${body || '    pass'}`;
    });
    const scripts = [];
    targets.forEach(target => {
        const blocks = target.blocks._blocks;
        Object.values(blocks).forEach(block => {
            if (!block.topLevel || block.shadow || block.opcode !== 'event_whenflagclicked') return;
            if (block.next) scripts.push(compileStack(blocks, block.next, '', makeContext(target)));
        });
    });
    if (!scripts.length) throw new Error('请添加“当绿旗被点击”以及 ESP32 积木。');
    if (scripts.length > 1) throw new Error('第一版板上程序只能有一组绿旗脚本，请合并后再发送。');
    const initializers = [...variables.values()].map(variable => `${variable.symbol} = ${literal(variable.initial)}`);
    const quickSupport = getQuickExtensionPythonSupport(usedQuickExtensions);
    return `${[
        'from machine import Pin, ADC, PWM',
        'from time import sleep',
        'import random',
        ...quickSupport.imports,
        'def _scratch_str(value):\n' +
            "    if value is True:\n        return 'true'\n" +
            "    if value is False:\n        return 'false'\n" +
            '    if isinstance(value, float):\n' +
            '        try:\n' +
            '            integer = int(value)\n' +
            '            if value == integer:\n' +
            '                return str(integer)\n' +
            '        except:\n' +
            '            pass\n' +
            '    return str(value)',
        'def _scratch_number_or_none(value):\n' +
            '    if value is True:\n        return 1\n' +
            '    if value is False:\n        return 0\n' +
            '    if isinstance(value, (int, float)):\n' +
            '        if isinstance(value, float) and value != value:\n' +
            '            return None\n' +
            '        return value\n' +
            '    text = str(value).strip()\n' +
            "    if text == '':\n        return 0\n" +
            '    try:\n' +
            '        number = float(text)\n' +
            '        if number != number:\n' +
            '            return None\n' +
            '        try:\n' +
            '            integer = int(number)\n' +
            '            if number == integer:\n' +
            '                return integer\n' +
            '        except:\n' +
            '            pass\n' +
            '        return number\n' +
            '    except:\n' +
            '        return None',
        'def _scratch_num(value):\n' +
            '    number = _scratch_number_or_none(value)\n' +
            '    return 0 if number is None else number',
        'def _scratch_bool(value):\n' +
            '    if isinstance(value, bool):\n        return value\n' +
            '    if value is None:\n        return False\n' +
            '    if isinstance(value, str):\n' +
            '        text = value.strip().lower()\n' +
            "        return text != '' and text != '0' and text != 'false'\n" +
            '    if isinstance(value, float) and value != value:\n' +
            '        return False\n' +
            '    return value != 0',
        'def _scratch_add(left, right):\n' +
            '    return _scratch_num(left) + _scratch_num(right)',
        'def _scratch_div(left, right):\n' +
            '    a = _scratch_num(left)\n' +
            '    b = _scratch_num(right)\n' +
            '    if b == 0:\n' +
            "        if a == 0:\n            return float('nan')\n" +
            "        return float('-inf') if a < 0 else float('inf')\n" +
            '    return a / b',
        'def _scratch_mod(left, right):\n' +
            '    a = _scratch_num(left)\n' +
            '    b = _scratch_num(right)\n' +
            "    return float('nan') if b == 0 else a % b",
        'def _scratch_compare(left, right):\n' +
            '    a = _scratch_number_or_none(left)\n' +
            '    b = _scratch_number_or_none(right)\n' +
            '    if a is not None and b is not None:\n' +
            '        return -1 if a < b else (1 if a > b else 0)\n' +
            '    a = _scratch_str(left).lower()\n' +
            '    b = _scratch_str(right).lower()\n' +
            '    return -1 if a < b else (1 if a > b else 0)',
        'def _scratch_random(left, right):\n' +
            '    a = _scratch_num(left)\n' +
            '    b = _scratch_num(right)\n' +
            '    low = min(a, b)\n' +
            '    high = max(a, b)\n' +
            '    try:\n' +
            '        if low == int(low) and high == int(high):\n' +
            '            return random.randint(int(low), int(high))\n' +
            '    except:\n' +
            '        pass\n' +
            '    return low + ((high - low) * random.random())',
        'def _scratch_letter(index, value):\n' +
            '    text = _scratch_str(value)\n' +
            '    position = int(_scratch_num(index))\n' +
            "    if position < 1 or position > len(text):\n        return ''\n" +
            '    return text[position - 1]',
        `_board_print_prefix = ${literal(BOARD_PRINT_PREFIX)}`,
        'def _board_print(value):\n' +
            "    for line in _scratch_str(value).split('\\n'):\n" +
            '        print(_board_print_prefix + line)',
        '_adc_inputs = {}',
        'def _read_analog(pin):\n' +
            '    if pin not in _adc_inputs:\n' +
            '        adc = ADC(Pin(pin))\n' +
            '        adc.atten(ADC.ATTN_11DB)\n' +
            '        _adc_inputs[pin] = adc\n' +
            '    return _adc_inputs[pin].read()',
        '_pwm_outputs = {}',
        'def _write_pwm(pin, value):\n' +
            '    if pin not in _pwm_outputs:\n' +
            '        _pwm_outputs[pin] = PWM(Pin(pin), freq=1000)\n' +
            '    _pwm_outputs[pin].duty(max(0, min(1023, int(_scratch_num(value)))))',
        ...quickSupport.helpers,
        ...initializers,
        ...functions,
        ...scripts
    ].join('\n\n')}\n`;
};

export default compileESP32;
