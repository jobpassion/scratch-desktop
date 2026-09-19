#!/usr/bin/env bash
set -euo pipefail

# Reversible WebSocket URL hotfix for the *running* Velxio Docker container.
# Usage: bash scripts/velxio-ios15-ws-hotfix.sh apply|status|rollback [container] [host-port]
ACTION="${1:-}"; CONTAINER="${2:-scratch-desktop-velxio}"; PORT="${3:-3080}"
[[ "$ACTION" == apply || "$ACTION" == status || "$ACTION" == rollback ]] || {
  echo "用法: bash $0 apply|status|rollback [容器名] [映射端口]" >&2; exit 2;
}
[[ "$PORT" =~ ^[0-9]+$ ]] || { echo '端口必须是数字' >&2; exit 2; }
for cmd in docker python3 curl; do command -v "$cmd" >/dev/null || { echo "缺少命令: $cmd" >&2; exit 1; }; done
DIR="$(cd "$(dirname "$0")" && pwd)"
SOURCE_JS="$DIR/velxio-ios15-ws-compat-v2.1.js"
TARGET_HTML='/usr/share/nginx/html/editor/index.html'
TARGET_JS='/usr/share/nginx/html/velxio-ios15-ws-compat-v2.1.js'
URL_JS='/velxio-ios15-ws-compat-v2.1.js'
MARKER='data-velxio-ios15-ws-hotfix="v2.1"'
STATE_DIR="$HOME/.velxio-ios15-ws-v2.1/$CONTAINER"
STATE_FILE="$STATE_DIR/active-backup.txt"
CID="$(docker inspect --format '{{.Id}}' "$CONTAINER")"
[[ "$(docker inspect --format '{{.State.Running}}' "$CONTAINER")" == true ]] || {
  echo "容器未运行: $CONTAINER" >&2; exit 1;
}

http_check() {
  local temp_html temp_js ok=0
  temp_html="$(mktemp)"; temp_js="$(mktemp)"
  # /editor redirects 301 to /editor/; -L is mandatory.
  if curl -fsSL --max-time 15 -H 'Cache-Control: no-cache' \
      "http://127.0.0.1:$PORT/editor?ios15_ws_check=21" -o "$temp_html" \
    && grep -Fq "$MARKER" "$temp_html" \
    && curl -fsSL --max-time 15 "http://127.0.0.1:$PORT$URL_JS" -o "$temp_js" \
    && cmp -s "$SOURCE_JS" "$temp_js"; then
    ok=1
  fi
  rm -f "$temp_html" "$temp_js"
  [[ "$ok" == 1 ]]
}

if [[ "$ACTION" == status ]]; then
  echo "容器: $CONTAINER ($CID)"
  if docker exec "$CONTAINER" grep -Fq "$MARKER" "$TARGET_HTML" 2>/dev/null; then
    echo '入口 HTML: 包含 v2.1 标记'
  else
    echo '入口 HTML: 未包含 v2.1 标记'
  fi
  if docker exec "$CONTAINER" test -f "$TARGET_JS"; then echo '兼容 JS: 存在'; else echo '兼容 JS: 不存在'; fi
  if http_check; then echo '实际 HTTP 响应: 已通过 HTML 标记和 JS 内容校验'; else echo '实际 HTTP 响应: 未通过校验'; fi
  [[ ! -f "$STATE_FILE" ]] || echo "本容器备份: $(cat "$STATE_FILE")"
  exit 0
fi

if [[ "$ACTION" == rollback ]]; then
  [[ -f "$STATE_FILE" ]] || { echo "没有本脚本保存的备份记录: $STATE_FILE" >&2; exit 1; }
  BACKUP="$(cat "$STATE_FILE")"
  [[ -f "$BACKUP/index.html" && -f "$BACKUP/container-id.txt" ]] || {
    echo '备份缺失，拒绝回滚' >&2; exit 1;
  }
  [[ "$(cat "$BACKUP/container-id.txt")" == "$CID" ]] || {
    echo '容器已重建，拒绝将旧容器备份写入新容器' >&2; exit 1;
  }
  docker cp "$BACKUP/index.html" "$CONTAINER:$TARGET_HTML"
  docker exec "$CONTAINER" rm -f "$TARGET_JS"
  rm -f "$STATE_FILE"
  echo "已恢复安装前的编辑器 HTML，移除 v2.1 JS。保留备份: $BACKUP"
  echo '如安装前已有 v2，回滚后将恢复 v2；不会触碰 Monaco v3.1。'
  exit 0
