# AI 开发说明

## ESP32 MicroPython BLE UART 连接状态

项目使用 `static/board-programming/bipes/pylibs/ble_uart_peripheral.py` 和
`ble_uart_repl.py` 提供 ESP32 的 BLE UART / REPL。修改、同步或更新这两个模块时，
必须保留 `BLEUART._irq` 中 `_IRQ_GATTS_WRITE` 的连接状态自愈逻辑：

```python
elif event == _IRQ_GATTS_WRITE:
    conn_handle, value_handle = data
    if value_handle == self._rx_handle:
        self._connections.add(conn_handle)
        self._rx_buffer += self._ble.gatts_read(self._rx_handle)
        if self._handler:
            self._handler()
```

**不要恢复 MicroPython 示例原有的**
`conn_handle in self._connections and value_handle == self._rx_handle` **判断**。
曾在旧 Mac 上确认：BLE 已连接，ATT Write Request 收到 Write Response，
ESP32 的 GATT RX handle 19 能读到写入内容，`_IRQ_GATTS_WRITE` 也收到
`(conn_handle=0, value_handle=19)`，但 `_connections` 仍是空集合。
原判断因此丢弃 RX 数据；`BLEUART.write()` 遍历空集合也无法发送 Notify，
表现为能连接却双向没有 REPL 通信。收到真实 RX 写入时补登记连接即可恢复收发。

更新官方 MicroPython 示例、重构 BLE 代码或向板上复制模块后，检查上述逻辑
没有被覆盖。回归时至少验证旧 Mac 写入 REPL 命令后能收到应答，并验证开发板
打印内容能通过 BLE Notify 到达“板上输出”。只看到串口打印不代表 BLE 输出正常。
