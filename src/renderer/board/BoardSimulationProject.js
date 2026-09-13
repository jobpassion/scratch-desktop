import JSZip from 'jszip';

const FILE_NAME = 'board-simulation.vlx';
const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024;
const onboardLedPin = '2';
const BOARD_SIZE = {width: 141, height: 265};
const LED_SIZE = {width: 45, height: 70};
const RESISTOR_SIZE = {width: 90, height: 35};
const overlaps = (a, b, gap = 24) => a.x < b.x + b.width + gap &&
    a.x + a.width + gap > b.x && a.y < b.y + b.height + gap &&
    a.y + a.height + gap > b.y;
const getBounds = item => {
    const size = item.boardKind ? BOARD_SIZE : item.metadataId === 'resistor' ? RESISTOR_SIZE : LED_SIZE;
    return {x: item.x, y: item.y, ...size};
};
const findOnboardLedPosition = (snapshot, board, ledId, resistorId) => {
    const occupied = [...snapshot.boards, ...snapshot.components]
        .filter(item => item.id !== ledId && item.id !== resistorId).map(getBounds);
    // Keep the parts in one row, beyond the board's right edge. Try other rows
    // when the project already contains parts in the preferred space.
    for (let row = 0; row < 40; row++) {
        const y = board.y + 145 + ((row % 2 ? -1 : 1) * Math.ceil(row / 2) * 100);
        for (let column = 0; column < 20; column++) {
            const resistor = {
                x: board.x + BOARD_SIZE.width + 90 + (column * 90),
                y,
                ...RESISTOR_SIZE
            };
            const led = {
                x: resistor.x + RESISTOR_SIZE.width + 90,
                y: y - 12,
                ...LED_SIZE
            };
            if (![resistor, led].some(part => occupied.some(item => overlaps(part, item))) &&
                !overlaps(resistor, led)) return {resistor, led};
        }
    }
    throw new Error('仿真电路中没有足够空间放置板载 LED。');
};
const isConnection = (wire, firstId, firstPin, secondId, secondPin) =>
    (wire.start.componentId === firstId && wire.start.pinName === firstPin &&
        wire.end.componentId === secondId && wire.end.pinName === secondPin) ||
    (wire.end.componentId === firstId && wire.end.pinName === firstPin &&
        wire.start.componentId === secondId && wire.start.pinName === secondPin);
const addOnboardLedCircuit = (snapshot, board) => {
    const ledId = `scratch-onboard-led-${board.id}`;
    const resistorId = `${ledId}-resistor`;
    const hasWiredLed = snapshot.components.some(component => component.id !== ledId &&
        component.metadataId === 'led' &&
        snapshot.components.some(resistor => resistor.metadataId === 'resistor' &&
            snapshot.wires.some(wire => isConnection(wire, board.id, onboardLedPin, resistor.id, '1')) &&
            snapshot.wires.some(wire => isConnection(wire, resistor.id, '2', component.id, 'A'))) &&
        snapshot.wires.some(wire => isConnection(wire, component.id, 'C', board.id, 'GND')));
    if (hasWiredLed) return;

    let led = snapshot.components.find(component => component.id === ledId);
    let resistor = snapshot.components.find(component => component.id === resistorId);
    const oldLayout = led && resistor && led.x === board.x + 210 && led.y === board.y + 110 &&
        resistor.x === board.x + 155 && resistor.y === board.y + 120;
    const blocked = [led, resistor].filter(Boolean).some(part =>
        [...snapshot.boards, ...snapshot.components].some(other => other.id !== ledId &&
            other.id !== resistorId && overlaps(getBounds(part), getBounds(other))));
    const needsLayout = !led || !resistor || oldLayout || blocked ||
        overlaps(getBounds(led), getBounds(resistor));
    const position = needsLayout ? findOnboardLedPosition(snapshot, board, ledId, resistorId) : null;
    if (position) {
        if (led) Object.assign(led, {x: position.led.x, y: position.led.y});
        if (resistor) Object.assign(resistor, {x: position.resistor.x, y: position.resistor.y});
    }
    if (!led) {
        snapshot.components.push({
            id: ledId,
            metadataId: 'led',
            x: position.led.x,
            y: position.led.y,
            properties: {color: 'blue', label: '板载 LED (GPIO2)'}
        });
        led = snapshot.components[snapshot.components.length - 1];
    }
    if (!resistor) {
        snapshot.components.push({
            id: resistorId,
            metadataId: 'resistor',
            x: position.resistor.x,
            y: position.resistor.y,
            properties: {value: '220'}
        });
        resistor = snapshot.components[snapshot.components.length - 1];
    }
    snapshot.wires = snapshot.wires.filter(wire =>
        !isConnection(wire, board.id, onboardLedPin, ledId, 'A'));
    const addWire = (id, firstId, firstPin, secondId, secondPin, color, waypoints = []) => {
        const existing = snapshot.wires.find(wire => isConnection(wire, firstId, firstPin, secondId, secondPin));
        const wire = existing || {
            id,
            start: {componentId: firstId, pinName: firstPin, x: 0, y: 0},
            end: {componentId: secondId, pinName: secondPin, x: 0, y: 0},
            color
        };
        if (!existing || existing.id === id) wire.waypoints = waypoints;
        if (!existing) snapshot.wires.push(wire);
    };
    addWire(`${ledId}-gpio2`, board.id, onboardLedPin, resistorId, '1', '#22c55e');
    addWire(`${ledId}-anode`, resistorId, '2', ledId, 'A', '#22c55e');
    const groundY = Math.max(board.y + BOARD_SIZE.height, led.y + LED_SIZE.height) + 45;
    addWire(`${ledId}-gnd`, ledId, 'C', board.id, 'GND', '#000000', [
        {x: led.x + LED_SIZE.width + 35, y: led.y + 35},
        {x: led.x + LED_SIZE.width + 35, y: groundY},
        {x: board.x - 40, y: groundY},
        {x: board.x - 40, y: board.y + 194}
    ]);
};
const zipData = data => {
    if (data && typeof data.arrayBuffer === 'function') return data.arrayBuffer();
    return data;
};

