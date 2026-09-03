#!/usr/bin/env bash
# plan-gantt 本机（macOS）一键启动 / 停止
#
# 用法：
#   ./start-mac.sh         启动（守护化，关闭终端也继续跑）
#   ./start-mac.sh stop    停止
#   ./start-mac.sh status  查看状态
#
# 为什么不用 nohup：在 WorkBuddy/沙箱环境里 nohup 起的进程会随会话被回收，
# 必须 os.setsid + 双 fork 真正脱离会话才能存活（见 docs/LESSON_LEARN.md）。
#
# 启动后用浏览器打开 http://localhost:3001
set -uo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-3001}"
LOG=/tmp/plan-gantt-server.log
PIDF=/tmp/plan-gantt-server.pid
NODE_BIN="/Users/dev/.toolchain/node/versions/22.22.2-2/bin/node"
PY_BIN="/Users/dev/.toolchain/python/versions/3.13.12/bin/python3"

port_alive() { "$PY_BIN" -c "import socket,sys;s=socket.socket();s.settimeout(1);sys.exit(0 if s.connect_ex(('127.0.0.1',$PORT))==0 else 1)" 2>/dev/null; }

case "${1:-start}" in
  stop)
    if [ -f "$PIDF" ]; then
      kill "$(cat "$PIDF")" 2>/dev/null && echo "已停止 (pid $(cat "$PIDF"))"
      rm -f "$PIDF"
    else
      echo "未找到 pid 文件，服务可能未运行"
    fi
    exit 0
    ;;
  status)
    if port_alive; then echo "运行中：http://localhost:$PORT"; else echo "未运行"; fi
    exit 0
    ;;
esac

# 已在跑则不重复启动
if port_alive; then
  echo "服务已在运行：http://localhost:$PORT"
  open "http://localhost:$PORT"
  exit 0
fi

# 前端产物缺失或过旧时先构建
if [ ! -f dist/index.html ]; then
  echo "==> dist 不存在，先构建前端..."
  "$NODE_BIN" ./node_modules/vite/bin/vite.js build || exit 1
fi

# 守护化启动（setsid + 双 fork），把 pid 写盘
"$PY_BIN" - "$PORT" "$LOG" "$PIDF" <<'PY'
import os, sys
port, log, pidf = sys.argv[1], sys.argv[2], sys.argv[3]
if os.fork() > 0:
    os._exit(0)
os.setsid()
pid = os.fork()
if pid > 0:
    # 子进程即最终的 node 服务进程（execv 不改变 pid）
    with open(pidf, 'w') as f:
        f.write(str(pid))
    os._exit(0)
os.chdir(os.path.dirname(os.path.abspath('start-mac.sh')))
fd = os.open(log, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o644)
os.dup2(fd, 1); os.dup2(fd, 2)
os.execv('/Users/dev/.toolchain/node/versions/22.22.2-2/bin/node',
         ['node', 'server-build/server.cjs'])
PY

# 等端口就绪
for i in $(seq 1 30); do
  if port_alive; then break; fi
  sleep 0.5
done

if port_alive; then
  echo "==> 已启动：http://localhost:$PORT"
  echo "==> 日志：$LOG"
  open "http://localhost:$PORT"
else
  echo "启动失败，查看日志："; tail -20 "$LOG"; exit 1
fi
