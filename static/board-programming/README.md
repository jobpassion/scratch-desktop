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
