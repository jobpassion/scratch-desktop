import {expression, field, input, literal, unsupported} from './compileExpression';

const PINS = new Set([
    '2', '4', '5', '12', '13', '14', '15', '16', '17', '18', '19',
    '21', '22', '23', '25', '26', '27', '32', '33'
]);

const variableId = block => block.fields && block.fields.VARIABLE && block.fields.VARIABLE.id;
const safeSymbol = id => Array.from(String(id))
    .map(char => char.charCodeAt(0).toString(16))
    .join('_');
const procedureKey = (target, code) => `${target.id}:${code}`;

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
        case 'control_wait': lines.push(`${indent}sleep(${value('DURATION')})`); break;
        case 'control_repeat':
            lines.push(`${indent}for _ in range(max(0, int(${value('TIMES')}))):`);
            lines.push(body('SUBSTACK'));
            break;
        case 'control_forever':
            lines.push(`${indent}while True:`);
            lines.push(body('SUBSTACK'));
            break;
        case 'control_if':
            lines.push(`${indent}if ${value('CONDITION')}:`);
            lines.push(body('SUBSTACK'));
            break;
        case 'control_if_else':
            lines.push(`${indent}if ${value('CONDITION')}:`);
            lines.push(body('SUBSTACK'));
            lines.push(`${indent}else:`);
            lines.push(body('SUBSTACK2'));
            break;
        case 'control_repeat_until':
            lines.push(`${indent}while not (${value('CONDITION')}):`);
            lines.push(body('SUBSTACK'));
            break;
        case 'control_wait_until':
            lines.push(`${indent}while not (${value('CONDITION')}):`);
            lines.push(`${indent}    sleep(0.01)`);
            break;
        case 'data_setvariableto':
            lines.push(`${indent}${context.variable(block)} = ${value('VALUE')}`);
            break;
        case 'data_changevariableby':
            lines.push(`${indent}${context.variable(block)} += ${value('VALUE')}`);
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
        default: unsupported(block);
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
    const globalNames = [...variables.values()].map(variable => variable.symbol).join(', ');
    const makeContext = (target, parameters = null) => ({
        target,
        parameters,
        procedures,
        pins: PINS,
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
    return `${[
        'from machine import Pin',
        'from time import sleep',
        'import random',
        ...initializers,
        ...functions,
        ...scripts
    ].join('\n\n')}\n`;
};

export default compileESP32;
