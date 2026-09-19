# Velxio iOS 15.4.1：Monaco Worker 兼容性修复 v3.1

**记录日期：2026-09-19。状态：Monaco 正则异常在安装 v3.1 后的用户截图中未再出现；用户随后确认 iPad 的 ESP32 串口正常、LED 已重新点亮。尚不能单独把 LED 恢复归因于 Monaco；`solver-failed` 是否完全消失及一一编程乐园 App 是否通过完整回归，仍待独立确认。**

## 故障与定位

iPad（iOS 15.4.1）访问 Mac 上 Docker Velxio 编辑器时，Safari 控制台报：

```text
Error: Invalid regular expression: invalid group specifier name
/monaco/vs/assets/editor.worker-Be8ye1pW.js
```

对应容器路径：

```text
/usr/share/nginx/html/monaco/vs/assets/editor.worker-Be8ye1pW.js
```

从现场文件全文检查确认：压缩代码的颜色识别函数 `c1` 创建的正则包含 **4 处 `(?<=...)` 后行断言**。该写法在此 iOS 15.4.1 环境下触发上述异常。只在已知版本、`c1` 范围内精确删除这四处断言以消除正则构造错误；这属于临时兼容，可能扩大 Monaco 对 `#HEX` 颜色的高亮匹配范围，不可假定为对所有版本通用的正式修复。

原版 v3 安装脚本曾误将实际源码里的两字符反斜杠 `\\s` 当成一字符 `\s` 匹配，导致找不到断言，停在备份阶段，没有写入 Worker。v3.1 修正了这一点；修改前同时校验目标函数内和全文中都恰好匹配 4 处，否则拒绝写入。

## 仓库保存内容

- `scripts/velxio-ios15-monaco-v3.1.sh`：可重复使用的临时修复、检查与回滚脚本；只处理上述指定 Worker，并校验 HTTP 真正提供的 JS 文件与补丁内容逐字节一致。
- `docs/VELXIO_IOS15_WEBSOCKET_COMPAT.md`：独立的 WebSocket v2.1 修复记录。
- `scripts/velxio-ios15-ws-hotfix.sh` 和 `scripts/velxio-ios15-ws-compat-v2.1.js`：独立 WebSocket 修复。**Monaco v3.1 不会替代它，也不会处理 GPIO、QEMU 或电路求解。**

## 检查当前运行容器

在 Mac 的 `scratch-desktop` 仓库根目录执行：

```bash
git pull
bash scripts/velxio-ios15-monaco-v3.1.sh status
```

**当前容器很可能已通过此前下载的 v3.1 临时脚本完成修补，因此先运行 `status`，不要再次 `apply`。** 即使当前补丁不是通过本仓库脚本安装，Worker 中的修复标记仍应可被检测到。旧脚本备份保存在 `~/.velxio-ios15-monaco-v3/scratch-desktop-velxio/`；不要删掉。

## 新容器恢复

只有在新容器的 `status` 显示 Monaco 标记不存在时，执行：

```bash
# 先按 docs/VELXIO_IOS15_WEBSOCKET_COMPAT.md 安装 WebSocket v2.1
bash scripts/velxio-ios15-ws-hotfix.sh apply
bash scripts/velxio-ios15-monaco-v3.1.sh apply
bash scripts/velxio-ios15-monaco-v3.1.sh status
```

默认容器名 `scratch-desktop-velxio`、Mac 宿主端口 `3080`；脚本参数支持自定义容器和端口。它只适配文件名与 `c1` 代码结构相符的已知镜像；若拉取 `master` 导致构建版本变化，脚本会拒绝盲目替换，应重新定位源码，不要关闭断言数量校验。

`docker restart` 保留当前容器文件补丁；`docker rm` 并重建容器会丢失临时修复，需重新执行安装。镜像本身并未被修改。

## 回滚与验收

```bash
bash scripts/velxio-ios15-monaco-v3.1.sh rollback
```

仅恢复安装前备份的 Monaco Worker；会比对容器 ID、当前文件与已安装补丁文件以避免覆盖其他修改。WebSocket v2.1 不受影响。如果当前容器补丁由先前 v3.1 脚本安装，其备份记录兼容；**未核实备份前不要执行回滚**。

在 iPad Safari、iPad App、Mac 浏览器分别验证：Monaco `Invalid regular expression` 不再出现、WebSocket 可以连接、ESP32 串口输出和 LED 状态正常，并比较 `[verify]` 的 `solved` 状态。用户反馈 iPad LED 现在已亮，但此前 `solver-failed` 的复现条件和消失原因尚未完全查明。剪贴板 `navigator.clipboard.write` 异常和 `/api/metrics/run` 的 404 不属于本补丁修复范围；Mac 能亮灯时也存在 metrics 404。

## 故障排查期间的版本与边界

镜像记录：`davidmonterocrespo/velxio:master`，2026-09-12 构建的本地 image ID `sha256:b0fd05b53e8304f97f68641542705dd4aeb00853ebb7eb709c2d1e65a4cca514`。此 ID 仅用于识别现场基线，不表示脚本适用于所有 `master` 版本。RMT / NeoPixel 已验证补丁另见 `docs/VELXIO_RMT_NEOPIXEL_FIX.md`，重新创建容器时不要遗失其定制 QEMU 库。
