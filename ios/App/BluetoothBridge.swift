import Foundation
import CoreBluetooth

final class BluetoothBridge: NSObject, CBCentralManagerDelegate, CBPeripheralDelegate {
    private let serviceUUID = CBUUID(string: "6E400001-B5A3-F393-E0A9-E50E24DCCA9E")
    private let rxUUID = CBUUID(string: "6E400002-B5A3-F393-E0A9-E50E24DCCA9E")
    private let txUUID = CBUUID(string: "6E400003-B5A3-F393-E0A9-E50E24DCCA9E")

    private lazy var central = CBCentralManager(delegate: self, queue: .main)
    private var peripheral: CBPeripheral?
    private var rxCharacteristic: CBCharacteristic?
    private var txCharacteristic: CBCharacteristic?
    private var connectCompletion: ((Result<Void, Error>) -> Void)?
    private var pendingConnectAfterPowerOn = false
    private var writeCompletions: [(Result<Void, Error>) -> Void] = []
    private var scanTimer: Timer?

    var eventSink: ((String, Any) -> Void)?

    var connected: Bool {
        peripheral?.state == .connected && rxCharacteristic != nil && txCharacteristic != nil
    }

    func connect(completion: @escaping (Result<Void, Error>) -> Void) {
        if connected {
            completion(.success(()))
            return
        }
        if connectCompletion != nil {
            completion(.failure(BridgeError.busy))
            return
        }
        connectCompletion = completion

        switch central.state {
        case .poweredOn:
            startScanning()
        case .unknown, .resetting:
            pendingConnectAfterPowerOn = true
            _ = central
        case .poweredOff:
            finishConnect(.failure(BridgeError.bluetoothPoweredOff))
        case .unauthorized:
            finishConnect(.failure(BridgeError.bluetoothUnauthorized))
        case .unsupported:
            finishConnect(.failure(BridgeError.bluetoothUnsupported))
        @unknown default:
            finishConnect(.failure(BridgeError.bluetoothUnavailable))
        }
    }

    func disconnect(completion: @escaping (Result<Void, Error>) -> Void) {
        scanTimer?.invalidate()
        scanTimer = nil
        central.stopScan()
        if let peripheral, peripheral.state != .disconnected {
            central.cancelPeripheralConnection(peripheral)
        }
        rxCharacteristic = nil
        txCharacteristic = nil
        eventSink?("bluetoothState", ["connected": false])
        completion(.success(()))
    }

