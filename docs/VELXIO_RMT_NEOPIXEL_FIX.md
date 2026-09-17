# Velxio ESP32 RMT / NeoPixel 修复记录

本文记录“一一编程乐园”集成 Velxio ESP32 仿真后，MicroPython `neopixel.NeoPixel.write()` 在 WS2812 / NeoPixel 多灯场景下无法形成完整帧的问题，以及最终已经实际验证通过的 QEMU 修复方案。

> 状态：**已修复并运行验证通过**
>
> 验证日期：2026-09-18
>
> 目标环境：Velxio ESP32 Xtensa / ARM64 Docker

---

## 1. 现象

MicroPython 使用 RMT 驱动 NeoPixel，例如 8 颗 WS2812：

```python
from machine import Pin
import neopixel

np = neopixel.NeoPixel(Pin(23), 8)
np[0] = (255, 0, 0)
np[1] = (0, 255, 0)
np[2] = (0, 0, 255)
np[3] = (255, 255, 0)
np[4] = (255, 0, 255)
np[5] = (0, 255, 255)
np[6] = (255, 80, 0)
np[7] = (120, 0, 255)
np.write()
```

WS2812 每颗灯需要 24 bit，因此 8 颗灯正常应产生：

```text
8 × 24 = 192 个数据 RMT symbol
+ 1 个全 0 EOF / stop symbol
```

问题状态下，Velxio 的 RMT callback 日志始终只有：

```text
192 条
```

最后一个 `0x00000000` EOF 永远没有进入 Python callback，因此 `_RmtDecoder` 无法知道一帧已经结束，也就不能稳定输出完整 `ws2812_update`。

---

## 2. 不正确的临时方案

调试期间曾用过一个只用于验证的临时代码：

```text
每收到 24 bit 就直接 flush 一个像素
```

它可以验证单颗 1×1 NeoPixel，但**不能作为正式方案**。

原因：

- WS2812 一帧可以包含任意数量的灯；
- 每 24 bit flush 会把一个多灯帧拆成多个伪帧；
- 无法正确处理 8、64 或更多像素；
- 连续帧之间也可能串数据。

正式实现必须依赖真实 RMT EOF，而不是按 24 bit 猜帧边界。

---

## 3. 已确认的正确链路

Velxio ESP32 NeoPixel 的链路是：

```text
MicroPython neopixel.write()
    ↓
machine.bitstream
    ↓
ESP-IDF RMT TX driver
    ↓
ESP32 RMT hardware memory
    ↓
Velxio QEMU hw/ssi/esp32_rmt.c
    ↓
picsimlab_rmt_event(...)
    ↓
backend/app/services/esp32_worker.py
    ↓
_RmtDecoder
    ↓
ws2812_update
    ↓
前端 NeoPixel / NeoPixel Matrix
```

Python `_RmtDecoder` 本身没有过滤 `value == 0`。

`_on_rmt_event()` 也是先上报 `rmt_event`，再交给 `_RmtDecoder.feed(value)`，所以日志只有 192 条时，可以确定 EOF 在进入 Python 之前已经丢失。

---

## 4. 第一层问题：QEMU 原本吞掉 EOF callback

Velxio QEMU 的 `hw/ssi/esp32_rmt.c` 原实现中：

```c
if (v == 0) {
    ...
    return;
}

picsimlab_rmt_event(channel, s->conf0[channel], v);
```

也就是说即使 QEMU 读到全 0 RMT stop symbol，也会直接返回，不会把 EOF 传给 Velxio callback。

因此第一层补丁是在 `v == 0` 分支里显式转发：

```c
picsimlab_rmt_event(channel, s->conf0[channel], 0);
```

但是只加这一处后，运行仍然只有 192 条 callback。

这说明真正的主根因还在更前面：**QEMU 根本没有继续执行到读 EOF 的位置。**

---

## 5. 精确根因：disabled 的 THR raw 位把 QEMU TX 永久卡住

