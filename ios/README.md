# iPad / iOS 构建（迁移第一版）

这一目录是 Electron 桌面版之外的独立 iPad 宿主。Scratch GUI、VM、ESP32 编译逻辑继续使用现有 JavaScript 代码；iOS 原生层只负责 WKWebView、文件、CoreBluetooth、TTS 和第二仿真窗口。

## 当前已迁移

- WKWebView 承载 Scratch 编辑器，iPad 横屏全屏。
- 系统“文件”选择器打开 `.sb3`。
- 快速保存到 App Documents `/一一编程乐园/`，并允许在“文件”App 中查看。
- 自动记住最近一次作品，下次启动继续打开。
- CoreBluetooth 连接 `YY-Board` / `MPY ESP32`，使用现有 Nordic UART UUID。
- 保留 Raw REPL、分包、SHA256 校验、`main.py` 上传和板上输出协议。
- 使用 `AVSpeechSynthesizer` 替代 macOS `say`。
- Velxio 使用第二个 WKWebView 全屏打开；iPad 不支持“本机 Docker”，只使用配置的 HTTP/HTTPS 仿真服务器。
- 仿真关闭时尝试抓取 `.vlx` 快照并回写 Scratch 工程。
- USB 功能不迁移。

## 生成 Xcode 工程

项目用 `project.yml` 保存 Xcode 工程定义，避免长期手工维护 `project.pbxproj`。

```bash
brew install xcodegen
cd scratch-desktop
npm ci
npm run build:ios:web
cd ios
xcodegen generate
open YiyiCoding.xcodeproj
```

第一次真机运行时，在 Xcode 的 Signing & Capabilities 里选择自己的 Team 即可。

Xcode 每次构建都会先执行 `npm run build:ios:web`，因此 JavaScript 改动会自动进入 iPad App。

## 第一版验证重点

1. 普通 Scratch 新建、编辑、打开和保存 `.sb3`。
2. 退出并重新进入 App 后，最近作品能够恢复。
3. 点击“板上编程”后连接 ESP32，确认连接、上传、重启和“板上输出”。
4. 老固件仍需验证连接后握手是否能触发 BLE UART 自愈逻辑。
5. 设置局域网 Velxio 地址，验证打开、运行、返回以及电路快照回写。
6. 麦克风、摄像头、软键盘、触摸拖积木和 Apple Pencil 交互。

## 暂未处理

- App Store 正式签名、App Icon 和商店素材。
- 从“文件”App 直接双击 `.sb3` 唤起并导入；当前通过 Scratch 文件菜单中的“从电脑中上传”选择文件。
- iPhone 布局；当前 target 仅 iPad。
