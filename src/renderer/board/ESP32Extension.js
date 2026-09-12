const PINS = [
    '2', '4', '5', '12', '13', '14', '15', '16', '17', '18', '19',
    '21', '22', '23', '25', '26', '27', '32', '33'
];

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

    readDigital () {
        return 0;
    }
}

export default ESP32Extension;
