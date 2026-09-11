#!/usr/bin/env bash
# Project Planning with Checklist · macOS 一键启动 / 停止
#
# 用法：
#   ./start.command         启动（Finder 双击也行；守护化，关闭终端也继续跑）
#   ./start.command stop    停止
#   ./start.command status  查看状态
#
# 为什么不用 nohup：在沙箱 / macOS 应用环境下 nohup 起的进程会随会话被回收，
# 必须 os.setsid + 双 fork 真正脱离会话才能存活。
#
# 启动后用浏览器打开 http://localhost:3001
set -uo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-3001}"
LOG=/tmp/project-planning-with-checklist.log
PIDF=/tmp/project-planning-with-checklist.pid

# ---------------------------------------------------------------------------
# 默认凭据：首次启动时若未通过环境变量指定 admin，则注入 README 公开的默认值
# 想要覆盖：export ADMIN_USER=xxx; export ADMIN_PASSWORD=yyy; ./start.command
# 安全提示：部署到生产前务必覆盖默认密码！
# ---------------------------------------------------------------------------
export ADMIN_USER="${ADMIN_USER:-admin}"
export ADMIN_PASSWORD="${ADMIN_PASSWORD:-admin12345}"

# 找 node：PATH 优先，其次常见位置
NODE_BIN="$(command -v node 2>/dev/null || true)"
if [ -z "$NODE_BIN" ]; then
  for cand in /usr/local/bin/node /opt/homebrew/bin/node /usr/bin/node; do
    if [ -x "$cand" ]; then NODE_BIN="$cand"; break; fi
  done
fi
if [ -z "$NODE_BIN" ]; then
  echo "[错误] 没找到 node。请先安装 Node.js 20+：https://nodejs.org/"
  read -r _
  exit 1
fi

# 端口可用性探测（跨平台兜底：优先 python，没 python 就用 nc）
port_alive() {
  if command -v python3 >/dev/null 2>&1; then
    python3 -c "import socket,sys;s=socket.socket();s.settimeout(1);sys.exit(0 if s.connect_ex(('127.0.0.1',$PORT))==0 else 1)" 2>/dev/null
  elif command -v nc >/dev/null 2>&1; then
    nc -z 127.0.0.1 "$PORT" 2>/dev/null
  else
    return 1
  fi
}

case "${1:-start}" in
  stop)
    if [ -f "$PIDF" ]; then
      if kill "$(cat "$PIDF")" 2>/dev/null; then
        echo "已停止 (pid $(cat "$PIDF"))"
      else
        echo "pid 文件存在但进程已不存在，清除 pid 文件"
      fi
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
  open "http://localhost:$PORT" 2>/dev/null || true
  exit 0
fi

# 前端产物缺失或过旧时先构建
if [ ! -f dist/index.html ]; then
  echo "==> dist 不存在，先构建前端..."
  "$NODE_BIN" ./node_modules/vite/bin/vite.js build || exit 1
fi

# 服务端 bundle 缺失时构建
if [ ! -f server-build/server.cjs ]; then
  echo "==> server-build 不存在，先构建服务端 bundle..."
  bash ./build-server-bundle.sh || exit 1
fi

# 守护化启动（setsid + 双 fork），pid 写盘
PYTHON_BIN="$(command -v python3 2>/dev/null || command -v python 2>/dev/null || true)"
if [ -z "$PYTHON_BIN" ]; then
  echo "[错误] 守护化启动需要 python3（或 python）。请安装 Python 3 后重试。"
  echo "也可以临时改用：nohup $NODE_BIN server-build/server.cjs > $LOG 2>&1 &"
  exit 1
fi

"$PYTHON_BIN" - "$PORT" "$LOG" "$PIDF" "$NODE_BIN" <<'PY'
import os, sys
port, log, pidf, node_bin = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
if os.fork() > 0:
    os._exit(0)
os.setsid()
pid = os.fork()
if pid > 0:
    # 子进程即最终的 node 服务进程（execv 不改变 pid）
    with open(pidf, 'w') as f:
        f.write(str(pid))
    os._exit(0)
os.chdir(os.path.dirname(os.path.abspath('start.command')))
fd = os.open(log, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o644)
os.dup2(fd, 1); os.dup2(fd, 2)
os.execv(node_bin, [node_bin, 'server-build/server.cjs'])
PY

# 等端口就绪
for i in $(seq 1 30); do
  if port_alive; then break; fi
  sleep 0.5
done

if port_alive; then
  echo "==> 已启动：http://localhost:$PORT"
  echo "==> 日志：$LOG"
  echo "==> 停止：./start.command stop"
  open "http://localhost:$PORT" 2>/dev/null || true
else
  echo "启动失败，查看日志："; tail -20 "$LOG"; exit 1
fi
