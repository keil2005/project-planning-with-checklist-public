#!/bin/bash
# ============================================================================
# sync-to-share.sh —— 把本地「Project-A timeline review」最新版双写到共享端
#
# 背景（用户约定 2026-09-04）：本地编辑的 Project-A 计划，默认同步到共享端
#   /Volumes/dev/00 public/PM tool/Project-A/ ，供团队查看 / 备份。
#
# 产物三件套（每次全量覆盖，--delete 清掉旧版本号残留）：
#   1) Project-A timeline review-v<版本>.csv      —— UTF-8 BOM，Excel 直接打开
#   2) Project-A timeline review-v<版本>.xml      —— MSPDI，MS Project / ProjectLibre 可导入
#   3) Project-A timeline review-v<版本>.plan.json —— 完整计划数据（含 todo/依赖/工作日历）
#
# 用法：
#   bash sync-to-share.sh            # 用本地 3001 服务导出（默认）
#   bash sync-to-share.sh 3001       # 显式指定服务端口
#   bash sync-to-share.sh --dry-run  # 只打印将执行的动作，不落盘
#
# 依赖：一个运行中的 plan-gantt 本地服务（提供 /export 端点）。
# ============================================================================
set -euo pipefail

# ---- 参数解析 ----
PORT="3001"
DRY_RUN="0"
for a in "$@"; do
  case "$a" in
    --dry-run) DRY_RUN="1" ;;
    *) PORT="$a" ;;
  esac
done

BASE="http://localhost:${PORT}/api"
SHARE_DIR="/Volumes/dev/00 public/PM tool/Project-A"
PROJ_DIR="$(cd "$(dirname "$0")" && pwd)"
LOCAL_PLANS_DIR="$PROJ_DIR/data/plans"
PLAN_NAME="Project-A timeline review"

# ---- 1. 定位 name=Project-A timeline review 的最新版本计划 ----
LATEST_DIR=""
LATEST_VER=-1
if [ -d "$LOCAL_PLANS_DIR" ]; then
  for d in "$LOCAL_PLANS_DIR"/p-*/; do
    pj="$d/plan.json"
    [ -f "$pj" ] || continue
    name=$(/usr/bin/python3 -c "import json,sys;print(json.load(open(sys.argv[1])).get('name',''))" "$pj" 2>/dev/null || echo "")
    [ "$name" = "$PLAN_NAME" ] || continue
    ver=$(/usr/bin/python3 -c "import json,sys;print(json.load(open(sys.argv[1])).get('version',0))" "$pj" 2>/dev/null || echo 0)
    if [ "$ver" -gt "$LATEST_VER" ]; then LATEST_DIR="$d"; LATEST_VER="$ver"; fi
  done
fi

if [ -z "$LATEST_DIR" ]; then
  echo "❌ 未在 $LOCAL_PLANS_DIR 找到「$PLAN_NAME」计划"
  exit 1
fi
PLAN_ID="$(basename "$LATEST_DIR")"
echo "ℹ️  最新计划：$PLAN_ID （$PLAN_NAME v$LATEST_VER）"

CSV="/tmp/Project-A timeline review-v${LATEST_VER}.csv"
XML="/tmp/Project-A timeline review-v${LATEST_VER}.xml"
PLANJSON="/tmp/Project-A timeline review-v${LATEST_VER}.plan.json"

if [ "$DRY_RUN" = "1" ]; then
  echo "[dry-run] 将执行："
  echo "  1) curl $BASE/plans/$PLAN_ID/export?format=csv   → $CSV"
  echo "  2) curl $BASE/plans/$PLAN_ID/export?format=mspdi → $XML"
  echo "  3) cp  $LATEST_DIR/plan.json                     → $PLANJSON"
  echo "  4) rsync -a --delete 三件套 → $SHARE_DIR/"
  exit 0
fi

# ---- 2. 导出 CSV + MSPDI（走本地服务端点）----
echo "↳ 导出 CSV..."
curl -s -m 20 "${BASE}/plans/${PLAN_ID}/export?format=csv" -o "$CSV"
echo "↳ 导出 MSPDI XML..."
curl -s -m 20 "${BASE}/plans/${PLAN_ID}/export?format=mspdi" -o "$XML"

# 导出失败快速失败：CSV 若不含表头即视为失败
if ! head -c 20 "$CSV" | grep -q "行号"; then
  echo "❌ CSV 导出失败（服务 $BASE 是否在运行？）。已中止，不覆盖共享端。"
  exit 1
fi

# ---- 3. 复制 plan.json 完整数据 ----
cp "$LATEST_DIR/plan.json" "$PLANJSON"

# ---- 4. 同步到共享端 Project-A 文件夹 ----
mkdir -p "$SHARE_DIR"
rsync -a --delete "$CSV" "$XML" "$PLANJSON" "$SHARE_DIR/"

echo "✅ 已双写到 $SHARE_DIR"
ls -la "$SHARE_DIR"
