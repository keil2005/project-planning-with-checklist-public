# Changelog

所有 Project Planning with Checklist 的显著变更都记录在这个文件。格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
项目遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

> **下一次发布**：[Unreleased] — Docker 一键部署 / 多项导出（详见 [IMPL_ROADMAP](./docs/IMPL_ROADMAP.md)）

## [1.3.0] — 2026-09-09

> 主线：排程语义升级（里程碑 + 关键路径 + FS+1）+ Light/Dark 双主题 + 白屏修复。
> 4 个新功能 + 5 个修复 + 392+ 测试通过。

### Added（功能）

1. **里程碑（Milestone）** —— `duration=0` 表示关键节点
   - `shared/datetime.ts`：`parseDuration` 接受 `0d / 0w / 0m`（拒绝负数仍生效）
   - `shared/scheduler.ts`：新增 `isMilestone` 判定（用户显式 `0d` OR 收尾后 `start === end`），父任务恒 `false`（rollup 派生时间不参与）
   - `shared/types.ts`：`TaskComputed.isMilestone: boolean` 字段
   - `src/components/GanttChart.tsx`：里程碑渲染为实心圆（蓝/红配色随主题 + 关键路径双标识）
   - **里程碑汇总行**：甘特图底部固定显示里程碑列表（"里程碑汇总（N）"），点击平移到对应日期

2. **关键路径（Critical Path, CPM）**
   - `shared/scheduler.ts`：`computeCriticalPath()` 实现经典 CPM（forward pass + backward pass）
   - `src/store.ts`：`criticalPathOn` state + `toggleCriticalPath()` action
   - `src/components/Toolbar.tsx`：工具栏新增「关键路径」ToggleButton + tooltip 说明
   - `src/components/GanttChart.tsx`：关键任务渲染红下划线 + 图例 `gantt.legendCritical`
   - **算法约束**：只算叶子；父任务不参与；里程碑 `slack=0` 时进关键路径；`localStorage.pg.criticalPath` 持久化

3. **Light / Dark / System 三态主题**
   - `src/theme.ts`（新增 4.6KB）：micro store + `useThemeMode()` hook + `matchMedia('(prefers-color-scheme: dark)')` 监听 OS 切换
   - `src/index.css`：重写为 22 个 design token + `[data-theme='dark']` 完全覆盖
   - `tailwind.config.js`：`theme.extend.colors` 全部映射 `var(--token)`，无 Tailwind slate 硬编码
   - `src/main.tsx`：`buildMuiTheme(mode)` 切换真实 hex palette（light/dark 两套），MUI 组件随主题
   - `src/components/Toolbar.tsx`：三态开关 `☀ / 🌙 / 🖥` + Tooltip 解释
   - 持久化 `localStorage.pg.theme`（值：`light` / `dark` / `system`）

4. **任务编辑交互细节**
   - **Enter 键仅 commit**：单元格编辑后按 Enter 提交，不再新建下一行
   - **驱动变量高亮**：start / end / duration / deps 四类单元格背景色标识（`isDriver` 判定）

5. **i18n 新增 14 键**（CN + EN 各 7）
   - `toolbar.criticalPath` / `toolbar.criticalPathHint`
   - `toolbar.themeLight` / `themeDark` / `themeSystem` / `themeHint` + 短标签
   - `task.placeholderDuration`：提示 `0d = 里程碑 / 5d / 2w / 1m`
   - `task.parentLocked`：由子任务汇总
   - `gantt.legendMilestone` / `legendCritical` / `milestoneTitle` / `milestoneSummary`

### Fixed（修复）

6. **FS 依赖 +1 工作日**（K3 端点式下严格"次日开始"）
   - 前置 `2026-09-08` 完成 → 后置 `2026-09-09` 开始（旧版同天，重叠 1 天）
   - `shared/scheduler.ts`：FS 用 `addDays(pc.end, 1)` 作锚；FF 同天结束合法不加；SS/SF 与 pred 共享端点
   - 排程 #4 / #11 分支同步刷新；测试用例更新（`#8 仅时长 + FS 依赖 → FS+1`）

