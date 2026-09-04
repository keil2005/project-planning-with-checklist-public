﻿@echo off
chcp 65001 >nul
pushd "%~dp0"
if errorlevel 1 (
  echo [错误] 无法切换到脚本所在目录（共享盘不可访问？请确认 \\192.0.2.8\r&d 已连接）。
  pause
  exit /b 1
)

echo ============================================================
echo  plan-gantt 启动脚本 (Windows / 共享盘部署版 - 零安装 - 修正版)
echo ============================================================
echo.

REM ---------------------------------------------------------------------------
REM 0) 定位 node.exe
REM    本部署包已内置预打包的服务 (server-build\server.cjs)，运行时【无需 npm install】
REM    只需 Windows 上有 Node.js 20+。优先用 PATH，否则扫描常见安装位置。
REM    注意：WorkBuddy 自带 Node 的真实安装位置是
REM      %USERPROFILE%\.workbuddy\binaries\node\versions\<ver>\node.exe
REM    （node.exe 直接在版本目录下，没有 bin\ 子目录；且位于 USERPROFILE 而非 LOCALAPPDATA）
REM ---------------------------------------------------------------------------
set "NODE_EXE="

REM 0a) PATH 中查找
where node >nul 2>nul
if not errorlevel 1 (
  for /f "delims=" %%i in ('where node') do ( set "NODE_EXE=%%i" & goto :node_found )
)

REM 0b) WorkBuddy 自带 Node —— 兼容两种布局（有无 bin\ 子目录、USERPROFILE 或 LOCALAPPDATA）
for %%B in (
  "%USERPROFILE%\.workbuddy\binaries\node\versions"
  "%LOCALAPPDATA%\WorkBuddy\binaries\node\versions"
) do (
  if exist %%B (
    for /d %%D in ("%%B\*") do (
      if exist "%%D\node.exe"     ( set "NODE_EXE=%%D\node.exe"     & goto :node_found )
      if exist "%%D\bin\node.exe" ( set "NODE_EXE=%%D\bin\node.exe" & goto :node_found )
    )
  )
)
REM 兜底：直接按已知固定版本目录查找（避免通配符展开异常时漏掉）
if exist "%USERPROFILE%\.workbuddy\binaries\node\versions\22.22.2\node.exe" (
  set "NODE_EXE=%USERPROFILE%\.workbuddy\binaries\node\versions\22.22.2\node.exe" & goto :node_found
)
if exist "%LOCALAPPDATA%\WorkBuddy\binaries\node\versions\22.22.2\node.exe" (
  set "NODE_EXE=%LOCALAPPDATA%\WorkBuddy\binaries\node\versions\22.22.2\node.exe" & goto :node_found
)

REM 0c) nvm（用户级 / 系统级，版本目录未知）
for %%B in ("%APPDATA%\nvm" "C:\nvm" "C:\ProgramData\nvm") do (
  if exist %%B (
    for /d %%D in ("%%B\*") do (
      if exist "%%D\node.exe" ( set "NODE_EXE=%%D\node.exe" & goto :node_found )
    )
  )
)

REM 0d) 官方安装器默认路径
for %%P in ("%ProgramFiles%\nodejs\node.exe" "%ProgramFiles(x86)%\nodejs\node.exe") do (
  if exist %%P ( set "NODE_EXE=%%P" & goto :node_found )
)

:node_not_found
if "%NODE_EXE%"=="" (
  echo [错误] 未找到 Node.js (node.exe)。
  echo.
  echo 请任选其一：
  echo   1) 将 Node.js 安装目录加入系统 PATH（推荐 Node 20+）。
  echo   2) 若用 WorkBuddy 自带 Node，请把类似下面路径加入 PATH 后重开资源管理器：
  echo      %USERPROFILE%\.workbuddy\binaries\node\versions\22.22.2
  echo   3) 或把 node.exe 复制到本程序目录下。
  echo.
  echo 安装 Node：https://nodejs.org/ （LTS 版即可）
  popd
  pause
  exit /b 1
)

:node_found
echo [信息] 使用 Node：%NODE_EXE%
for /f "tokens=1" %%v in ('"%NODE_EXE%" -v') do echo [信息] Node 版本：%%v
echo.

REM ---------------------------------------------------------------------------
REM 1) 启动服务（生产模式：托管 dist/ 静态前端 + /api）
REM    端口默认 3001；改端口：set PORT=8080 后运行，或改 config\app.config.json
REM    数据目录默认 .\data（共享盘天然共享）；改：set DATA_DIR=绝对路径
REM ---------------------------------------------------------------------------
if not exist "server-build\server.cjs" (
  echo [错误] 缺少预打包服务文件 server-build\server.cjs
  echo 请确认部署包完整（不要删除 server-build 目录）。
  popd
  pause
  exit /b 1
)

echo [信息] 启动服务，浏览器访问 http://localhost:3001
echo [提示] 按 Ctrl+C 停止服务（会释放编辑锁）。
echo [提示] 窗口保持打开；若服务异常退出，请截图本窗口报错给我排查。
echo [提示] 服务就绪后将自动打开浏览器（约 2 秒）。
echo ------------------------------------------------

REM 启动后自动打开默认浏览器（延迟约 2 秒，等服务监听 3001）
start "" cmd /c "ping -n 3 127.0.0.1 >nul && start http://localhost:3001"

"%NODE_EXE%" server-build\server.cjs

popd
echo.
echo [信息] 服务已停止（exit code=%errorlevel%）。
pause
