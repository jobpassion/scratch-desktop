# AI 开发说明

## ESP32 MicroPython BLE UART 连接状态

项目使用 `static/board-programming/bipes/pylibs/ble_uart_peripheral.py` 和
`ble_uart_repl.py` 提供 ESP32 的 BLE UART / REPL。修改、同步或更新这两个模块时，
必须保留 `BLEUART._irq` 中 `_IRQ_GATTS_WRITE` 的连接状态自愈逻辑：

```python
elif event == _IRQ_GATTS_WRITE:
    conn_handle, value_handle = data
    self._connections.add(conn_handle)
    if value_handle == self._rx_handle:
        self._rx_buffer += self._ble.gatts_read(self._rx_handle)
        if self._handler:
            self._handler()
```

**不要恢复 MicroPython 示例原有的**
`conn_handle in self._connections and value_handle == self._rx_handle` **判断**，也不要把
`self._connections.add(conn_handle)` 再移回 RX handle 判断内部。

曾在旧 Mac 上确认：BLE 已连接，ATT Write Request 收到 Write Response，
ESP32 的 GATT RX handle 19 能读到写入内容，`_IRQ_GATTS_WRITE` 也收到
`(conn_handle=0, value_handle=19)`，但 `_connections` 仍是空集合。
原判断因此丢弃 RX 数据；`BLEUART.write()` 遍历空集合也无法发送 Notify，
表现为能连接却双向没有 REPL 通信。

后续又确认同一问题会影响“板上输出”：Web Bluetooth 已订阅 TX Notify，但旧 Mac
如果仍遗漏 `_IRQ_CENTRAL_CONNECT`，在电脑尚未向 RX 写数据前 `_connections` 仍为空，
开发板 `print()` 经 BLE UART 输出时会被直接丢弃。MicroPython 的 `_IRQ_GATTS_WRITE`
既可能来自 characteristic，也可能来自 descriptor；因此任何 GATT 写都应先补登记
`conn_handle`。这样客户端启用 Notify 时写 CCCD，也能帮助恢复连接状态。

桌面端 `src/renderer/board/ESP32Bluetooth.js` 还必须保留连接后的主动握手：
订阅 TX Notify 后，在非 Raw REPL 状态向 RX 做一次零长度写；如果当前
Chromium/macOS 不接受零长度写，则退回发送一个回车。这个握手用于兼容尚未更新
`ble_uart_peripheral.py` 的旧开发板，确保旧 Mac 也能触发已有的 RX 写自愈逻辑。
不要在重构连接流程时删除这一步。

更新官方 MicroPython 示例、重构 BLE 代码或向板上复制模块后，检查上述两层保护
没有被覆盖。回归时至少验证：

1. 旧 Mac 写入 REPL 命令后能收到应答；
2. 旧 Mac 仅完成连接和 Notify 订阅后，开发板打印内容能到达“板上输出”；
3. “板上输出”只显示打印积木内容，不显示内部标记、MicroPython 启动日志或 REPL 提示；
4. 新 Mac 的发送、重连和板上输出仍正常。

只看到串口打印不代表 BLE 输出正常。
