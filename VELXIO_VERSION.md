# Velxio Docker 版本基线与 NeoPixel / RMT 排查进展

> 最后更新：2026-09-17
>
> 这份文档用于记录 `scratch-desktop` 中 ESP32 + Velxio + MicroPython NeoPixel / WS2812 仿真问题的完整排查状态。后续新的 AI 对话应先阅读本文档，再继续处理，避免重复走已经排除的路径。

## 1. 当前环境

项目：`jobpassion/scratch-desktop`

当前桌面版分支：`main`

本地 Velxio：

- Docker 镜像：`davidmonterocrespo/velxio:master`
- 当前容器名：`scratch-desktop-velxio`
- Velxio Git commit：`7a21d82e4136b87e5110f402a7527f7f81cad5ab`
- 本机：Apple Silicon Mac，仅需要 ARM64 / AArch64 版本
- 容器架构已确认：`aarch64`

检查命令：

```bash
docker exec scratch-desktop-velxio uname -m
```

当前输出：

```text
aarch64
```

Docker 中 Xtensa QEMU 库路径：

```text
/app/lib/libqemu-xtensa.so
```

Velxio Docker 配置中 `QEMU_ESP32_LIB` 也明确指向这个路径，因此此前替换 `/app/lib/libqemu-xtensa.so` 的位置是正确的。

---

## 2. 问题现象

目标是在 Velxio ESP32 仿真中支持 WS2812 / NeoPixel，先测试 1×8 灯带。

MicroPython 测试方式：

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
np[6] = (255, 255, 255)
np[7] = (64, 64, 64)

np.write()
print("WRITE DONE")
```

当前现象：

- Python 代码正常执行
- 前端灯不亮
- DevTools WebSocket 中没有 `ws2812_update`
- 当前正式 decoder 不会提前按 24 bit 刷新，而是等待 RMT frame end

---

## 3. Python `_RmtDecoder` 当前正式逻辑

文件：

```text
/app/app/services/esp32_worker.py
```

当前 decoder 已恢复正式逻辑，不再使用之前仅用于诊断 1×1 NeoPixel 的“每 24 bit 直接 return”临时代码。

核心逻辑：

```python
class _RmtDecoder:
    """Accumulate RMT items for one channel; flush complete WS2812 frames."""

    def __init__(self, channel: int):
        self.channel  = channel
        self._bits:   list[int] = []
        self._pixels: list[dict] = []

    @staticmethod
    def _bits_to_byte(bits: list[int], offset: int) -> int:
        val = 0
        for i in range(8):
            val = (val << 1) | bits[offset + i]
        return val

    def feed(self, value: int) -> list[dict] | None:
        level0, dur0, _level1, dur1 = _decode_rmt_item(value)

        # Reset pulse / all-zero RMT item = end of frame
        if dur0 == 0 and dur1 == 0:
            pix = list(self._pixels)
            self._pixels.clear()
            self._bits.clear()
            return pix or None

        if level0 == 1 and dur0 > 0:
            self._bits.append(1 if dur0 > dur1 else 0)

        while len(self._bits) >= 24:
            g = self._bits_to_byte(self._bits, 0)
            r = self._bits_to_byte(self._bits, 8)
            b = self._bits_to_byte(self._bits, 16)
            self._pixels.append({'r': r, 'g': g, 'b': b})
            self._bits = self._bits[24:]

        return None
```

这个逻辑目前判断正确：一个 WS2812 frame 应该累计全部 `24 × N` bit，直到收到 RMT TX 结束标记后一次性输出整串 pixels。

不要再恢复“每 24 bit 就 return 一个 pixel”的临时诊断版本，否则 1×N 灯带会被错误拆成 N 个独立 frame。

---

## 4. 已验证：原版 Velxio QEMU 普通 RMT callback 正常

为了绕过 `docker logs` 可能吞掉 worker stderr 的问题，曾临时让 `_on_rmt_event()` 直接写：

```text
/tmp/rmt-debug.log
```

用 Velxio Docker 原本自带的 ARM64 `libqemu-xtensa.so` 运行 1×8 NeoPixel 后，结果：

```text
RMT CALLBACK FIRED
192 /tmp/rmt-debug.log
```

尾部示例：

```text
0 0x1000002 0x00228010
0 0x1000002 0x00228010
0 0x1000002 0x00128020
...
```

192 条记录非常关键：

```text
8 pixels × 24 bit = 192 RMT items
```

因此已经明确证明：

```text
MicroPython np.write()
  -> ESP32 QEMU RMT
  -> picsimlab_rmt_event
  -> Python _on_rmt_event()