fi

[[ -f "$SOURCE_JS" ]] || { echo "兼容脚本不存在: $SOURCE_JS" >&2; exit 1; }
if docker exec "$CONTAINER" grep -Fq "$MARKER" "$TARGET_HTML"; then
  if http_check; then echo 'v2.1 已安装且 HTTP 校验通过，不重复安装'; exit 0; fi
  echo 'HTML 已有 v2.1 标记但资源未通过校验；为保护原备份，拒绝覆盖。' >&2; exit 1
fi
[[ ! -e "$STATE_FILE" ]] || { echo "存在旧安装记录，拒绝覆盖: $STATE_FILE" >&2; exit 1; }
if docker exec "$CONTAINER" test -e "$TARGET_JS"; then
  echo "目标 JS 已存在但未标记，拒绝覆盖: $TARGET_JS" >&2; exit 1
fi
mkdir -p "$STATE_DIR"
BACKUP="$(mktemp -d "$STATE_DIR/backup-XXXXXXXX")"
echo "$CID" > "$BACKUP/container-id.txt"
docker cp "$CONTAINER:$TARGET_HTML" "$BACKUP/index.html"

python3 - "$BACKUP/index.html" "$BACKUP/patched.html" <<'PY'
import pathlib, re, sys
source, destination = map(pathlib.Path, sys.argv[1:])
raw = source.read_bytes()
html = raw.decode('utf-8')
marker = 'data-velxio-ios15-ws-hotfix="v2.1"'
asset = '/velxio-ios15-ws-compat-v2.1.js'
if marker in html:
    raise SystemExit('源 HTML 已含 v2.1 补丁，拒绝重复注入')
legacy = re.compile(r'<script\s+data-velxio-ios15-ws-hotfix="v2"\s+src="/velxio-ios15-ws-compat-v2\.js"\s*>\s*</script>', re.I)
if legacy.search(html):
    patched, count = legacy.subn(f'<script {marker} src="{asset}"></script>', html)
    if count != 1: raise SystemExit('旧版标记数量异常，停止安装')
    print('模式：升级现有 v2；保留 v2 JS 和旧版备份，不修改 Monaco')
else:
    if 'data-velxio-ios15-ws-hotfix=' in html:
        raise SystemExit('存在未知版本 WebSocket 补丁标记，停止安装')
    patched, count = re.subn(r'<head(?:\s[^>]*)?>',
        lambda m: m.group(0) + f'\n    <script {marker} src="{asset}"></script>',
        html, count=1, flags=re.I)
    if count != 1: raise SystemExit('找不到 HTML <head>，停止安装')
    print('模式：全新容器安装 v2.1')
destination.write_bytes(patched.encode('utf-8'))
PY

docker cp "$SOURCE_JS" "$CONTAINER:$TARGET_JS"
if ! docker cp "$BACKUP/patched.html" "$CONTAINER:$TARGET_HTML"; then
  docker exec "$CONTAINER" rm -f "$TARGET_JS" || true
  echo '写入 HTML 失败，JS 已清理；HTML 状态请手动检查。' >&2; exit 1
fi
echo "$BACKUP" > "$STATE_FILE"
if ! http_check; then
  echo 'HTTP 校验失败：不视作安装成功。请执行本脚本 rollback 后检查端口/路由。' >&2
  exit 1
fi
echo "v2.1 安装成功；HTTP HTML + JS 校验通过；备份: $BACKUP"
echo '请重新加载 iPad Safari /editor/，检查 window.__velxioIOS15WSHotfixV21 === true，并测试 ESP32。'
echo '注：容器 restart 会保留临时补丁，docker rm/recreate 后需再次执行 apply。'
