@echo off
REM Project Planning with Checklist · Windows 一键启动 / 停止
REM
REM 用法：
REM   start.bat         启动（双击或 cmd 调用都行）
REM   start.bat stop    停止
REM   start.bat status  查看状态
REM
REM 启动后用浏览器打开 http://localhost:3001
chcp 65001 >nul
cd /d %~dp0

setlocal

set "PORT=3001"
set "LOG=%TEMP%\project-planning-with-checklist.log"
set "PIDF=%TEMP%\project-planning-with-checklist.pid"

REM ---------------------------------------------------------------------------
REM 0) 定位 node.exe
REM    本部署包已内置预打包的服务 (server-build\server.cjs)，运行时【无需 npm install】
REM    只需 Windows 上有 Node.js 20+ 即可。优先用 PATH，否则扫描常见安装位置。
REM ---------------------------------------------------------------------------
set "NODE_EXE="

REM 0a) PATH 中查找
where node >nul 2>nul
if not errorlevel 1 (
  for /f "delims=" %%i in ('where node') do ( set "NODE_EXE=%%i" & goto :node_found )
)

REM 0b) 常见安装位置
for %%P in (
  "%ProgramFiles%\nodejs\node.exe"
  "%ProgramFiles(x86)%\nodejs\node.exe"
  "%LocalAppData%\Programs\nodejs\node.exe"
  "%LocalAppData%\nodejs\node.exe"
) do (
  if exist %%P ( set "NODE_EXE=%%P" & goto :node_found )
)

REM 0c) nvm（用户级 / 系统级）
for %%B in ("%APPDATA%\nvm" "C:\nvm" "C:\ProgramData\nvm") do (
  if exist %%B (
    for /d %%D in ("%%B\*") do (
      if exist "%%D\node.exe" ( set "NODE_EXE=%%D\node.exe" & goto :node_found )
    )
  )
)

:node_not_found
if "%NODE_EXE%"=="" (
  echo [错误] 未找到 Node.js (node.exe)。
  echo.
  echo 请任选其一：
  echo   1) 安装 Node.js 20+：https://nodejs.org/ （LTS 版即可）
  echo   2) 将现有的 Node.js 安装目录加入系统 PATH 后重开 cmd。
  echo.
  pause
  exit /b 1
)

:node_found
echo [信息] 使用 Node：%NODE_EXE%
for /f "tokens=1" %%v in ('"%NODE_EXE%" -v') do echo [信息] Node 版本：%%v
echo.

REM ---------------------------------------------------------------------------
REM 命令分发（start / stop / status）
REM ---------------------------------------------------------------------------
if /i "%~1"=="stop" goto :do_stop
if /i "%~1"=="status" goto :do_status

REM ---------------------------------------------------------------------------
REM 0.5) 默认凭据：首次启动时若未通过环境变量指定 admin，则注入 README 公开的默认值
REM      想要覆盖：set ADMIN_USER=xxx ^& set ADMIN_PASSWORD=yyy ^& start.bat
REM      安全提示：部署到生产前务必覆盖默认密码！
REM ---------------------------------------------------------------------------
if not defined ADMIN_USER set "ADMIN_USER=admin"
if not defined ADMIN_PASSWORD set "ADMIN_PASSWORD=admin12345"

REM ---------------------------------------------------------------------------
REM 1) 检查端口是否已占用
REM ---------------------------------------------------------------------------
powershell -NoProfile -Command "$c=New-Object Net.Sockets.TcpClient;try{$c.Connect('127.0.0.1',$env:PORT);$c.Close();exit 0}catch{exit 1}" >nul 2>nul
if not errorlevel 1 (
  echo [信息] 端口 %PORT% 已在监听，假定服务运行中。
  echo [信息] 浏览器访问 http://localhost:%PORT%
  echo [信息] 如需重启请先运行 start.bat stop
  pause
  exit /b 0
)

REM ---------------------------------------------------------------------------
REM 2) 检查预打包产物
REM ---------------------------------------------------------------------------
if not exist "server-build\server.cjs" (
  echo [错误] 缺少预打包服务文件 server-build\server.cjs
  echo 请确认部署包完整（不要删除 server-build 目录），或在本机运行：
  echo     npm install ^&^& npm run build
  pause
  exit /b 1
)

REM ---------------------------------------------------------------------------
REM 3) 启动（不阻塞当前窗口；写到 log + pid 文件）
REM ---------------------------------------------------------------------------
echo [信息] 启动服务，浏览器访问 http://localhost:%PORT%
echo [提示] 关闭此窗口会停止服务（或运行 start.bat stop）
echo [提示] 日志：%LOG%
echo ------------------------------------------------

REM 启动 + 写 pid：把 node 进程的 PID 通过 PowerShell 启动脚本获取
powershell -NoProfile -Command "$p = Start-Process -FilePath '%NODE_EXE%' -ArgumentList 'server-build/server.cjs' -RedirectStandardOutput '%LOG%' -RedirectStandardError '%LOG%' -WindowStyle Hidden -PassThru; Set-Content -Path '%PIDF%' -Value $p.Id; Write-Host \"pid=$($p.Id)\""

REM 等端口就绪
echo [信息] 等待服务就绪 ...
set /a cnt=0
:wait_loop
powershell -NoProfile -Command "$c=New-Object Net.Sockets.TcpClient;try{$c.Connect('127.0.0.1',$env:PORT);$c.Close();exit 0}catch{exit 1}" >nul 2>nul
if not errorlevel 1 goto :ready
set /a cnt+=1
if %cnt% GTR 30 (
  echo [错误] 服务启动超时。查看日志：%LOG%
  pause
  exit /b 1
)
timeout /t 1 /nobreak >nul
goto :wait_loop

:ready
echo [信息] 服务已就绪：http://localhost:%PORT%
endlocal
exit /b 0

REM ---------------------------------------------------------------------------
REM stop 分支
REM ---------------------------------------------------------------------------
:do_stop
if exist "%PIDF%" (
  for /f "usebackq delims=" %%P in ("%PIDF%") do (
    echo [信息] 终止 pid=%%P
    taskkill /F /PID %%P >nul 2>nul
  )
  del "%PIDF%" >nul 2>nul
  echo [信息] 已停止。
) else (
  echo [信息] 未找到 pid 文件，服务可能未运行。
)
endlocal
exit /b 0

REM ---------------------------------------------------------------------------
REM status 分支
REM ---------------------------------------------------------------------------
:do_status
powershell -NoProfile -Command "$c=New-Object Net.Sockets.TcpClient;try{$c.Connect('127.0.0.1',$env:PORT);$c.Close();'运行中 http://localhost:$env:PORT'}catch{'未运行'}" >nul 2>nul
echo.
endlocal
exit /b 0