```

对于普通数据位，这整条链路是通的。

---

## 5. 已定位根因：QEMU 吃掉了 RMT TX terminator

原版 Velxio ARM64 QEMU 的 192 条 callback 中：

**没有任何一条：**

```text
value = 0x00000000
```

这与 lcgamboa QEMU 的 `hw/ssi/esp32_rmt.c` 实现吻合。

当前 `send_data()` 的关键逻辑类似：

```c
if (v == 0) { // stop sending when we see a zero
    s->int_raw |= (1 << (channel * 3));
    s->int_raw &= ~(1 << (channel + 24));
    s->sent = 0;
    s->conf1[channel] &= ~R_RMT_CHnCONF1_TX_START_MASK;
    if (s->int_en & (1 << (channel * 3)))
        qemu_irq_raise(s->irq);
    return;
}

if (ssc) {
    ssc->transfer(slave, v);
}

picsimlab_rmt_event(channel, s->conf0[channel], v);
```

问题就在：

```c
if (v == 0)
```

分支直接 `return`，发生在：

```c
picsimlab_rmt_event(...)
```

之前。

因此 WS2812 的 all-zero RMT 结束 item 被 QEMU 自己消费掉，host callback 永远收不到 frame end。

最终导致：

```text
192 个 RMT bit 全部收到
  -> decoder 正确解析出 8 个 pixel 并存在 self._pixels
  -> decoder 等待 all-zero frame end
  -> QEMU 没有把 v==0 转发给 host
  -> decoder 永远不 return pixels
  -> 没有 ws2812_update
  -> 前端灯不亮
