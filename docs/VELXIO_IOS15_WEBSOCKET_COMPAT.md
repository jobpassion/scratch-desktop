# Velxio：iOS 15.4.1 WebSocket 相对地址兼容（v2.1）

**状态：** iPad Safari 控制台临时注入的 v2.1 转换逻辑已由用户验证可恢复 WebSocket 通信、ESP32 串口输出；本仓库的 Docker 安装脚本尚待用户在现场执行并验收。**用户随后反馈 LED 已重新点亮，但先前的 `solver-failed` 复现条件以及 iPad App 的完整回归仍待核实，不应把所有故障都归功于 WebSocket 修复。**

## 故障和根因

环境：`scratch-desktop-velxio`，镜像 `davidmonterocrespo/velxio:master`，映射 `3080:80`，iPad iOS 15.4.1。

Velxio 实际把 `/api/simulation/ws/<session>%3A%3Aesp32` 这样的**相对路径**传给 `new WebSocket()`；iOS 15 的 WebKit 报 `Wrong url scheme for WebSocket http://192.168.1.70:3080/api/simulation/ws/...`。此前 v2 补丁虽然已加载，却仅转换完整 `http://`/`https://` 地址，未解析相对路径。用户在 iPad Web Inspector 中临时注入的 v2.1 验证成功：先 `new URL(input, window.location.href)`，随后转换 `http:` → `ws:`、`https:` → `wss:`，旧 WebKit 即可发起连接，串口正常输出。临时控制台代码刷新页面后即消失，不能算容器持久修复。

第一版补丁曾错误修改根目录 `/usr/share/nginx/html/index.html`；真正的编辑器入口是 `/usr/share/nginx/html/editor/index.html`。请求 `/editor` 时会 301 跳转到 `/editor/`，实际 HTTP 校验必须使用 `curl -L`。只检查容器内 HTML 或错误地把 301 判作未注入都不可靠。

## 已保存的文件

- `scripts/velxio-ios15-ws-compat-v2.1.js`：在编辑器应用 bundle 加载前包装 `WebSocket` 构造函数，仅转换 WebSocket URL，不拦截 fetch、XHR 或仿真消息。
- `scripts/velxio-ios15-ws-hotfix.sh`：支持对当前已安装 v2 的容器**就地升级**，也支持新建的干净容器；备份编辑器 HTML，安装后检查跟随重定向的 HTTP 实际 HTML 和 JS 内容，提供 status、rollback。保留旧 v2 JS 和备份，不触碰 Monaco、QEMU 或 ESP32 固件。

## Mac 本机安装和状态检查

```bash
cd /path/to/scratch-desktop
git pull
bash scripts/velxio-ios15-ws-hotfix.sh apply
bash scripts/velxio-ios15-ws-hotfix.sh status
```

默认使用容器 `scratch-desktop-velxio` 和宿主端口 `3080`；自定义用 `apply <容器名> <宿主端口>`。安装应输出“**v2.1 安装成功；HTTP HTML + JS 校验通过**”，状态应显示“**实际 HTTP 响应: 已通过 HTML 标记和 JS 内容校验**”。如失败，保存错误输出，不要当作安装成功。回滚命令：

```bash
bash scripts/velxio-ios15-ws-hotfix.sh rollback
```

回滚仅恢复安装前的编辑器 HTML 并移除 v2.1 JS；若安装前有 v2，回滚后返回 v2 状态。Mac 备份在 `~/.velxio-ios15-ws-v2.1/<容器名>/backup-...`，容器 ID 不一致时拒绝跨容器恢复。不要在 v2.1 安装后再次用旧 v2 安装脚本覆盖编辑器入口。

**生命周期：** `docker restart` 保留容器内临时补丁；删除并重建容器后需重新执行本脚本 `apply`。本补丁未修改 Docker 镜像本身。重建前还需注意仓库已有的 QEMU / RMT 定制修复；WebSocket 补丁不能替代它们。

## iPad 现场验收

重新加载 iPad Safari 的 `http://192.168.1.70:3080/editor/`（IP 变更请替换），在**编辑器主页面**控制台执行：

```javascript
({
  installed: window.__velxioIOS15WSHotfixV21,
  constructor: window.WebSocket.toString().slice(0, 90)
})
```

应得到 `installed: true` 且构造函数含 `CompatibleWebSocket`。**刷新后仍然为 true**，才说明 Docker 已固化，不再依赖手动粘贴的诊断代码。再次运行 ESP32，确认不出现 `Wrong url scheme for WebSocket`，串口正常输出。随后在一一编程乐园 App 内重复验证；Safari 通过不代表 WKWebView 已验收。

## 仍待处理（不要混淆）

- iPad 曾出现 LED 不亮和 `[verify]` 的 `solver-failed`，而 Mac 正常；用户随后报告 LED 已重新点亮，仍需确认求解器状态及 iPad App 回归。**这不是 WebSocket v2.1 单独修复的已证实结果。**
- `navigator.clipboard.write` 不可用：另一个兼容问题，本补丁未处理。
- `/api/metrics/run` 404 在 Mac 正常亮灯时也存在，不能直接认定为 LED 故障原因。
- Monaco `editor.worker` 正则兼容 v3.1 是独立补丁，本脚本不更改它；安装和回滚记录见 `docs/VELXIO_IOS15_MONACO_COMPAT.md`。

后续如需把 v2.1 集成进自定义 Docker 镜像，应在源码或镜像构建时应用同一逻辑；目前仍是可重复执行的容器级临时补丁。
