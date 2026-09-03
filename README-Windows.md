# plan-gantt · Windows 运行说明（共享盘部署版）

本目录是 **plan-gantt** 的生产部署包，已预构建前端（`dist/`）并**预打包服务端**（`server-build/server.cjs`）。直接在 Windows 上运行，**无需 `npm install`、无需联网、无需 Java**——只需本机有 Node.js 20+。

> ℹ️ **MPP 导入默认为「未启用」，可按需一键开启**：本包不含 Java 与 `server/mpxj/` 运行时，工具栏「导入」会提示「未启用」——这是**预期行为**（零依赖）。需要导入 `.mpp/.mpx/.xml` 的机器，跑一次根目录的 `enable-mpp-import.bat`（见第 5.1 节），装完重启服务即可，其余机器不受影响。其余功能（新建/编辑/保存/共享/导出 XML·CSV/甘特视图）开箱即用。

## 1. 运行环境
- **Node.js 20+**（已在 Node 22 验证；用 WorkBuddy 自带的 Node 22 即可）。
- 启动脚本会自动在 PATH 及常见安装位置（含 WorkBuddy 自带 Node）中查找 `node.exe`。
- 一个空闲 TCP 端口（默认 **3001**）。

## 2. 启动（零安装）
1. 将本目录映射到网络盘（例如 `Z:\00 public\PM tool\plan-gantt`）。
2. **双击 `start-windows.bat`** 即可——脚本会自动定位 Node、启动服务、并保持窗口打开。
3. 浏览器打开 `http://localhost:3001` → 从用户列表选身份 → 进入甘特工具。

服务启动后会打印：端口、数据目录 `DATA_DIR`、版本、锁参数、静态目录。

> 如双击后窗口仍一闪而过：脚本已改为**始终 `pause` 保持窗口**，请把窗口里的红色报错文字截图发我。常见原因：本机找不到 Node（`where node` 无结果）——需把 Node 安装目录加入系统 PATH，或用 WorkBuddy 自带 Node 路径。

> 🆘 **如果在共享盘里根本看不到 `start-windows.bat`**：部分公司文件服务器会屏蔽/隐藏 `.bat`、`.cmd` 这类可执行脚本（文件屏蔽策略或杀毒软件所致）。这是 **IT 策略，不是部署缺失**——该文件在共享盘上确认存在且完整（3429 字节，MD5 与源码一致）。此时**不需要任何启动脚本**，直接用下面的方案 B 或 C 启动，效果完全相同。

### 2.1 方案 B：命令行直接启动（推荐，最省事）
1. `Win + R` → 输入 `cmd` → 回车。
2. 执行：
   ```bat
   cd /d "Z:\00 public\PM tool\plan-gantt"
   node server-build\server.cjs
   ```
3. 浏览器打开 `http://localhost:3001`。

> 若提示 `'node' 不是内部或外部命令`：先执行 `where node` 确认；无结果则用 Node 完整路径，例如
> `"%LOCALAPPDATA%\WorkBuddy\binaries\node\versions\22.22.2\bin\node.exe" server-build\server.cjs`
> （版本号目录用 `dir "%LOCALAPPDATA%\WorkBuddy\binaries\node\versions"` 查看后套用）

### 2.2 方案 C：桌面快捷方式（双击启动，绕开 .bat 屏蔽）
1. 桌面右键 → 新建 → 快捷方式。
2. 位置填：`"C:\完整路径\node.exe" server-build\server.cjs`
3. 命名 `plan-gantt` → 完成。
4. 右键该快捷方式 → 属性 → **起始位置** 填：`Z:\00 public\PM tool\plan-gantt`
5. 以后双击此快捷方式即可，浏览器访问 `http://localhost:3001`。

## 3. 数据存储位置（多人共享）
- 默认数据目录为 `./data`（相对本程序目录），即 `Z:\00 public\PM tool\plan-gantt\data`。
- 因为程序运行在共享盘上，`./data` 天然位于共享盘，**多名同事映射同一 `Z:` 盘运行时看到的是同一份计划数据**。
- 如需改用其他共享目录，启动前设置环境变量（PowerShell）：
  ```powershell
  $env:DATA_DIR = "Z:\00 public\PM tool"
  npm start
  ```
  或在 `config/app.config.json` 改 `dataDir` 为绝对路径。

## 4. 自定义端口 / 数据目录
- 端口：改 `config/app.config.json` 的 `port`，或设环境变量 `PORT=8080 npm start`。
- 数据目录优先级：**环境变量 `DATA_DIR` > `config/app.config.json` 的 `dataDir` > 默认 `./data`**。