```

### 正确的 QEMU 修复方向

应在 `v == 0` 分支中，在 `return` 之前增加：

```c
picsimlab_rmt_event(channel, s->conf0[channel], 0);
```

也就是类似：

```c
if (v == 0) { // stop sending when we see a zero
    /*
     * RMT memory uses an all-zero item as the TX terminator.
     * Keep it out of the SSI data stream, but expose the real
     * TX frame boundary to libqemu host callbacks.
     */
    picsimlab_rmt_event(channel, s->conf0[channel], 0);

    s->int_raw |= (1 << (channel * 3));
    s->int_raw &= ~(1 << (channel + 24));
    s->sent = 0;
    s->conf1[channel] &= ~R_RMT_CHnCONF1_TX_START_MASK;
    if (s->int_en & (1 << (channel * 3)))
        qemu_irq_raise(s->irq);
    return;
}
```

修复后，1×8 NeoPixel 一次 `np.write()` 的 RMT callback 数量理论上应从：

```text
192
```

变成：

```text
193
```

第 193 条应为：

```text
value = 0x00000000
```

随后 `_RmtDecoder.feed(0)` 会一次性返回 8 个 pixels，生成一个 `ws2812_update`。

---

## 6. 之前的 1×1 临时代码只用于定位，不是最终方案

此前为了判断颜色 bit 解码是否正确，曾临时修改 `_RmtDecoder.feed()`：每累积 24 bit 就直接输出一个 pixel。

该方法使 1×1 NeoPixel 成功工作，因此证明：

- 普通 RMT 数据可以传到 Python
- GRB -> RGB 解码路径是可用的
- `dur0 > dur1` 区分 WS2812 0/1 bit 的逻辑可用
- 真正缺少的是 frame boundary

但它不能作为最终实现，因为 1×8 会变成 8 个分开的 frame，而不是一个包含 8 pixels 的 frame。

当前已经恢复正式 decoder，不要再重新引入这个 workaround。

---

## 7. 一次错误尝试：从上游 `lcgamboa/qemu` 直接编 ARM64

`scratch-desktop` 中曾新增 GitHub Actions：

```text
.github/workflows/build-libqemu-esp32.yml
```

并新增 patch：

```text
patches/qemu/esp32-rmt-forward-tx-terminator.patch
```

该 workflow 从：

```text
https://github.com/lcgamboa/qemu.git
branch: picsimlab-esp32
```

直接构建 `libqemu-xtensa.so`。

相关提交包括：

```text
91d84f043df345bba5cd7a5da72115e084ff5635
2376aef4a6d96e9b4b49d3d8d5fe2c8c1a98054f
1646f30c04b29fb27da38edcf6f303119cab39c5
ca8a4841151ec23869a4938e45b32e243c1b8bcf
73abf4170cdc6112e2d27fa49a0dddfbdd77c89a
81b338074b70a67645bebad5de169923106249f7
c87d49c345f14fadae377e8a57303e7cac4937a5
```

最终 ARM64 artifact 能正常构建，且：

```text
ELF 64-bit LSB shared object, ARM aarch64
```

放入容器后的 hash 为：

```text
73f128f0dd6389f71d52ec39eca4cebd8440886d1ba22f962250929d309fb389
```

并且：

```bash
python3 -c "import ctypes; ctypes.CDLL('/app/lib/libqemu-xtensa.so'); print('QEMU OK')"
```

能输出：

```text
QEMU OK
```

但是这个新库运行 NeoPixel 时：

```text
NO RMT CALLBACK
```

即普通 RMT callback 都没有进入 Python。

### 原因也已经定位

Velxio 当前官方构建文档明确说明：

> 不要直接从未修改的 `lcgamboa/qemu` 构建 Velxio 的替换库。

Velxio 实际发布的 QEMU 包含其自己维护的额外修改，例如 Velxio 所需的 machine、设备模型和 host callback 相关改动。直接编 upstream `lcgamboa/qemu` 不能保证是 drop-in replacement。

因此：

**当前 GitHub workflow 直接 clone `lcgamboa/qemu` 的路线是错误基线，不应继续用它生产正式 QEMU 库。**

原版 `.so` 已恢复后，RMT callback 重新正常出现 192 条，也再次证明这个判断正确。

---

## 8. 正确的下一步

下一步不要继续修改 Python，也不要继续基于 upstream `lcgamboa/qemu` 编译。

应该：

1. 确认当前 Docker 镜像使用的 Velxio QEMU binary 对应哪个 QEMU source archive / commit。
2. 获取 Velxio 官方提供的对应 `qemu-source-<commit>` 源码包。
3. 使用该 Velxio QEMU 源码树，而不是 upstream `lcgamboa/qemu`。
4. 只修改 ESP32 RMT `v == 0` 分支：

```c
picsimlab_rmt_event(channel, s->conf0[channel], 0);
```

5. 用 Velxio 源码包内自带的 `build_libqemu-esp32.sh` / 官方构建方式编 ARM64 `libqemu-xtensa.so`。
6. 替换当前容器：

```text
/app/lib/libqemu-xtensa.so
```

7. 重新运行 1×8 测试。
8. 临时检查 `/tmp/rmt-debug.log`，预期：

```text
193 entries
```

且最后出现：

```text
0x00000000
```

9. DevTools WebSocket 中预期出现一个：

```text
ws2812_update
```

并包含：

```text
pixels.length == 8
pin == 23
```

10. 1×8 成功后，再测试：

- 8×8 / 64 pixels
- 连续多次 `np.write()`
- 全亮 -> 全灭
- 不同 frame 之间不能串数据

---

## 9. Velxio 官方 QEMU 源码获取线索

Velxio 当前构建文档说明，其发布的 QEMU binary 对应源码以类似下面的名称提供：

```text
qemu-source-<commit>
```

文档中的示例形式：

```bash
curl "https://velxio.dev/api/pro/license/downloads?key=$VELXIO_LICENSE_KEY"
```

然后从下载列表找到与当前 binary 对应的：

```text
qemu-source-<commit>
```

再下载对应源码包。

注意：示例中的具体 commit 不能直接假设就是当前 Docker 镜像正在使用的版本，必须先确认当前 binary / 下载清单对应关系。

---

## 10. 当前不要再重复排查的方向

以下方向已经有明确结论，新对话不要重新从头尝试：

- GPIO23 是否需要额外先 `Pin(23, Pin.OUT)`：不是当前根因。
- 前端 NeoPixel renderer：当前问题发生在产生 `ws2812_update` 之前。
- WebSocket：当前原版 QEMU 只有普通 RMT item，没有 frame end，因此 decoder 本身不会生成 `ws2812_update`。
- Python GRB/RGB 解码：1×1 临时测试已经证明普通 bit 解码可行。
- `_CallbacksT` ARM64 对齐 / 字段错位：Python 和 QEMU callback struct 顺序已经核对一致，不是当前根因。
- Docker `.so` 路径错误：`QEMU_ESP32_LIB=/app/lib/libqemu-xtensa.so`，替换路径正确。
- ARM64 架构错误：容器是 `aarch64`，之前自行编译的测试库也是 ARM aarch64 且能 `ctypes.CDLL()`；其失败原因是 QEMU 源码基线不对，不是 CPU 架构不对。

---

## 11. 最终根因一句话

**Velxio 原版 ESP32 QEMU 能把 WS2812 的全部 24×N 个 RMT 数据 item 送进 Python，但在 `hw/ssi/esp32_rmt.c` 中遇到 all-zero TX terminator 时直接 return，没有把这个 frame-end item 通过 `picsimlab_rmt_event()` 转给 host；而 Python decoder 正是依赖该 terminator 一次性 flush 整个 NeoPixel frame。**

正确修复应该基于 **Velxio 对应版本自己的 QEMU source archive**，而不是直接基于 upstream `lcgamboa/qemu`。
