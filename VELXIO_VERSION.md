# Velxio Docker 版本基线

当前已验证的本地仿真 Docker 镜像：

- 镜像：`davidmonterocrespo/velxio:master`
- Velxio Git commit：`7a21d82e4136b87e5110f402a7527f7f81cad5ab`
- 记录日期：2026-09-17

这个版本已包含 2026-09-06～2026-09-07 合并的 ESP32 NeoPixel / WS2812 / RMT 相关修复，因此后续排查 NeoPixel 仿真问题时，不应再默认归因于“Docker 镜像过旧”。

## 本机检查命令

检查镜像对应的 Git commit：

```bash
docker inspect davidmonterocrespo/velxio:master \
  --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}'
```

检查当前运行容器使用的镜像 ID：

```bash
docker inspect scratch-desktop-velxio \
  --format '当前容器={{.Image}} 镜像名={{.Config.Image}}'
```

检查本地镜像 ID 和创建时间：

```bash
docker image inspect davidmonterocrespo/velxio:master \
  --format 'Image={{.Id}} Created={{.Created}}'
```

## 当前 NeoPixel 排查备注

在上述版本下，ESP32 + MicroPython `neopixel` + Velxio QEMU 仍出现过：

```text
NeoPixel on DIN 23: no pixel data reached this part
```

已确认的测试条件：

- 元件：`neopixel-matrix`
- DIN：GPIO23
- GND：ESP32 GND
- VCC：ESP32 3V3
- MicroPython 使用 `neopixel.NeoPixel(Pin(23), count)` + `write()`

当前判断：无需额外先执行 `Pin(23, Pin.OUT)`；后续应优先继续排查 Velxio 的 ESP32 QEMU RMT / WS2812 frame 结束事件链路，而不是 GPIO23 初始化状态。
