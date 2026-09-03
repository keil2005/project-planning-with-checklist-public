@echo off
chcp 65001 >nul
REM ============================================================
REM plan-gantt 一键启动（共享盘零安装版）
REM 双击本文件即可：自动连接共享盘并调用修正版启动器
REM 说明：本机无需安装 Node，启动器会自动定位 WorkBuddy 自带 Node
REM ============================================================
pushd "\\192.0.2.8\r&d\00 public\PM tool\plan-gantt"
if errorlevel 1 (
  echo [错误] 无法连接共享盘 \\192.0.2.8\r&d，请确认网络/映射盘已连接。
  pause
  exit /b 1
)
call "start-plan-gantt v1.1.0.bat"
popd
