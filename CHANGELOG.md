# Changelog

所有 Project Planning with Checklist 的显著变更都记录在这个文件。格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
项目遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

> **下一次发布**：[Unreleased] — Docker 一键部署 / 多项导出（详见 [IMPL_ROADMAP](./docs/IMPL_ROADMAP.md)）

## [1.2.1] — 2026-09-07

### Fixed
- **ENDPOINT（端点式）日期语义**：`addDuration(start, duration)` 现在返回最后工作日本身（inclusive，「下班时间」），不再多算 1 天
  - 例：start=`2026-08-26` + `3d` → end=`2026-08-28`（旧版错为 `2026-08-29`）
  - 影响：`shared/datetime.ts` `addDuration` / `countWorkingDays`，`shared/scheduler.ts` 排程 #4 / #11 分支，`server/mppImport.ts` 导入结束日，`server/exporters.ts` MSPDI 唯一转换点
- **甘特条对齐语义**：条形宽度按闭区间 `[start, end]` 渲染，end 那条边画在 end 那天右边缘（之前半开会少 1 格）
- **i18n 同步**：`gantt.range` 文案（CN / EN）已说明 K3 端点式

### Tests
- 4 个共享测试文件（`calendar` / `extra` / `scheduler` / `mpp-import`）+ 1 个服务端测试（`exporters`）的 end 期望值改为 inclusive
- 全部 383 个测试通过；tsc 错误数与 v1.2.0 baseline 一致（无新增）

### Compatibility
- 数据 schema 不变；旧 plan.json 文件直接兼容
- `calendar.skipHolidays` 字段（v1.2.0 引入）保留，MPPDI 导入默认 `false`

---

## [Unreleased] — Phase B/C 候选

### Planned
- Docker Compose 一键部署（基于 `server-build/server.cjs`）
- OpenAPI 文档自动生成

---

## [1.2.0] — 2026-09-05

### 重命名
- **项目**：`plan-gantt` → **Project Planning with Checklist**（ppwc）
- 启动器：`start.command`（Mac）+ `start.bat`（Windows）独立文件，不带版本号、不引用旧名
- 内部署材料（共享盘 / 内网主机名 / SMB 路径）全部迁移至 `deploy/internal/`（gitignore）
- 删除：旧的 `start-mac.sh` / `start-windows.bat` / `start-plan-gantt v1.1.1.bat` / `plan-gantt 一键启动 v1.1.1.cmd`

### Added（v1.2.0 新增）
- **身份协作层**：注册 / 登录 / 登出 / 切换工作区 / 邀请加入 / 角色管理
  - `server/auth/{types,store,password,users,workspaces,sessions,invites,middleware,bootstrap}.ts`
  - `server/authRoutes.ts`（REST + cookie session）
  - `server/demoSeed.ts` 单 toy race car 项目（Mia / Leo / Kai / Theo 四角色，12 任务 4 todo）
  - `src/components/AuthGate.tsx` 登录/注册/工作区切换弹窗
  - `src/components/RosterDialog.tsx` 团队花名册管理（owner-only）
  - bcrypt-equivalent scrypt 哈希 + HMAC session token + httpOnly cookie + sliding renewal
  - 单次性 invite token（pending → consumed / revoked / expired）
  - workspace RBAC：owner / editor / viewer
  - admin bootstrap 从 `ADMIN_USER` / `ADMIN_PASSWORD` 环境变量
- **工作日历国定节假日可配置**：每计划新增 `calendar.skipHolidays: boolean` 字段
  - true → `buildServerCalendar()` 用真实工作日历
  - false（默认）→ `NATURAL_CALENDAR` 兜底（每天都是工作日，仅周末视为非工作日）
  - `src/components/Dialogs.tsx` PlanPickerDialog 新增 MUI Checkbox「排程跳过国定节假日（与调休补班）」+ 双行说明
  - 向后兼容：老计划 (skipHolidays 未设) 默认 false

### Changed
- 项目 `package.json`：`name` / `displayName` / `repository` / `author` / `homepage` 全套指向新仓库
- `index.html` 标题与 description
- `git config user.email = keil2005@126.com`，全部 15 条历史 commit 的 author/committer 邮箱为个人邮箱（commit message 不变；hash 因元数据变化整体重写）
- `SECURITY.md` / `CONTRIBUTING.md` 全文 `plan-gantt` → `Project Planning with Checklist` + 商标隔离
- `docs/LICENSE_NOTES.md` 解释 Apache-2.0 而非 AGPL-3.0 / MIT 决策

### Tests
- 23 套件 / 385 例 全绿（shared 181 + server 110 + src 94）
- 段跑：`NODE_OPTIONS=--max-old-space-size=2048 npx vitest run`

### Docs
- 顶层元文件全套（README / LICENSE / CONTRIBUTING / SECURITY / CODE_OF_CONDUCT / CHANGELOG / IMPL_ROADMAP）
- GitHub issue + PR 模板

