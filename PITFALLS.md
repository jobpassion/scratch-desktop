# 踩坑记录

这份文档记录“一一编程乐园”在官方 Scratch Desktop 基础上继续开发时，已经实际踩过、并且比较费时间的问题。

它不是功能说明，而是给后续 AI / 开发者看的“不要再重复走弯路”记录。遇到 iOS、保存、BLE、语音、生命周期问题时，优先先看这里，再决定是否改代码。

## 1. Safari Inspector 很容易看错窗口 / WebView

### 现象

调试 iOS 标题恢复时，Console 里看到 Redux、DOM value、样式都已经变化，但设备上眼睛看到的界面却没有变化。继续沿着这个错误观察结果分析，会把正常代码误判成失败，或者把无关链路误判成根因。

### 原因

项目现在不再只有一个简单页面：

- 主 Scratch 界面运行在 WKWebView；
- Velxio 仿真也有独立 WebView / 页面上下文；
- Safari 开发菜单里可能同时存在多个可检查目标；
- 调试时还可能同时开着旧窗口或其他实例。

仅仅“Console 能执行”不能证明当前 Inspector 就对应眼前正在看的 Scratch 主界面。

### 必做验证

在相信任何 DOM / Redux 调试结果之前，先做视觉定位。例如给顶部作品名输入框加极明显样式：

```js
(() => {
    const el = Array.from(document.querySelectorAll('input')).find(input => {
        const r = input.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.y < 80;
    });
    if (!el) return;
    el.style.outline = '4px solid red';
    el.style.background = 'yellow';
    el.style.color = 'black';
})();
```

只有设备上眼前的作品名框真的变成“黄色 + 红框”，才继续相信这个 Inspector 的 Console 结果。

### 经验

**运行时证据必须先确认来自正确窗口。** 这一点比后面的代码分析更优先。

---

## 2. iOS 作品标题不是 React `setState`，真正状态在 Scratch Redux

### 现象

作品内容可以恢复，但 App 重开后顶部仍显示默认“Scratch作品”。

早期尝试过：

- `this.setState({projectTitle: newTitle})`；
- 修改 DOM input value；
- 人工触发 `input/change/blur`；
- 只在启动早期发一次标题事件。

这些都不能稳定解决。

### 已验证事实

真机 Safari Inspector 中直接执行下面的 Redux action，可以立即、真实地修改顶部作品名：

```js
store.dispatch({
    type: 'projectTitle/SET_PROJECT_TITLE',
    title: '测试标题'
});
```

因此 Scratch 作品名的有效状态是：

```text
state.scratchGui.projectTitle
```

不是 HOC 自己随便 `setState` 一个同名字段。

### 第二个坑：时序

即使 Redux action 正确，**发得太早也会被 Scratch 后续加载流程覆盖回默认标题**。

最终稳定方案是：

1. Native `getInitialProjectData` 返回文件数据和文件名标题；
2. `electron-shim.js` 暂存标题；
3. Scratch Redux store 可用后 dispatch `projectTitle/SET_PROJECT_TITLE`；
4. 启动期间重复尝试；
5. `projectDidLoad` 之后再恢复一次，防止加载流程覆盖。

已真机验证生效的关键提交：

```text
b41f306ce62105e56e3cd5fcadb42e3bc74306b5
Retry iOS project title restore until Scratch is ready
```

### 不要这样改

- 不要退回单纯 `this.setState({projectTitle: ...})`；
- 不要只改 DOM input.value；
- 不要只在页面启动很早的时候 dispatch 一次；
- 不要看到“Native 返回 title 正确”就直接认定 UI 链路一定正确。

---

## 3. “恢复了错误文件名”和“UI 没恢复标题”是两个完全不同的问题

### 现象

调试标题时，Native `getInitialProjectData` 有一次返回的是旧标题 `Scrat123`，而不是刚刚预期的标题。

如果 Native 本身返回旧标题，那么即使 Redux 恢复逻辑百分之百正确，也只会恢复那个旧标题。

### 正确拆分方法

标题恢复要分两段查：

**第一段：Native 当前记住的是哪个作品**

直接调用：

```js
window.webkit.messageHandlers.yiyiBridge.postMessage({
    id: 999902,
    method: 'getInitialProjectData',
    params: {}
});
```

观察返回 payload 的：

```text
title
```

它来自 `WebBridge.swift` 当前 `lastProjectPath` 指向的文件名。