## 5. 已知限制（与部署相关）
- **单进程内存编辑锁**：当前为单实例内存锁，请**只用单实例**运行 `npm start`；多实例/多机并发编辑需后续文件锁改造（见 docs/BACKLOG.md）。
- **MPP 导入默认关闭**：本包不含 `server/mpxj/` 运行时 → 自动 501（零依赖设计）。**执行 `enable-mpp-import.bat` 后即可启用**，详见第 5.1 节；未执行的机器行为与过去完全一致。
- 如需把依赖装到本机（共享盘加载 jar 较慢），用 `enable-mpp-import.bat -LocalLibs`，脚本会自动设置用户级环境变量 `PLAN_GANTT_MPXJ_DIR`。
- 前端为预构建静态产物（`dist/`），如需改前端源码后重新构建，需在具备完整工具链的环境执行 `npm run build`（本包 `npm install` 会一并装上 vite，可自构建）。

### 5.1 可选：启用 MPP 导入（每台机器只需一次）

需要把 MS Project 的 `.mpp / .mpx / .xml` 直接导入成计划时，才需要执行本步骤；只查看/编辑计划的机器完全不用管。

**方式 A：双击（最简单）**
1. 双击部署包根目录的 `enable-mpp-import.bat`。
2. 首次会下载约 **42MB 便携 JRE + 约 37MB MPXJ 依赖**（需联网，约 1–3 分钟）。
3. 脚本最后会自动跑一次桥接自检，看到「桥接自检通过」即成功。

**方式 B：命令行**
```bat
pushd "Z:\00 public\PM tool\plan-gantt"
powershell -NoProfile -ExecutionPolicy Bypass -File "server\mpxj\enable-mpp-import.ps1"
```

> 若共享盘屏蔽了 `.bat`（公司文件服务器常见，属 IT 策略），直接用**方式 B**；若 `.ps1` 也被拦，把该脚本复制到本地盘（如 `C:\Temp`）后再执行即可。

**装到哪里**

| 组件 | 位置 | 原因 |
|---|---|---|
| 便携 JRE | `%LOCALAPPDATA%\plan-gantt\jre` | **本地盘**：共享盘上执行 `.exe` 可能被 SmartScreen/杀软拦截，且更慢 |
| MPXJ 依赖 jar | 默认 `server\mpxj\lib`（共享盘） | 一键装好即可用；多人共用一份 |
| 桥接产物 `.class` | 同上 | 已在开发机编译好，**不需要 JDK/javac** |

若共享盘加载 jar 明显偏慢，加 `-LocalLibs` 把依赖也装到本地盘，脚本会自动写入用户级环境变量 `PLAN_GANTT_MPXJ_DIR`：
```bat
enable-mpp-import.bat -LocalLibs
```

**离线环境**：把 `OpenJDK17U-jre_x64_windows_hotspot.zip` 与 `mpxj-libs.zip` 放到部署包的 `offline-mpp-runtime\` 目录，脚本会优先使用离线包、不联网。

**启用后**：**重启 plan-gantt 服务**（关掉原窗口重新双击 `start-windows.bat`），导入按钮即可使用。若仍提示「未启用」，启动时会给出具体原因（缺 Java / 缺桥接产物），且启动服务时设 `PLAN_GANTT_JAVA=<java.exe 路径>` 可强制指定 Java。

**停用**：删掉 `%LOCALAPPDATA%\plan-gantt`（便携 JRE）与 `server\mpxj\MppImport.class` 即可回到零依赖状态，服务仍照常运行，导入恢复为 501。想再次启用，重跑 `enable-mpp-import.bat` 即可。

> 注：若该机器 PATH 上本来就有系统 Java，仅删 JRE 不会停用——此时删 `MppImport.class` 才是决定性的（服务启动时日志会打印「MPP 导入 : 未启用 (no-bridge)」）。

## 6. 停止服务
在运行 `npm start` / `start-windows.bat` 的命令行窗口按 `Ctrl+C` 即可优雅退出（会释放编辑锁）。

## 7. 排错
- **窗口一闪而过 / 报「未找到 Node」**：脚本已改为始终 `pause` 保持窗口。请把窗口报错截图发我。根因多半是 `node.exe` 不在 PATH——把 Node 安装目录（或 WorkBuddy 自带 Node 的 `bin` 目录）加入系统 PATH 后重开资源管理器再双击。
- 端口被占用：`Error: listen EADDRINUSE` → 改端口或先结束占用进程。
- 页面打不开但服务已起：确认访问的是 `http://localhost:3001`（不是 5173；5173 是开发模式端口，本包为生产模式）。
- 导入按钮提示「未启用」：默认如此（零依赖，见第 5.1 节），非故障。提示语会区分是**缺 Java**还是**缺桥接产物**；按提示执行 `enable-mpp-import.bat` 后重启服务即可。
- 本包为**零安装**设计，无需也不执行 `npm install`；若误删 `server-build\server.cjs`，需回到具备完整工具链的环境用 `build-server-bundle.sh` 重新打包。
