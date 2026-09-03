# plan-gantt · 启动修复说明（Windows / 共享盘）

## 问题现象
双击（或从 UNC 路径 `\\192.0.2.8\r&d\...` 直接运行）启动脚本时，出现过两类报错：

1. **「未找到 Node.js (node.exe)」** —— 原 `start-windows.bat` 的 Node 路径写错。
2. **「CMD does not support UNC paths as current directories」+「缺少预打包服务文件 server-build\server.cjs」+ 一堆中文行报「不是内部或外部命令」** —— 修正版 `start-plan-gantt.bat` 初版的两个新 bug。

## 根因与修复

### Bug A：Node 路径写错（原 start-windows.bat）
WorkBuddy 自带 Node 的真实 Windows 路径是 `%USERPROFILE%\.workbuddy\binaries\node\versions\<ver>\node.exe`：
- 在 **USERPROFILE** 下，不是 `%LOCALAPPDATA%\WorkBuddy\...`；
- 官方 Windows 包里 `node.exe` 直接在版本目录**下，没有 `bin\` 子目录**；
- 普通双击时系统注册表 PATH 里通常没有 node（WorkBuddy 只在自己会话注入 PATH）。
修复：扫描 `%USERPROFILE%\.workbuddy` 与 `%LOCALAPPDATA%\WorkBuddy` 两种布局、两种形态，并加固定版本兜底。

### Bug B：UNC 不能作为 cmd 当前目录（初版 start-plan-gantt.bat）
初版用 `cd /d %~dp0` 切到脚本所在目录。但当脚本位于 UNC 共享路径时，cmd 拒绝把 UNC 设为当前目录，`cd` 失败退回 Windows 目录，于是相对路径 `server-build\server.cjs` 解析不到 → 报「缺少预打包服务文件」。
修复：改用 **`pushd "%~dp0"`**。pushd 对 UNC 会自动映射一个临时盘符并 cd 过去，是 UNC 启动的标准解法；结尾 `popd` 清理。

### Bug C：UTF-8 无 BOM 导致中文注释被当命令（初版 start-plan-gantt.bat）
初版 .bat 以 UTF-8 无 BOM 保存，在中文 Windows 默认 CP936 代码页下被误读，`REM` 注释前缀丢失，整行中文（如「扫描常见安装位置。」「端口：set …」）被当成命令执行。
修复：文件写成 **UTF-8 BOM（ef bb bf）**，配合顶部 `chcp 65001 >nul`，中文注释/提示不再被误读。

## 现状
已用 **`start-plan-gantt v1.1.0.bat`（修正版 v2：pushd + UTF-8 BOM + CRLF）** 覆盖更新。三处 bug 均已修复并验证：
- Node 定位命中 `%USERPROFILE%\.workbuddy\binaries\node\versions\22.22.2\node.exe`；
- 端口 3001 监听、`/api/health` 返回 200；
- 从共享盘目录直接启动 `server-build\server.cjs` 成功（相对路径解析正常）。

## 用法（任选其一）
1. **直接双击 `start-plan-gantt v1.1.0.bat`**（推荐，已修正）。可从 UNC 网络位置双击，无需先映射盘符。
2. 命令行（方案 B）：
   ```
   "C:\Users\User01.Zheng\.workbuddy\binaries\node\versions\22.22.2\node.exe" server-build\server.cjs
   ```
   注意路径里**没有 `bin\`**；版本号用 `dir "%USERPROFILE%\.workbuddy\binaries\node\versions"` 确认后套用。

服务起来后浏览器访问 `http://localhost:3001`。

> 原 `start-windows.bat` 因共享盘保护无法覆盖，保留原样；请用修正版 `start-plan-gantt v1.1.0.bat`。
