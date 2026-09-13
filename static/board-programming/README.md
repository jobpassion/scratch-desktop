# 板上编程

板上模式沿用 Scratch 编辑界面，筛选可转换的积木。应用将绿旗脚本转换为
MicroPython，通过 ESP32 的 BLE UART REPL 写入 `main.py`；写入后校验文件
大小和 SHA-256，再重启开发板运行。首次蓝牙授权需手动点击连接，之后会自动重连。

`bipes/pylibs/` 中的三个 BLE 模块来自 BIPES
（https://github.com/BIPES/BIPES，提交
`4ddd6ca7efbd6249e928f624afc99b6363daae1c`），依据 GPL-3.0 发布，
许可证见 `BIPES-LICENSE`。仓库仅跟踪固件安装所需的三个模块；其余 BIPES
离线编辑器文件不属于当前板上模式，也不会打入应用。

首次安装和板上固件说明见 `firmware/README.md`。

## 仿真板

仿真模式默认在 macOS 本机通过 Docker Desktop 一键启动 Velxio。首次点击
“仿真板运行”时，应用会下载与 Mac 架构匹配的镜像，创建名为
`scratch-desktop-velxio` 的容器，之后复用它。镜像是
`davidmonterocrespo/velxio:master`（Docker Hub），服务监听本机所有网络接口的
`3080` 端口，局域网其他电脑可在“仿真服务设置”中填写 `http://本机局域网IP:3080`。
使用前需安装 Docker Desktop；应用会尝试在后台启动它。
已有旧版 GHCR 容器时，首次启动会下载新镜像并替换应用创建的容器，保留命名卷。

也可以在“仿真服务设置”中填写远程 Velxio 服务地址；点击“使用本机 Docker”
可切回本机模式。容器在 Docker Desktop 中可查看日志、停止或删除。

板上模式的“仿真板运行”会把当前 Scratch 绿旗脚本转换成 `main.py`，连同
此前保存的元件、连线送进 Velxio 并运行。保存 Scratch 作品时，应用读取仿真
窗口的最新 `.vlx` 快照，写入同一个 `.sb3` 的 `board-simulation.vlx` 文件；
重新打开作品时恢复它。关闭仿真窗口也会将快照带回应用。

仿真窗口会等待 Velxio 的停止按钮变为可用，才确认 ESP32 已进入运行状态。
Velxio 当前的 ESP32 板图是静态图片。使用“板载 LED (GPIO2)”积木时，
仿真电路会自动添加一颗标注为板载 LED 的指示灯和 220Ω 限流电阻，
按 GPIO2 → 电阻 → LED → GND 连接，
用它显示板载灯的运行状态。
可在仿真器里观察 GPIO2 的引脚状态。电路元件和连线的撤回由 Velxio 自己处理。

Velxio 来源：https://github.com/davidmonterocrespo24/velxio ，依据 AGPLv3
提供开源版本；当前项目同样采用 AGPL-3.0-only。发布应用前仍需固定镜像版本并
完成端到端验证。