ESP-IDF 5.5.1 的 RMT TX 使用 ping-pong 方式写硬件 RMT 内存。

当前场景中 `txlim = 32`，8 颗灯的 192 个数据 symbol 被 QEMU 分 6 批发送：

```text
0-31
32-63
64-95
96-127
128-159
160-191
```

ESP-IDF 在编码结束后会把全 0 EOF 写入 RMT 内存，并关闭 THR interrupt，因为已经不需要继续补数据。

问题在 Velxio QEMU 的人工暂停逻辑。

原逻辑只检查 `int_raw`：

```c
if (s->int_raw & ((1 << (channel + 24)) | (1 << (channel * 3)))) {
    s->unsent_data = true;
    return;
}
```

最后 32 个数据发完后，QEMU 仍会设置 THR raw 位。

但此时 ESP-IDF 已经关闭 THR interrupt，所以：

- THR raw = 1；
- THR enable = 0；
- 不会再产生 IRQ；
- guest 固件不会再处理并清掉这个 THR raw；
- QEMU 下一次进入 `send_data()` 时只看到 raw=1，就直接 return；
- 已经写在 RMT 内存里的 EOF 永远不会被读取。

因此现象刚好稳定停在：

```text
192 个数据 callback
0 个 EOF callback
```

这与 8×24 的数据长度完全对应。

---

## 6. 最终修复

最终补丁同时包含两个必要修改。

### 6.1 只等待当前仍启用的中断

将：

```c
if (s->int_raw & ((1 << (channel + 24)) | (1 << (channel * 3)))) {
```

改为：

```c
if ((s->int_raw & s->int_en) &
    ((1 << (channel + 24)) | (1 << (channel * 3)))) {
```

含义：

- `int_raw` 仍然保留真实 raw 状态；
- QEMU 自己为了等待 guest 处理 IRQ 的“人工暂停”，只针对当前确实 enabled 的中断；
- 已经 disabled 的 THR raw 不再阻止 TX 继续读取后续 RMT 内存；
- EOF 因此可以被正常读到。

这比“THR disabled 时直接不设置 raw”更合理，因为它没有篡改硬件 raw 状态语义，只修正了 QEMU 自己的等待条件。

### 6.2 把真实 EOF 转给 Velxio callback

在：

```c
if (v == 0) {
```

分支中加入：

```c
picsimlab_rmt_event(channel, s->conf0[channel], 0);
```

这样 `_RmtDecoder` 才能收到真正的帧结束事件，并一次性 flush 本帧所有完整像素。

---

## 7. 仓库中的补丁

补丁文件：

```text
patches/qemu/esp32-rmt-forward-tx-terminator.patch
```

最终根因修复提交：

```text
2b5efa9392026d358e0ba5595e9be3d2d2bd2796
fix(qemu): avoid stale disabled RMT threshold stall
```

不要重新引入“每 24 bit 强制 flush”逻辑。

---

## 8. QEMU 源码来源要求

不能使用普通 upstream `lcgamboa/qemu` 替代 Velxio 自己的 QEMU。

Velxio 的 QEMU 包含额外机器和设备实现，例如：

```text
esp32s3-picsimlab
hw/ssi/esp32s3_gpspi.c
hw/i2c/esp32_ov2640.c
hw/misc/esp32_i2s_cam.c
hw/misc/velxio_camera_export.c
```

本次实际成功构建使用的源码 asset：

```text
qemu-source-83096d03
```

来源是 Velxio 官方 license download endpoint 对应的 source archive。

不要再从公共 upstream QEMU 直接构建并替换，否则虽然 `.so` 可能能加载，但 Velxio 的专有设备/回调链不完整，RMT 等功能可能完全不触发。

---

## 9. ARM64 构建流程

仓库已有 GitHub Actions：

```text
.github/workflows/build-libqemu-esp32.yml
```

它会：

1. 使用 `VELXIO_LICENSE_KEY` 下载 Velxio QEMU source archive；
2. 选择对应源码；
3. 应用：

