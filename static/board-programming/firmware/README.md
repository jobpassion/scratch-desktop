# ESP32 首次安装

适用于经典 ESP32、4 MB Flash 开发板。根据实际芯片选择官方 MicroPython
固件；该目录不包含 MicroPython 固件二进制文件。

首次安装会替换板上现有固件和文件，须先备份整片 Flash。安装官方固件后，
将 `../bipes/pylibs/` 下三个 BLE 模块和本目录的 `boot.py`
复制到开发板根目录，重启。
`boot.py` 启动 BIPES 兼容的 BLE REPL；用户程序单独保存为 `main.py`。
更新板上蓝牙收发功能时，只需重新复制 `ble_uart_peripheral.py` 并重启开发板，
无需擦除 Flash。收到 RX 写入时会补登记连接，避免部分 macOS 设备遗漏连接事件后无法收发。

若用户程序导致蓝牙 REPL 无法响应，仍可通过 USB 串口恢复。

2026-09-13 在 ESP32-D0WDQ6、4 MB Flash 开发板上验证：
MicroPython `ESP32_GENERIC` v1.29.0 启动成功，BLE 广播名为 `YY-Board`，
Nordic UART Service 可连接，蓝牙 REPL 能执行并返回测试命令。
