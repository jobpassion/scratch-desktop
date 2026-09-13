const PINS = [
    '2', '4', '5', '12', '13', '14', '15', '16', '17', '18', '19',
    '21', '22', '23', '25', '26', '27', '32', '33'
];
const ANALOG_PINS = ['32', '33', '34', '35', '36', '39'];

class ESP32Extension {
    getInfo () {
        return {
            id: 'esp32gpio',
            name: 'ESP32 基础 IO',
            color1: '#0fbd8c',
            color2: '#0c956f',
            blocks: [
                {
                    opcode: 'setOnboardLed',
                    blockType: 'command',
                    text: '板载 LED (GPIO2) [VALUE]',
                    arguments: {
                        VALUE: {type: 'string', menu: 'ledStates', defaultValue: '1'}
                    }
                },
                {
                    opcode: 'setDigital',
                    blockType: 'command',
                    text: '将 GPIO [PIN] 设为 [VALUE]',
                    arguments: {
                        PIN: {type: 'string', menu: 'pins', defaultValue: '23'},
                        VALUE: {type: 'string', menu: 'levels', defaultValue: '1'}
                    }
                },
                {
                    opcode: 'writeAnalog',
                    blockType: 'command',
                    text: '将 GPIO [PIN] PWM 设为 [VALUE] (0-1023)',
                    arguments: {
                        PIN: {type: 'string', menu: 'pins', defaultValue: '23'},
                        VALUE: {type: 'number', defaultValue: 512}
                    }
                },
                {
                    opcode: 'readAnalog',
                    blockType: 'reporter',
                    text: '读取 GPIO [PIN] 模拟值 (0-4095)',
                    arguments: {
                        PIN: {type: 'string', menu: 'analogPins', defaultValue: '32'}
                    }
                },
                {
                    opcode: 'printText',
                    blockType: 'command',
                    text: '打印 [TEXT]',
                    arguments: {
                        TEXT: {type: 'string', defaultValue: '你好，ESP32'}
                    }
                },
                {
                    opcode: 'readDigital',
                    blockType: 'reporter',
                    text: '读取 GPIO [PIN]',
                    arguments: {
                        PIN: {type: 'string', menu: 'pins', defaultValue: '23'}
                    }
                }
            ],
            menus: {
                pins: {acceptReporters: false, items: PINS},
                analogPins: {acceptReporters: false, items: ANALOG_PINS},
                levels: {acceptReporters: false,
                    items: [
                        {text: '高电平', value: '1'},
                        {text: '低电平', value: '0'}
                    ]},
                ledStates: {acceptReporters: false,
                    items: [
                        {text: '点亮', value: '1'},
                        {text: '熄灭', value: '0'}
                    ]}
            }
        };
    }

    // Board blocks are translated for MicroPython; clicking them in Scratch has no hardware effect.
    setOnboardLed () {}

    setDigital () {}

    writeAnalog () {}

    readAnalog () {
        return 0;
    }

    printText () {}

    readDigital () {
        return 0;
    }
}

export default ESP32Extension;