    func write(_ data: Data, completion: @escaping (Result<Void, Error>) -> Void) {
        guard let peripheral, peripheral.state == .connected, let rxCharacteristic else {
            completion(.failure(BridgeError.notConnected))
            return
        }
        writeCompletions.append(completion)
        peripheral.writeValue(data, for: rxCharacteristic, type: .withResponse)
    }

    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        if pendingConnectAfterPowerOn {
            pendingConnectAfterPowerOn = false
            switch central.state {
            case .poweredOn:
                startScanning()
            case .poweredOff:
                finishConnect(.failure(BridgeError.bluetoothPoweredOff))
            case .unauthorized:
                finishConnect(.failure(BridgeError.bluetoothUnauthorized))
            case .unsupported:
                finishConnect(.failure(BridgeError.bluetoothUnsupported))
            default:
                finishConnect(.failure(BridgeError.bluetoothUnavailable))
            }
        }
    }

    private func startScanning() {
        guard central.state == .poweredOn else {
            finishConnect(.failure(BridgeError.bluetoothUnavailable))
            return
        }
        central.stopScan()
        scanTimer?.invalidate()
        scanTimer = Timer.scheduledTimer(withTimeInterval: 10, repeats: false) { [weak self] _ in
            self?.central.stopScan()
            self?.finishConnect(.failure(BridgeError.deviceNotFound))
        }
        central.scanForPeripherals(withServices: nil, options: [
            CBCentralManagerScanOptionAllowDuplicatesKey: false
        ])
    }

    func centralManager(_ central: CBCentralManager,
                        didDiscover peripheral: CBPeripheral,
                        advertisementData: [String: Any],
                        rssi RSSI: NSNumber) {
        let name = (advertisementData[CBAdvertisementDataLocalNameKey] as? String) ??
            peripheral.name ?? ""
        guard name.hasPrefix("YY-Board") || name.hasPrefix("MPY ESP32") else {
            return
        }

        scanTimer?.invalidate()
        scanTimer = nil
        central.stopScan()
        self.peripheral = peripheral
        peripheral.delegate = self
        central.connect(peripheral)
    }

    func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        peripheral.discoverServices([serviceUUID])
    }

    func centralManager(_ central: CBCentralManager,
                        didFailToConnect peripheral: CBPeripheral,
                        error: Error?) {
        finishConnect(.failure(error ?? BridgeError.connectionFailed))
    }

    func centralManager(_ central: CBCentralManager,
                        didDisconnectPeripheral peripheral: CBPeripheral,
                        error: Error?) {
        rxCharacteristic = nil
        txCharacteristic = nil
        eventSink?("bluetoothState", [
            "connected": false,
            "message": error?.localizedDescription ?? ""
        ])
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        if let error {
            finishConnect(.failure(error))
            return
        }
        guard let service = peripheral.services?.first(where: { $0.uuid == serviceUUID }) else {
            finishConnect(.failure(BridgeError.serviceMissing))
            return
        }
        peripheral.discoverCharacteristics([rxUUID, txUUID], for: service)
    }

    func peripheral(_ peripheral: CBPeripheral,
                    didDiscoverCharacteristicsFor service: CBService,
                    error: Error?) {
        if let error {
            finishConnect(.failure(error))
            return
        }
        rxCharacteristic = service.characteristics?.first(where: { $0.uuid == rxUUID })
        txCharacteristic = service.characteristics?.first(where: { $0.uuid == txUUID })
        guard rxCharacteristic != nil, let txCharacteristic else {
            finishConnect(.failure(BridgeError.characteristicMissing))
            return
        }
        peripheral.setNotifyValue(true, for: txCharacteristic)
    }

    func peripheral(_ peripheral: CBPeripheral,
                    didUpdateNotificationStateFor characteristic: CBCharacteristic,
                    error: Error?) {
        guard characteristic.uuid == txUUID else { return }
        if let error {
            finishConnect(.failure(error))
            return
        }
        guard characteristic.isNotifying else {
            finishConnect(.failure(BridgeError.notificationFailed))
            return
        }
        eventSink?("bluetoothState", ["connected": true])
        finishConnect(.success(()))
    }

    func peripheral(_ peripheral: CBPeripheral,
                    didUpdateValueFor characteristic: CBCharacteristic,
                    error: Error?) {
        guard characteristic.uuid == txUUID, error == nil, let data = characteristic.value else {
            return
        }
        eventSink?("bluetoothNotification", ["data": data.base64EncodedString()])
    }

    func peripheral(_ peripheral: CBPeripheral,
                    didWriteValueFor characteristic: CBCharacteristic,
                    error: Error?) {
        guard !writeCompletions.isEmpty else { return }
        let completion = writeCompletions.removeFirst()
        if let error {
            completion(.failure(error))
        } else {
            completion(.success(()))
        }
    }

    private func finishConnect(_ result: Result<Void, Error>) {
        scanTimer?.invalidate()
        scanTimer = nil
        let completion = connectCompletion
        connectCompletion = nil
        completion?(result)
    }

    enum BridgeError: LocalizedError {
        case busy
        case bluetoothPoweredOff
        case bluetoothUnauthorized
        case bluetoothUnsupported
        case bluetoothUnavailable
        case deviceNotFound
        case connectionFailed
        case serviceMissing
        case characteristicMissing
        case notificationFailed
        case notConnected

        var errorDescription: String? {
            switch self {
            case .busy: return "蓝牙正在连接中。"
            case .bluetoothPoweredOff: return "蓝牙未开启。"
            case .bluetoothUnauthorized: return "没有蓝牙权限。"
            case .bluetoothUnsupported: return "当前设备不支持蓝牙。"
            case .bluetoothUnavailable: return "蓝牙暂不可用。"
            case .deviceNotFound: return "10 秒内未找到 YY-Board 或 MPY ESP32。"
            case .connectionFailed: return "连接开发板失败。"
            case .serviceMissing: return "开发板没有找到 BLE UART 服务。"
            case .characteristicMissing: return "开发板 BLE UART 特征不完整。"
            case .notificationFailed: return "无法订阅开发板输出。"
            case .notConnected: return "ESP32 尚未连接。"
            }
        }
    }
}
