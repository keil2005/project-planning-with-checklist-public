@echo off
chcp 65001 >nul
REM ============================================================
REM  plan-gantt · 启用 MPP 导入（可选增强）
REM
REM  默认部署包是零依赖的，不带 Java/MPXJ，导入按钮会提示「未启用」。
REM  运行本脚本一次性补齐运行时，装完重启服务即可导入 .mpp/.mpx/.xml。
REM
REM  JRE 装到本机 %LOCALAPPDATA%\plan-gantt\jre（不在共享盘上），
REM  以避开共享盘执行 .exe 的 IT 策略风险。
REM
REM  若共享盘屏蔽了 .bat（公司文件服务器常见），改用命令行：
REM    powershell -NoProfile -ExecutionPolicy Bypass -File "server\mpxj\enable-mpp-import.ps1"
REM ============================================================
pushd "%~dp0"
if errorlevel 1 (
  echo 无法访问脚本所在目录（共享盘不可访问？）
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server\mpxj\enable-mpp-import.ps1" %*
echo.
popd
pause