**第二段：这个 title 有没有正确进入 Scratch Redux**

只有第一段正确后，再查 Redux / UI。

### 经验

不要把“文件路径记忆错误”和“UI 标题状态错误”混在一个问题里修，否则非常容易越改越乱。

---

## 4. iOS 新建 / 重命名 / 快速保存最危险的坑：误删旧作品

### 背景

`WebBridge.swift` 的快速保存逻辑支持重命名：

- 当前是 `A.sb3`；
- 标题改成 B；
- 保存时生成 `B.sb3`；
- 成功后删除旧 `A.sb3`。

对于“同一个作品重命名”这是正确的。

### 坑

如果用户实际上点的是“新建作品”，但 Native 仍把上一个作品 A 当成 current project，那么新作品第一次保存成 B 时，会被错误当成“A 重命名为 B”，于是旧 A 可能被删除。

### 当前保护

前端收到 Scratch 的：

```text
projectWasCreated
```

后会：

- 设置 `window.__YYCreateNewProjectPending = true`；
- 调 Native `clearCurrentProject`；
- 新作品第一次 quick save 前再次确认清除旧 current project；
- 保存成功后才清掉 pending flag。

相关修复提交：

```text
1323651c20c5b94b6bfa1359f063dc9933db0349
Preserve existing iOS project when creating a new one
```

### 回归测试必须包含

1. 打开/保存 A；
2. 新建作品；
3. 新作品命名 B 并保存；
4. 文件 App 中 A 和 B 都应存在；
5. 再重命名 B 为 C 并保存；
6. 此时 B 应被 C 替代，但 A 仍然存在。

---

## 5. iOS 不能把完整 sandbox 绝对路径永久记进 UserDefaults

### 现象

Xcode 重装/重新运行 App 或容器变化后，之前保存的作品还在 Documents，但 App 找不到“上次作品”。

### 原因

iOS App sandbox 的绝对路径前缀可能变化。把类似：

```text
/.../Application/<随机 UUID>/Documents/...
```

完整写进 UserDefaults，下一次容器 UUID 变化后就失效。

### 当前做法

`lastProjectPath` 保存的是 Documents 下的相对引用，例如：

```text
一一编程乐园/作品名.sb3
```

`resolveLastProjectURL()` 还兼容旧版本曾经保存过的绝对路径，并尝试迁移到当前 Documents。

### 不要回退

不要再把当前 sandbox 的完整绝对 URL 当成长期标识保存。

---

## 6. iOS TTS：Swift 没问题，问题曾经只在触摸事件层

### 现象

桌面点击积木能播报，iOS 上点击积木不播报。

一开始很容易怀疑：

- `AVSpeechSynthesizer`；
- Native bridge；
- iOS 音频权限；
- 文本生成。

### 最有效的拆层验证

先直接绕过 Scratch 事件层，调用 Native：

```js
window.webkit.messageHandlers.yiyiBridge.postMessage({
    id: 999901,
    method: 'speakText',
    params: {text: '这是语音测试'}
});
```

真机实际可以播出声音，说明 Swift TTS 和 Bridge 都正常。

然后监听积木真实事件，发现 iOS 触摸会出现：

```text
pointerdown
 touchstart
```

但没有桌面代码依赖的 `mousedown`。

### 正确修复

积木和分类语音监听改用 `pointerdown`，不要只监听 `mousedown`。

已验证提交：

```text
d308a0c362e9236ef5c0ba8266b4c46023699565
```

### 经验

遇到“功能在 iOS 不触发”，先区分：

1. Native 能力坏了；
2. JS -> Native bridge 坏了；
3. UI 事件根本没触发。

不要一上来就改最底层。

---

## 7. Scratch / iOS 启动问题经常是“生命周期覆盖”，不是值没写进去

标题恢复不是唯一案例。板上编程模式也遇到类似问题：

- 启动早期按上次选择恢复模式；
- 后续 `loadProject()` 又根据项目里的 ESP32 积木重新推断 `boardMode`；
- 前面恢复的选择被覆盖。

因此现在板上/普通编程模式用 localStorage 保存，并在项目加载完成后重新应用。

相关提交：

```text
202e95660b5d5148fc63316f15c59a68728c7000
Remember iOS board programming mode across launches
```

### 通用经验

当一个值“明明写进去了，过一会儿又变回去”，优先查：

- `loadProject`；
- `projectDidLoad`；
- React/Redux 后续初始化；
- 定时同步逻辑；
- 组件重新挂载。