---

## [1.1.1] — 2026-09-04

### Added
- **U05** TODO 清单 Markdown 导出（菜单 → 导出 → Markdown 清单）
  - `scope=mine` 仅导出 assignee 命中 `isMine` 的任务（≥1 才显示）→ 复用 `shared/people.ts` `isMine`，与 U03 「Assign to me」语义对齐
  - `scope=all` 含任务全部 + 全部 todo（文本 + assignee）
  - 文件名 `{planName}-todos-{scope}-v{version}.md`
  - **服务端渲染**（`server/exporters.ts` 的 `toTodosMarkdown`），复用 `sched.computed` → 日期/工期与 mspdi/csv 严格一致
- 保存 Project-A 后自动同步到共享端（server-side autoSync）
  - `server/autoSync.ts`：保存/回滚/todo 变更后防抖（默认 4s）异步 rsync 到共享端两处
  - `config/app.config.local.json`（Mac 本地专属，gitignored）配置 shareDataDir / shareExportDir / planNames
  - 共享端/Windows 默认关闭（enabled=false）

### Fixed
- `sync-to-share.sh` 两处 bug：`$LATEST_VER）` / `$PLAN_NAME」` 全角标点 unbound variable；rsync 改用 `mktemp -d` 目录源 + `--delete --inplace`（SMB 不支持原子 rename）
- 未保存计划前管理 TODO 的友提示：`addTodo` / `updateTodo` / `deleteTodo` / `moveTodo` 入口检查 `dirty`，脏数据时 toast `请先保存计划，再管理 TODO`（warning）并阻断请求；服务端 `ERR_PLAN_NOT_FOUND` 兜底翻译到同一文案
- 日历列宽默认 200px，列宽模块 24 例单测；`autoFitWidth` 测量失效兜底口径修正

### Tests
- 22 套件 / 383 例 全绿（server 108 + shared 181 + src 94）
- `npm test` 一次跑会被 OOM 杀，需 `NODE_OPTIONS=--max-old-space-size=2048` 分段跑

### Docs
- LESSON §7.22 记录 autoSync 设计 + rsync SMB 三坑 + bash 全角标点
- `docs/IMPL_ROADMAP.md` 序列化为路线图

---

## [1.1.0] — 2026-09-03

### Added
- **U04** 任务 TODO 验收清单
  - 每任务独立 todo 集合，状态/指派人/优先级/到期
  - 抽屉右侧展开（不破坏 K16 行高对齐）
  - `todo.assignee ∉ (owner ∪ consultant)` 自动并入 owner（K15 不变量）
- **U03** 左侧表格筛选（表头下拉 + 「Assign to me」）
  - 复用 `shared/people.ts` `isMine`（owner ∪ consultant 命中，trim+lower-case 无关大小写空格）
- **U02** 顾问人列 + 负责人/顾问人支持多人
- **U01** 列宽按计划独立记忆 + 负责人下拉按最长候选撑开

### Fixed
- 多人并发编辑：编辑锁 + 乐观并发 baseVersion
- 顺序移动 / 换行 / 抽屉加宽
- MPP 导入（Java 桥接，需 `enable-mpp-import.bat` 启用）
- Windows 共享盘零安装启动器

### Tests
- 22 套件 / 383 例 全绿

### Docs
- PRD/设计/系统设计/class/sequence 文档全套（`docs/`）

---

## [1.0.0] — 2026-08-28（基线恢复）

### Added
- 本机版基线：21 人名单 + MPP 导入全链路 + Windows 按需启用脚本
- 18 个 REST endpoints（plan CRUD / lock / todo / calendar / export）
- 排程算法（`shared/scheduler.ts`）：FS/SS/FF/SF 全 4 类依赖；INPUT/DEP/ROLLUP/ANCHOR/MIXED 5 类派生来源；Diagnostic 三档
- 中国节假日种子 + 工作日历（个人/全局）
- 编辑锁（30s heartbeat）+ 乐观并发
- 历史快照（append-only + restore）
- 导出：MSPDI XML / CSV / Markdown TODO / JSON
- 排程诊断 5 类（DURATION/CONSTRAINT/PRECEDENCE/ROLLUP/CALENDAR）

### Known Limitations
- 单实例内存锁（多实例需 SQLite/Redis 改造）
- soft-login（`req.body.user`）— v1.0 开源版替换为 bcrypt + cookie session
- JSON 文件存储（workspace 物理隔离将在 v1.0 开源版实现）

---

[Unreleased]: https://github.com/keil2005/project-planning-with-checklist/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/keil2005/project-planning-with-checklist/compare/v1.1.1...v1.2.0
[1.1.1]: https://github.com/keil2005/project-planning-with-checklist/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/keil2005/project-planning-with-checklist/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/keil2005/project-planning-with-checklist/releases/tag/v1.0.0