const validateSnapshot = snapshot => {
    if (!snapshot || snapshot.format !== 'velxio-project' || !Array.isArray(snapshot.boards) ||
        !Array.isArray(snapshot.components) || !Array.isArray(snapshot.wires) ||
        !snapshot.fileGroups || typeof snapshot.fileGroups !== 'object') {
        throw new Error('仿真电路文件格式无效。');
    }
    if (!snapshot.boards.some(board => board.boardKind && board.boardKind.startsWith('esp32'))) {
        throw new Error('仿真电路中没有 ESP32 开发板。');
    }
    return snapshot;
};

class BoardSimulationProject {
    constructor (vm, captureSnapshot = () => null, closeSimulation = () => null) {
        if (vm._boardSimulationProject) return vm._boardSimulationProject;
        vm._boardSimulationProject = this;
        this.vm = vm;
        this.snapshot = null;
        const saveProject = vm.saveProjectSb3.bind(vm);
        const loadProject = vm.loadProject.bind(vm);
        const clear = vm.clear.bind(vm);
        vm.clear = (...args) => {
            this.snapshot = null;
            return clear(...args);
        };
        vm.saveProjectSb3 = async (...args) => {
            const liveSnapshot = await captureSnapshot();
            if (liveSnapshot) this.setSnapshot(JSON.parse(liveSnapshot));
            const blob = await saveProject(...args);
            if (!this.snapshot) return blob;
            const zip = await JSZip.loadAsync(await zipData(blob));
            zip.file(FILE_NAME, JSON.stringify(this.snapshot));
            return zip.generateAsync({
                type: 'blob',
                mimeType: 'application/x.scratch.sb3',
                compression: 'DEFLATE'
            });
        };
        vm.loadProject = async (...args) => {
            await closeSimulation();
            const data = args[0];
            let snapshot = null;
            if (data && typeof data !== 'string') {
                try {
                    const zip = await JSZip.loadAsync(await zipData(data));
                    const entry = zip.file(FILE_NAME);
                    if (entry) {
                        const content = await entry.async('string');
                        if (new TextEncoder().encode(content).length > MAX_SNAPSHOT_BYTES) {
                            throw new Error('仿真电路文件过大。');
                        }
                        snapshot = validateSnapshot(JSON.parse(content));
                    }
                } catch (error) {
                    if (error.message && (error.message.includes('仿真电路') || error instanceof SyntaxError)) {
                        throw error;
                    }
                }
            }
            const result = await loadProject(...args);
            this.snapshot = snapshot;
            return result;
        };
    }

    setSnapshot (snapshot) {
        const validated = validateSnapshot(snapshot);
        const size = new TextEncoder().encode(JSON.stringify(validated)).length;
        if (size > MAX_SNAPSHOT_BYTES) throw new Error('仿真电路文件过大。');
        this.snapshot = validated;
    }

    buildRunSnapshot (source) {
        const snapshot = this.snapshot ? JSON.parse(JSON.stringify(this.snapshot)) : {
            format: 'velxio-project',
            version: 1,
            exportedAt: new Date().toISOString(),
            boards: [{
                id: 'esp32',
                boardKind: 'esp32',
                x: 300,
                y: 200,
                activeFileGroupId: 'group-esp32',
                languageMode: 'micropython'
            }],
            fileGroups: {'group-esp32': []},
            components: [],
            wires: [],
            activeBoardId: 'esp32'
        };
        const board = snapshot.boards.find(item => item.boardKind && item.boardKind.startsWith('esp32'));
        const groupId = board.activeFileGroupId;
        const files = snapshot.fileGroups[groupId] || [];
        snapshot.fileGroups[groupId] = [
            {name: 'main.py', content: source},
            ...files.filter(file => file.name !== 'main.py')
        ];
        board.languageMode = 'micropython';
        const usesOnboardLed = source.includes('Pin(2, Pin.OUT)') && this.vm.runtime.targets.some(target =>
            Object.values(target.blocks._blocks).some(block => block.opcode === 'esp32gpio_setOnboardLed'));
        if (usesOnboardLed) addOnboardLedCircuit(snapshot, board);
        return snapshot;
    }
}

export default BoardSimulationProject;