7. **父任务字段硬禁**（修正版，前一版误锁子任务）
   - `src/components/TaskTable.tsx`：`isLocked = isParent`（之前错用 `parentId !== null` 把子叶子也锁了 → 用户截图反馈"子任务无法编辑 duration"）
   - 父任务时间 / duration / todo 全部 disable；子任务正常编辑

8. **白屏修复**：MUI palette 不能再传 CSS 变量字符串
   - **现象**：刷新页面后白屏，无任何控制台错误（MUI 把 var() 抛错吞掉了）
   - **根因**：MUI 内部 `alpha(theme.palette.primary.main, 0.04)` → `decomposeColor('var(--primary)')` 抛 `Unsupported color` → React 根 render 崩
   - **修复**：`palette.*` 全部用真实 hex（`#2563eb` / `#60a5fa` 等），dark 视觉由 `[data-theme='dark']` 调色
   - **附带收益**：MUI 组件（Button / Chip / Popover / Dialog / Menu）真正跟随主题
   - **教训**：MUI v5 的 `cssVariables: true` 是 silent no-op（该特性在 MUI v6 才正式 GA）

9. **服务端保存同步**（duration=0 → 里程碑）
   - **现象**：保存含里程碑的计划报 `[1008] Invalid duration: 时长必须大于 0，收到「0」`
   - **根因**：`package.json` 的 `build` 引用 `./build-server-bundle.sh`，但该脚本在 `f1e0ad5` 公开版清理时被删除 → `npm run build` 只重打前端 dist、服务端 bundle 一直停在 16:19 旧版（`if (value <= 0)` 拒绝 0）
   - **修复**：用 esbuild 从当前源码重打 `server-build/server.cjs`，新 bundle 用 `if (value < 0)` 允许 0
   - **端到端验证**：保存含 2 个 duration=0 里程碑 → `code=0, msg=ok`，读回落盘 `input.duration="0"` 保留 ✅

10. **SVG / hex 颜色全部 token 化**
    - `src/components/GanttChart.tsx` 24 处 SVG hex → `var(--token)`
    - `src/components/DatePickerPopover.tsx` / `ErrorBoundary.tsx` 同样迁移
    - 主题切换时所有 SVG 元素颜色正确跟随

### Tests

11. `shared/__tests__/scheduler.test.ts` 新增 **2 个 describe / 9 个 it 用例**
    - `datetime · duration=0 = milestone`（2 例）：接受 0d / 0w / 0m；仍拒绝负数
    - `scheduler · milestone 调度`（3 例）：`start === end` 判里程碑；FS+1 后里程碑仍同天；父任务 `isMilestone=false`
    - `scheduler · critical path（CPM）`（4 例）：链式 A→B→C 全关键；分叉 A→{B,C} 选长支；父任务不参与；里程碑 slack=0 进关键
12. **全部 392+ 测试通过**（含 v1.2.1 baseline 383）
13. `npm run build`：vite build 成功（22.42KB CSS / 687KB JS gzip）
14. 端到端 API 验证（curl + `--noproxy '*'`）：保存 / 读回 / 编辑锁全链路 OK

### Compatibility

15. 数据 schema 不变；旧 plan.json 文件直接兼容
16. `[data-theme]` 默认 `system`（首次刷新跟随 OS 外观切换）；`localStorage.pg.theme` 为 `system` 时响应 macOS / Windows 外观变更

### Docs

17. `.workbuddy/memory/2026-09-08.md` 工作日志沉淀：白屏根因 + `build-server-bundle.sh` 缺失教训 + MUI v5 cssVariables 静默失效
18. `.workbuddy/memory/MEMORY.md`（长期）记录：MUI palette 禁忌 + 服务端 bundle 同步铁律

---

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

[Unreleased]: https://github.com/keil2005/project-planning-with-checklist-public/compare/v1.3.0...HEAD
[1.3.0]: https://github.com/keil2005/project-planning-with-checklist-public/compare/v1.2.1...v1.3.0
[1.2.1]: https://github.com/keil2005/project-planning-with-checklist-public/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/keil2005/project-planning-with-checklist-public/compare/v1.1.1...v1.2.0
[1.1.1]: https://github.com/keil2005/project-planning-with-checklist-public/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/keil2005/project-planning-with-checklist-public/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/keil2005/project-planning-with-checklist-public/releases/tag/v1.0.0