```text
patches/qemu/esp32-rmt-forward-tx-terminator.patch
```

4. 调用 Velxio source archive 自带的：

```text
build_libqemu-esp32.sh
```

5. 验证 ARM64 架构和 Velxio callback ABI；
6. 上传 `libqemu-xtensa.so` artifact。

本次最终成功 workflow：

```text
run id: 35251257103
```

所有关键步骤均成功：

```text
Apply RMT frame-end patch     success
Build shared library          success
Verify artifact and ABI       success
Upload artifact               success
```

---

## 10. 本次最终 ARM64 产物

最终测试使用的 patched `.so` SHA256：

```text
a83831f1eb9ee3204eb93bdfe225d3e0a42565650993b681704ea6fbfdd6191a
```

运行位置：

```text
/app/lib/libqemu-xtensa.so
```

替换后必须让 QEMU 进程重新加载 `.so`。只覆盖磁盘文件但继续使用旧进程是不够的。

---

## 11. 验证程序

最终使用下面这种高对比动画验证 8 颗灯，比白色和灰色更容易肉眼检查：

```python
from machine import Pin
import neopixel
import time

PIN = 23
COUNT = 8

np = neopixel.NeoPixel(Pin(PIN), COUNT)

colors = [
    (255, 0, 0),
    (0, 255, 0),
    (0, 0, 255),
    (255, 255, 0),
    (255, 0, 255),
    (0, 255, 255),
    (255, 80, 0),
    (120, 0, 255),
]

def clear():
    for i in range(COUNT):
        np[i] = (0, 0, 0)
    np.write()

clear()

for _ in range(3):
    for i in range(COUNT):
        clear()
        np[i] = colors[i]
        np.write()
        time.sleep_ms(400)

for i in range(COUNT):
    np[i] = colors[i]
np.write()
time.sleep(2)

for color in [
    (255, 0, 0),
    (0, 255, 0),
    (0, 0, 255),
]:
    for _ in range(2):
        for i in range(COUNT):
            np[i] = color
        np.write()
        time.sleep_ms(500)
        clear()
        time.sleep_ms(300)

for i in range(COUNT):
    np[i] = colors[i]
np.write()
```

实际验证结果：

- 8 颗灯都能逐颗点亮；
- 8 种颜色顺序正确；
- 全排红 / 绿 / 蓝动画正常；
- 最终 8 颗灯均能保持各自颜色；
- 不再出现只适用于 1×1 的行为。

因此本次修复已经通过实际运行验证。

---

## 12. 后续回归测试

以后如果升级 Velxio QEMU、ESP-IDF、MicroPython 或重新生成 `.so`，至少回归：

1. 1 颗 NeoPixel；
2. 8 颗 NeoPixel；
3. 64 颗 NeoPixel；
4. 连续多次 `np.write()`；
5. 全亮 → 全灭；
6. 不同长度的 strip；
7. 每个 EOF 只能形成一帧；
8. 前一帧数据不能泄漏到后一帧；
9. RMT 其它用途不能因为 THR 修复而异常。

调试日志应重点检查：

```text
N × 24 个数据 RMT item
+ 1 个 value=0 的 EOF
```

例如 8 颗灯单帧理论上应看到：

```text
192 data + 1 EOF = 193 callback
```

---

## 13. 后续开发禁止回退的结论

- 不要使用“每 24 bit flush 一帧”的临时代码。
- 不要只修改 Python `_RmtDecoder` 来掩盖 QEMU 丢帧边界的问题。
- 不要用未修改的 public upstream QEMU 替换 Velxio QEMU。
- 不要仅凭 `.so` 能加载就判断 QEMU 版本兼容。
- RMT 多灯问题优先按 `ESP-IDF → RMT memory → QEMU send_data → callback → decoder` 分层定位。
- 如果以后再次出现“数据数量刚好正确，但没有 EOF”，优先检查 THR raw / enable / clear / TX_END 状态机。
