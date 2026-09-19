#!/usr/bin/env bash
# Monaco color-regex compatibility for iOS 15; separate from WebSocket hotfix.
set -euo pipefail
ACTION="${1:-}"; CONTAINER="${2:-scratch-desktop-velxio}"; PORT="${3:-3080}"
TARGET='/usr/share/nginx/html/monaco/vs/assets/editor.worker-Be8ye1pW.js'
ASSET='/monaco/vs/assets/editor.worker-Be8ye1pW.js'
MARKER='velxio-ios15-monaco-v3-color-regex'
STATE="$HOME/.velxio-ios15-monaco-v3/$CONTAINER"
RECORD="$STATE/active-backup.txt"

[[ "$ACTION" == apply || "$ACTION" == status || "$ACTION" == rollback ]] || {
  echo "用法: bash $0 apply|status|rollback [容器名] [宿主端口]" >&2; exit 2;
}
[[ "$PORT" =~ ^[0-9]+$ ]] || { echo '端口必须是数字' >&2; exit 2; }
for cmd in docker python3 curl cmp; do command -v "$cmd" >/dev/null || exit 1; done
CID="$(docker inspect -f '{{.Id}}' "$CONTAINER")"
[[ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER")" == true ]] || { echo '容器未运行' >&2; exit 1; }
fetch_worker() {
  curl -fsSL --max-time 20 -H 'Cache-Control: no-cache' \
    "http://127.0.0.1:$PORT$ASSET?ios15_monaco_check=31" -o "$1"
}
if [[ "$ACTION" == status ]]; then
  echo "容器: $CONTAINER ($CID)"
  if docker exec "$CONTAINER" grep -Fq "$MARKER" "$TARGET" 2>/dev/null; then
    echo '容器 Worker: 已有 Monaco v3.1 标记'
  else echo '容器 Worker: 没有 Monaco v3.1 标记'; fi
  TEMP="$(mktemp)"
  if fetch_worker "$TEMP" && grep -Fq "$MARKER" "$TEMP"; then
    echo 'HTTP Worker: 已有 Monaco v3.1 标记'
  else echo 'HTTP Worker: 未通过标记校验'; fi
  rm -f "$TEMP"
  [[ ! -f "$RECORD" ]] || echo "备份: $(cat "$RECORD")"
  exit 0
fi
if [[ "$ACTION" == rollback ]]; then
  [[ -f "$RECORD" ]] || { echo "找不到备份记录: $RECORD" >&2; exit 1; }
  BACKUP="$(cat "$RECORD")"
  [[ -f "$BACKUP/original.js" && -f "$BACKUP/patched.js" && -f "$BACKUP/container-id.txt" ]] || {
    echo '备份不完整，拒绝回滚' >&2; exit 1;
  }
  [[ "$(cat "$BACKUP/container-id.txt")" == "$CID" ]] || {
    echo '容器 ID 已变，拒绝恢复到其他容器' >&2; exit 1;
  }
  TEMP="$(mktemp)"
  trap 'rm -f "$TEMP"' EXIT
  docker cp "$CONTAINER:$TARGET" "$TEMP"
  cmp -s "$TEMP" "$BACKUP/patched.js" || { echo 'Worker 已被再次改动，拒绝覆盖' >&2; exit 1; }
  docker cp "$BACKUP/original.js" "$CONTAINER:$TARGET"
  rm -f "$RECORD"
  echo "Monaco 已回滚；WebSocket 不受影响。备份保留: $BACKUP"
  exit 0
fi
docker exec "$CONTAINER" test -f "$TARGET" || { echo "Worker 不存在: $TARGET" >&2; exit 1; }
if docker exec "$CONTAINER" grep -Fq "$MARKER" "$TARGET"; then
  echo 'Worker 已有 Monaco v3.1 补丁，不重复修改；请使用 status 检查'
  exit 0
fi
[[ ! -f "$RECORD" ]] || { echo '发现既有补丁备份记录，拒绝覆盖' >&2; exit 1; }
mkdir -p "$STATE"
BACKUP="$(mktemp -d "$STATE/backup-XXXXXXXX")"
echo "$CID" > "$BACKUP/container-id.txt"
docker cp "$CONTAINER:$TARGET" "$BACKUP/original.js"
python3 - "$BACKUP/original.js" "$BACKUP/patched.js" "$MARKER" <<'PY'
from pathlib import Path
import sys
src, dest, marker = sys.argv[1:]
raw = Path(src).read_bytes()
code = raw.decode('utf-8')
if marker in code:
    raise SystemExit('Worker 已有 Monaco v3.1 标记，停止')
start_anchor = 'function c1(t){const e=[],n=new RegExp(' + chr(96)
end_anchor = ',"gm"),r=ft(t,n);'
start = code.find(start_anchor)
if start == -1:
    raise SystemExit('找不到已知版本颜色检测函数，停止')
end = code.find(end_anchor, start)
if end == -1:
    raise SystemExit('找不到正则末尾，停止')
end += len(end_anchor)
part = code[start:end]
needle = r'''(?<=['"\\s])'''
if part.count(needle) != 4 or code.count(needle) != 4:
    raise SystemExit('后行断言匹配数量不等于四；拒绝修改未知版本的 Worker')
patched = code[:start] + part.replace(needle, '') + code[end:]
patched += f'\n/* {marker}: four c1 lookbehinds removed; source bundle preserved in backup. */\n'
Path(dest).write_bytes(patched.encode('utf-8'))
print('已校验：仅删除 Monaco 颜色检测函数中的四处后行断言')
PY
docker cp "$BACKUP/patched.js" "$CONTAINER:$TARGET"
echo "$BACKUP" > "$RECORD"
HTTP_FILE="$BACKUP/served.js"
if ! fetch_worker "$HTTP_FILE" || ! cmp -s "$HTTP_FILE" "$BACKUP/patched.js"; then
  echo "HTTP 校验失败，尚未验收；备份: $BACKUP；可执行 rollback" >&2
  exit 1
fi
echo "Monaco v3.1 已安装且 HTTP 响应校验通过；备份: $BACKUP"
echo '重新加载 iPad 编辑器复测；本补丁不修改 WebSocket v2.1 或 QEMU。'
