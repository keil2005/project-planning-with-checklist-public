#!/usr/bin/env bash
# 将 server/*.ts 预打包为单文件 Node 可执行服务（server-build/server.cjs）。
# 用途：让 Windows 共享盘部署包【无需 npm install】即可运行，仅需 node.exe。
#
# 运行环境：需在本机（Mac/具备完整 node_modules 的开发机）执行。
# 依赖：node_modules/.bin/esbuild（vite 自带）。
set -euo pipefail
cd "$(dirname "$0")"

mkdir -p server-build
echo "==> bundling server/index.ts -> server-build/server.cjs"
node_modules/.bin/esbuild server/index.ts \
  --bundle --platform=node --target=node18 --format=cjs \
  --outfile=server-build/server.cjs \
  --log-level=warning
echo "done: $(ls -la server-build/server.cjs | awk '{print $5}') bytes"
