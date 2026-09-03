# 部署说明 · plan-gantt（跨平台网页版甘特图计划工具）

> 本说明面向「开发完成、准备上传部署到内部服务器」的场景。Mac / Windows 客户端均用浏览器访问，无需安装任何东西。

## 1. 运行环境要求
- 内部服务器安装 **Node.js 20+**（已在项目中用 Node 22 验证）。
- 目标数据文件夹在**服务器本机可访问**（Mac 下如 `/Volumes/dev/00 public/PM tool`，Windows 下映射为 `Z:\00 public\PM tool`）。
- 一个空闲 TCP 端口（默认 **3001**，可在 `config/app.config.json` 改）。

## 2. 部署步骤
1. 将整个项目文件夹拷贝到内部服务器（例如放到 `R&D/00 public/PM tool/plan-gantt/`）。
2. 进入项目目录，安装依赖：
   ```bash
   npm install
   ```
3. 构建前端（生成 `dist/`，生产由 Express 静态托管）：
   ```bash
   npm run build
   ```
4. 指定数据存储目录（三选一，优先级 环境变量 > app.config.json > 默认 `./data`）：
   - 推荐：设置环境变量 `DATA_DIR` 指向内部文件夹
     - Mac/Linux：`export DATA_DIR="/Volumes/dev/00 public/PM tool"`
     - Windows（PowerShell）：`$env:DATA_DIR = "Z:\00 public\PM tool"`
   - 或编辑 `config/app.config.json` 的 `dataDir` 字段为绝对路径。
5. 启动服务（生产模式）：
   ```bash
   npm start
   ```
   服务监听 `http://0.0.0.0:3001`，同时托管前端页面与 API。
6. 客户端使用：Mac/Win 浏览器打开 `http://<服务器IP>:3001` → 从用户列表选身份 → 进入。

## 3. 开发模式（本地联调）
```bash
npm run dev        # 同时起 vite(前端) + tsx watch(后端 API)，前端默认 http://localhost:5173
npm run test       # 运行 vitest 单测（shared + server 共 69 例）
```

## 4. 用户管理
- 编辑 `config/users.json`，填入真实内部用户名单（如 `["张三","李四","王五"]`）。
- 启动 App 时从列表选人（无登录），仅用于记录编辑者与变更纪要；服务端不校验身份真实性。

## 5. 多用户协作与编辑锁
- 多人可同时打开查看。
- 一人点「编辑」→ 服务端记录持有者，其他人编辑按钮禁用；防并发错乱。
- 编辑者每 10s 心跳；断网/关页/超时 30s 服务端自动释放锁（内存锁，单进程部署前提）。
- ⚠️ 当前为**单进程内存锁**：请只用**单实例**运行 `npm start`；多实例/多机部署需要先做文件锁改造（设计已预留 `LockService` 接口）。

## 6. 数据落盘位置
- 每个计划在 `DATA_DIR/plans/<planId>/` 下存两份：
  - `plan.json`：当前计划
  - `history.json`：版本快照（append-only），每条含 `{版本号, 时间戳, 编辑者, notes, 完整计划快照}`
- 每次保存变更都会追加一条历史（保存前必须填 notes），为将来 AI 分析备料。
- 回滚 = 取旧快照追加为新版本，旧版本不删不改。

## 7. 导出（对外分享）
- 工具栏「导出 XML」→ MS Project 开放格式（MSPDI），可被 MS Project / ProjectLibre / GanttProject 导入；含 7×8h 自然日历、依赖类型映射（FF=0/FS=1/SF=2/SS=3）、偏移换算。
- 工具栏「导出 CSV」→ 带 UTF-8 BOM，Excel 直开。

## 7.1 MPP 导入能力门（部署相关，重要）
- **仅本机 Mac + Java 环境支持 `.mpp/.mpx/.xml` 导入**；Windows 共享包**按设计不支持**导入。
- 机制：能力门 `isMppImportAvailable()` 要求 `java` 在 PATH 且 `server/mpxj/MppImport.class` 存在。Windows 部署包**不含 `server/mpxj/` 目录** → 自动返回 **HTTP 501**（错误码 `ERR_FEATURE_DISABLED`），前端「导入」按钮给出可读提示，非故障。
- 本机启用：`bash server/mpxj/fetch-mpxj.sh` 下载 MPXJ 13.5.0 + 编译桥接，重启服务即可导入。
- 踩坑详见 `docs/LESSON_LEARN.md`（classpath `lib/*`、MSPDI 需 `jaxb-core`、真 `.mpp` 需 `log4j-api`+`log4j-core`、MPX 中文乱码、时间语义）。

## 8. 后续迭代预留的扩展位（已在架构中留好）
- 工作日历 / 节假日（`Plan.calendar.mode` + 全部日期函数带 calendar 形参）
- 资源 / 负责人 / 进度% / 里程碑
- 多进程文件锁（LockService 已抽接口）
- 历史快照外置（`versions[].snapshotRef`）
- 计划 schema 迁移（`schemaVersion` + `migrate()` 钩子）

## 9. 时间语义约定（与需求一致）
- 开始/结束格式 `YYYY-MM-DD`；时长 `1d/1w/1m`（日/周/自然月，如 8-26 +1m = 9-26，1-31 +1m = 2-28）。
- 甘特区间左闭右开 `[start, end)`；开始、结束、时长三者最多指定 2 个，第 3 个自动推算。
- 父子任务：父时间 = 子任务最早开始 / 最晚结束（派生，灰显只读）。
- 依赖：`ID + 类型 + 偏移`，如 `3FF+1w`（FS/SS/FF/SF，偏移 1d/1w/1m，可多条逗号分隔）。
