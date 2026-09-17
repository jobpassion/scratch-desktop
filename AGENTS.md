# AI 开发说明

## 项目身份与当前分支

本仓库最初来自官方 `scratchfoundation/scratch-desktop`，之后已经做了较多产品化和硬件相关改造，产品名为 **“一一编程乐园”**。后续 AI 修改代码时不要把它当成“接近官方原版”的仓库处理。

当前 iOS 迁移工作使用分支：`ios-migration-v1`。

- 不要修改 `main`。
- 不要创建 PR。
- 需要改代码时直接提交到 `ios-migration-v1`。
- 桌面 Electron 版本仍需保留，iOS 是新增运行外壳，不是用 iOS 完全替代桌面版。
- iOS Web 构建命令：`npm run build:ios:web`
- iOS Web 输出目录：`ios/App/Web`
- Xcode 工程：`ios/YiyiCoding.xcodeproj`
- 普通代码更新后通常只需 `git pull` 后 Xcode Run；只有 `project.yml` 变化时才需要重新生成 Xcode 工程。

## 从官方 clone 后的主要改造

### 1. 品牌和桌面产品化

官方 Scratch Desktop 已被定制为“一一编程乐园”，包括应用图标、菜单 Logo、部分界面文字和桌面打包配置。后续同步官方代码时不要覆盖这些品牌资源和产品化入口。

### 2. 作品快速保存、恢复和文件处理

在官方 Scratch 的保存逻辑之上增加了更适合桌面教学软件的快速保存能力：

- 顶部增加“保存”按钮；
- 保存 `.sb3` 时使用当前作品标题作为文件名；
- 记住最后一次打开/保存的作品，下次启动自动恢复；
- 支持新建、重命名、打开、另存/导出等场景；
- 修复过“新建作品后误覆盖/删除旧作品”的问题；
- iOS 下文件实际保存在 Documents / `一一编程乐园` 目录，并通过原生文件桥接与“文件”App 交互。

iOS 启动恢复时，原生 `getInitialProjectData` 会返回作品二进制和文件名标题。标题最终需要更新 Scratch Redux 的：

```js
{
    type: 'projectTitle/SET_PROJECT_TITLE',
    title
}
```

当前 iOS 标题恢复逻辑会在启动阶段多次尝试，并在 `projectDidLoad` 后再次恢复，避免被 Scratch 加载流程重置。这个行为已经在真机验证过，不要随意改回普通 `setState` 或只靠 DOM 改值。

### 3. 积木/分类语音播报

增加了面向儿童编程学习的语音辅助：

- 点击积木可播报积木内容；
- 点击积木分类可播报分类名称；
- 对部分中文积木文本做了更自然的口语化转换；
- 桌面端走原有 Electron/系统语音路径；
- iOS 通过 Swift `AVSpeechSynthesizer` 原生播报；
- iOS 触摸事件使用 `pointerdown`，不要改回只监听 `mousedown`，否则 iPhone/iPad 上会失效。

### 4. ESP32 板上编程

这是仓库相对官方版最重要的一组功能之一。已经增加完整的 ESP32 板上编程链路：

- 自定义 ESP32 Scratch 扩展；
- “普通编程 / 板上编程”模式切换；
- 板上模式只展示适合 ESP32 的积木；
- Scratch 积木可转换为 MicroPython 程序；
- 通过 BLE Nordic UART Service 连接 ESP32；
- 支持发送程序、重启运行、自动重连、连接状态、发送进度；
- 增加“板上输出”窗口；
- 板上输出只显示打印积木的业务输出，不显示 MicroPython 启动日志、REPL 提示等内部内容；
- 针对旧 Mac 的 BLE 连接状态异常做了专门兼容，详见本文后面的 BLE 防回归说明。

iOS 版没有迁移 USB，ESP32 通信走 Swift `CoreBluetooth` 原生桥接；桌面版继续保留现有 BLE/桌面能力。

### 5. Velxio / ESP32 电路仿真

项目已经把 Velxio 仿真接入板上编程流程，而不是单独作为外部网站使用：

- 可从 Scratch 打开仿真环境；
- 支持 ESP32 电路快照、导入、保存和再次恢复；
- 增加过完整 `.vlx` 电路数据复制能力，并整合到 Velxio 自身菜单；
- 支持局域网/服务器形式的 Velxio 仿真；
- iOS 中仿真使用独立 `WKWebView`，通过服务器地址访问；iOS 不依赖本机 Docker。

修改仿真逻辑时要同时考虑 Scratch 工程数据、板上程序和电路快照三者之间的绑定关系。

### 6. iOS / iPad / iPhone 迁移

在保留桌面 Electron 版本的前提下，已经新增 iOS Universal 版本，目标设备包括 iPhone 和 iPad，当前以横屏为主。

架构为：

`Swift 原生壳 + WKWebView + 复用现有 Scratch GUI/VM + 原生桥接`

主要迁移内容包括：

- Scratch Web 壳启动；
- `.sb3` 加载、保存、恢复；
- 文件 API 从 Electron 迁移到 Swift 原生桥；
- BLE 从桌面 Web/Electron 路径迁移到 `CoreBluetooth`；
- TTS 迁移到 `AVSpeechSynthesizer`；
- Velxio 使用独立 WKWebView；
- 板上/普通编程模式可记住上次选择；
- iOS 中文字体、菜单布局、文件菜单溢出等 UI 兼容；
- iOS 启动恢复作品标题使用 Scratch Redux 正式状态，不直接硬改 DOM。

核心 iOS 文件：

- `ios/App/WebViewController.swift`
- `ios/App/WebBridge.swift`
- `ios/App/BluetoothBridge.swift`
- `ios/App/SimulationViewController.swift`
- `src/renderer/ios/NativeBridge.js`
- `src/renderer/ios/electron-shim.js`

### 7. macOS / 桌面版仍是正式产品能力

桌面版不是迁移过程中的临时代码。仓库中还包含 macOS 打包、快速保存、BLE、板上输出、Velxio、本地仿真等能力。做 iOS 修改时尽量把平台差异放在 `ios` 桥接层，不要为了 iOS 破坏桌面路径。

## AI 修改代码时的工作原则

这个仓库已经出现过“看起来合理的修改反而把已修复问题带回来”的情况，因此：

1. 对 UI、BLE、保存、iOS 生命周期等问题，优先通过真机/Safari Inspector/Console 获取运行时证据，再改代码。
2. 不要因为官方 Scratch 的实现方式不同，就直接把现有定制逻辑覆盖回官方版本。
3. 改大文件时尽量做最小 diff，避免顺手格式化或带入无关改动。
4. 修改 BLE、保存、新建作品、iOS 标题恢复、板上输出后，要优先检查已知回归点。
5. 未经明确要求，不要改 `main`，也不要创建 PR。

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
