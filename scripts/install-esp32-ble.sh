#!/usr/bin/env bash
set -euo pipefail

port='/dev/cu.usbserial-019455EF'
library_dir='static/board-programming/bipes/pylibs'
boot_file='static/board-programming/firmware/boot.py'

for module in ble_advertising ble_uart_peripheral ble_uart_repl; do
    uvx --from mpremote mpremote connect "$port" fs cp "$library_dir/$module.py" ":$module.py"
done
uvx --from mpremote mpremote connect "$port" fs cp "$boot_file" ':boot.py'
uvx --from mpremote mpremote connect "$port" reset
echo '蓝牙服务文件已安装，开发板已重启。'