不要第一反应就是“写入失败”。

---

## 8. 修改 JS 后如果没有重新 build iOS Web，Xcode 会继续跑旧代码

### iOS Web 构建

```bash
npm run build:ios:web
```

输出到：

```text
ios/App/Web
```

修改 `src/renderer/...`、`src/renderer/ios/...` 等 Web 代码后，如果只 `git pull` 然后直接 Xcode Run，而没有重新执行 Web build，就可能继续看到旧 bundle 的行为。

这种情况很容易误判成“代码修复没生效”。

### Xcode 工程生成

普通代码变化不需要反复运行 `xcodegen generate`。

只有 `project.yml` 本身发生变化时，才需要重新生成 Xcode 工程。

### 推荐验证顺序

```text
git pull
npm run build:ios:web
Xcode Run
```

然后再开始判断代码是否生效。

---

## 9. 旧 Mac BLE：连接成功不等于 `_connections` 正确

这个坑非常隐蔽，完整保护逻辑见 `AGENTS.md` 的 BLE 专章，这里只记录诊断结论。

### 现象

- BLE 看起来已经连接；
- GATT RX 写入也确实到达；
- 但 REPL 没回包；
- 板上 `print()` 也可能完全没有 Notify 到电脑。

### 真正问题

旧 Mac 环境下曾出现 `_IRQ_CENTRAL_CONNECT` 没有把连接记录进 MicroPython `BLEUART._connections` 的情况。

因此：

- `_IRQ_GATTS_WRITE` 时必须先 `self._connections.add(conn_handle)`；
- 不能先要求 `conn_handle in self._connections` 才处理 RX；
- 桌面端订阅 TX Notify 后还会主动向 RX 做一次握手写；
- 零长度写失败时回退一个回车。

这两层保护都不要删。

### 环境坑

调 Apple 设备、无线调试、旧 Mac 通信异常时，如果本机开着 Surge / 代理软件，先完全退出后复测。过去出现过退出 Surge 后 `devicectl` 和设备通信恢复的情况。

这不代表所有 BLE 问题都是 Surge，但它应该成为环境排除项，而不是最后才想到。

---

## 10. GitHub 直接更新大文件时，最容易夹带无关修改

### 实际踩过的坑

修 iOS 积木语音 `mousedown -> pointerdown` 时，曾经因为整文件更新，意外顺带把一个无关的 `append` / `appendChild` 行也改了，后来又专门提交一次恢复。

### 原因

GitHub contents API 的 `update_file` 是“提交完整文件内容”，不是天然的局部 patch。大文件在重新生成内容时，很容易混入：

- 格式变化；
- 无关重构；
- 旧版本内容；
- 顺手修改。

### 强制习惯

每次修改大文件后：

1. 立即看 commit diff；
2. 确认 changed files 数量；
3. 确认 additions/deletions 是否符合预期；
4. 发现无关变化立即单独修正，不要继续叠新功能。

对于 `ScratchDesktopGUIHOC.jsx`、`electron-shim.js`、BLE 核心代码尤其要这样做。

---

## 11. iOS Bridge 问题要按层拆，不要整条链一起猜

当前大致链路：

```text
Scratch / React
  -> electron-shim.js
  -> NativeBridge.js
  -> window.webkit.messageHandlers.yiyiBridge
  -> Swift WebBridge
  -> iOS 原生能力
```

出了问题时，推荐从两端向中间夹：

### Native 能力验证

直接：

```js
window.webkit.messageHandlers.yiyiBridge.postMessage(...)
```

如果成功，Swift 和原生能力基本没问题。

### Scratch 状态验证

直接查看/修改 Redux 或实际 DOM。

如果这两端都正常，再查中间 shim / bridge。

### 经验

一次只验证一层。不要因为最终 UI 没变化，就同时改 Swift、Bridge、React 三层。

---

## 12. 已验证成功的修复，不要因为“官方实现不一样”就随手还原

这个项目已经不是官方 Scratch Desktop 的轻微改版。很多看起来“不标准”的代码，其实是在兼容：

- 旧 Mac；
- iOS WKWebView；
- CoreBluetooth；
- MicroPython；
- Scratch 生命周期；
- 自定义快速保存；
- Velxio；
- 教学语音。

后续同步上游、重构或让 AI “整理代码”时，必须先看 `AGENTS.md` 和本文件。

**优先保留已经真机/实机验证过的行为，再谈代码是否优雅。**
