# plan-gantt Feature Review（2026-09-05）

> **目标**：为「开源 + 自托管（on-prem）+ 个人成就感/副业口碑」路线做 feature-level 决策审查。
>
> **约束**：主仓 `2026-08-26-11-38-21/` 零触碰，所有迭代在 `distribution/open-source` 分支副本推进。
>
> **评估口径**：用户已裁定（2026-09-05）→ 这是用户个人创作，与公司 IP 无关；个人免费路线；法律风险 🟢 0。开源接收方 = 任何技术宅 / 中小企业 / 自托管爱好者。

## TL;DR（一句话结论）

plan-gantt 现在是个**功能完备但"内网味"很重**的协作式 PM 工具。核心算法（排程 / 锁 / 历史 / 导出）和数据模型（Plan/Task/Todo/Duration/Dependency/WorkCalendar）**完全具备开源素质**，但**部署形态、身份模型、demo 数据、跨机器同步层**这四块是为 公司内网场景设计的，开源前必须重塑。

**核心建议**：
- **保留** = 引擎层（scheduler / lock / history / optimistic-concurrency / 排程 + 诊断 + 导出 + 导入）+ 数据模型 + 全部 18 个 REST endpoints
- **重构** = 身份层（soft-login → 轻量用户名/密码）+ 存储层概念（单一 `data/` → 多 workspace namespace）+ 部署形态（启动脚本 + autoSync → Docker + env）
- **剥离** = 内网专属构件（Windows SMB 启动脚本 / SMB UNC 路径 / `app.config.local.json` rsync 钩子）
- **新增** = workspace 概念 + 邀请链接 + 一个 seed 示例 + 双语 README

下文按域（Domain）分块，每块给出"现状 → 开源诊断 → 处置建议"。

---

## 1. 健康度体检（基线快照）

| 指标 | 值 | 评价 |
|---|---|---|
| 前端组件数 | 9（Toolbar/TaskTable/GanttChart/TodoDrawer/FilterBar/ColumnFilterMenu/DatePickerPopover/Dialogs/ErrorBoundary） | ✅ 规模健康，没有过度组件化 |
| 服务端代码量 | `routes.ts` 22K + `exporters.ts` 24K + `scheduler.ts` 35K + `storage.ts` 11K | 主入口合理 |
| 共享库代码量 | `scheduler.ts` 35K + `datetime.ts` 10K + `types.ts` 15K + `todo.ts` 6K | 核心引擎扎实 |
| 共享测试 | 17 套件 / 383 例（U05 落地） | ✅ 全绿，分段跑（server 108 + shared 181 + src 94）|
| 第三方依赖 license | MIT / Apache-2.0 / BSD / ISC / 0BSD / CC-BY-4.0 | ✅ 无 GPL/AGPL/SSPL 传染库 |
| 品牌字符串 | 0 logo，0 商标，仅 MSPDI 规范名出现在导出器注释 | ✅ 法律零风险 |
| License 文件 | 无 | ❌ 开源必须补 |
| 部署文档 | `docs/deploy.md` + `README-Windows.md` + 共享盘脚本 2 个 | ⚠️ 全部内网向，需重写 |
| Demo 数据 | Project-A/Project-B/Project-C 等真实 公司项目 | ❌ 必须隔离 + 写虚构 seed |
| Git author 邮箱 | 历史 commits 含工作邮箱 + 个人邮箱两个来源 | ⚠️ 开源前必须 `filter-repo` 重写为单一邮箱 |

---

## 2. Feature Matrix（按域）

### 2.1 核心引擎层 — ✅ 全部保留（开源差异化核心）

| 功能 | 路径 | 测试覆盖 | 开源必要性 | 建议 |
|---|---|---|---|---|
| 服务端权威排程（35K 行真家伙） | `shared/scheduler.ts` + `shared/datetime.ts` | ✅ 充分 | 高 | **保留**。这一块是真正的高质量资产——FS/SS/FF/SF 全 4 类依赖 + INPUT/DEP/ROLLUP/ANCHOR/MIXED 5 类派生来源 + Diagnostic 三档（error/warn/info）。比多数 SaaS PM（Asana/Monday）的客户端排程强。 |
| 中国节假日种子 | `shared/china-holidays.ts` 2026 年度 | ✅ 有 | 中 | **保留 + 重构**。数据放仓库、做成年份自检 `china-holidays --coverage`，自动提示"该年度未覆盖"。 |
| 工作日历（个人/全局两套） | `shared/calendar-build.ts` + `server/calendarService.ts` | ✅ 有 | 高 | **保留**。Weekend / 节假日 / 自定义工作日的混合模型，是真的"工程 PM"而不是"消费 PM"的标志。 |
| 编辑锁（30s heartbeat）+ 乐观并发 | `server/lockService.ts` + K11/K13 invariants | ✅ 有 | 高 | **保留 + 抽象**。把内存 Map 实现抽接口（已经做了 ✅），下层接 SQLite `pg_try_advisory_lock` 或文件锁，多实例也能跑。 |
| 历史快照（append-only + restore） | `server/storage.ts` `historyRepo` | ✅ 有 | 高 | **保留**。这是 PM 工具的**核心信任**——任何变更可回滚。开源就靠这一条拉一大票对 Linear/Asana 无审计能力的人。 |
| TODO 独立资源 + 多人并发 + U04 U05 | `shared/todo.ts` + `server/routes.ts` L481 | ✅ U04 17 + U05 6 | 中 | **保留**。这套"指令式写（add/update/delete/move）+ revision 单调 + 轮询 + 不置脏不 recompute"是工程级实现，开源圈少见。 |

### 2.2 数据模型 — ✅ 全保留

| 类型 | 定义 | 必要性 |
|---|---|---|
| `Plan` | 计划元信息 + tasks[] + 全部依赖关系 + 排程结果 | ✅ |
| `Task` | 名称/owner[]/consultant[]/输入三件（start/end/duration/deps）+ computed 三件 | ✅ |
| `TodoItem` | id/text/done/order/assignee? | ✅ |
| `Dependency` | pred/task/link/lag（FS/SS/FF/SF） | ✅ |
| `Duration` | value/unit（d/w/m） | ✅ |
| `WorkCalendar` | 标准工作日 + 假日 + 自定义 | ✅ |
| `Diagnostic` | level=error/warn/info + 字段定位 | ✅ |

**建议**：给这些类型加 JSDoc 完整注释，开源用户第一眼看明白为什么是这样的形状。

### 2.3 API 层（19 endpoints）— ✅ 全部保留 + 加鉴权

```
GET    /health
GET    /users                  ← 内置 roster，需改为"读当前 workspace 成员"
GET    /plans
POST   /plans
GET    /plans/:id
PUT    /plans/:id              ← 保存
GET    /plans/:id/history
GET    /plans/:id/history/:ver
POST   /plans/:id/restore      ← 回滚
GET    /plans/:id/export?format=mspdi|csv|md&scope=all|mine&user=...
POST   /plans/import           ← MPP/MPX/MSPDI XML/XER/POD
GET    /plans/:id/todos
POST   /plans/:id/tasks/:tid/todos
GET    /locks/:id
POST   /locks/:id/acquire
POST   /locks/:id/heartbeat
POST   /locks/:id/release
GET    /calendar
PUT    /calendar
```

**处置**：
- 全部 endpoint **保留**
- **加中间件**：所有写入类（POST/PUT/DELETE）必须经 auth 中间件（除 `/health` `/users` 只读）
- `/plans/*` 的 `req.body.editor` 改为 `req.session.userId`（不再信任请求体）
- `/locks/:id/acquire` 的 `req.body.user` 同理
- `/users` 当前返回全员名单，开源版改为只返回"当前 workspace 成员子集"（避免泄露所有人邮箱/姓名）

### 2.4 UI 层 — ✅ 几乎全保留

| 组件 | 用户价值 | 处置 |
|---|---|---|
| **Toolbar** | 16 个操作按钮（身份/锁/保存/打开/导入/新建/刷新/导出 3 格式/历史/日历/缩放/今天） | **保留** + 加"清空过滤/登出"两个按钮 |
| **TaskTable** | 10 列（WBS 序号/名称/开始/结束/时长/依赖/负责人/顾问人/TODO/操作） | **保留** + "新建子任务"一行内交互优化（可选） |
| **GanttChart** | 与 TaskTable 同步滚动（K16 硬约束），3 档缩放 | **保留** —— K16 是真正的工程结晶 |
| **TodoDrawer** | 720px 右侧抽屉，TODO 增删改移 | **保留** |
| **FilterBar** | 7 列筛选 + Assign to me + Excel 风格条件 | **保留** —— U03 是发布亮点 |
| **ColumnFilterMenu** | 漏斗 + 候选 + 搜索 | **保留** |
| **DatePickerPopover** | MUI 日期选择器 | **保留** |
| **Dialogs** | 5 类对话框（保存/历史/日历/打开/导出 TODO/身份） | **保留** |
| **ErrorBoundary** | 顶层错误降级 | **保留** |

### 2.5 部署形态 — ❌ 全部重塑（开源差异化战场）

| 现状 | 来源 | 诊断 | 处置 |
|---|---|---|---|
| `start-plan-gantt v1.1.1.bat`（Windows .bat） | 历史 | 内网 | **删除主仓库** → 挪到 docs/deploy-internal/ 并加 README 警告（贡献者不一定要用这个） |
| `plan-gantt 一键启动 v1.1.1.cmd`（Windows .cmd） | 历史 | 内网 | 同上 |
| `enable-mpp-import.bat` + PowerShell 桥 | 历史 | 内网 + Mac/Java | **保留于仓库**（MPP 导入是核心功能）但配 Linux 启动脚本（plan-gantt 一键启动 v1.1.1.sh） → 三平台都有 |
| `Dockerfile` / `docker-compose.yml` | — | 没有 | **新增**：node:22-alpine 多阶段构建；暴露 PORT；env 喂 database path + JWT secret |
| 跨平台 README | — | 没有 | **新增** docs/SELF-HOSTING.md：克隆 → docker compose up → 登录 → 改密 → 邀请队友，5 分钟上手 |

### 2.6 身份 / 协作层 — ❌ 从零搭建（核心改造）

| 现状 | 诊断 | 处置 |
|---|---|---|
| `req.body.user` 当身份 | **零认证**，任何人都能扮演 | **重做**：bcrypt 用户名密码 + httpOnly cookie session |
| `BUILTIN_USERS`（roster.ts） | 内置名单，21 人 | **退化为初始 admin**（first-run wizard），其他用户邀请制 |
| 无 workspace 概念 | 所有计划全局共享 | **新增**：登录后看到"我的工作区 / 我加入的工作区"两张列表；URL 带 `?ws=<id>` |
| 无邀请机制 | — | **新增**：`POST /api/workspaces/:id/invites` 生成一次性 token（24h 过期），`/invite/<token>` 页注册即加入 |
| 无成员管理 | — | **新增**：`GET /api/workspaces/:id/members` + `DELETE /api/workspaces/:id/members/:userId`（admin only） |

### 2.7 存储层 — ⚠️ 概念改造（实现尽量保留）

| 现状 | 路径 | 诊断 | 处置 |
|---|---|---|---|
| `data/plans/p-<id>/{plan.json, history.json, todos.json}` | `data/plans/` | 单进程 JSON | **概念升级**：`data/workspaces/<wsId>/plans/p-<id>/...` 物理隔离；JSON 实现可保留（Plan-gantt 现形态就是 on-prem 友好的，不需要迁数据库） |
| `data/calendar.json` | `data/calendar.json` | 全局单实例 | **降维**：`data/workspaces/<wsId>/calendar.json` 每 workspace 一份 |
| `lockService.ts` 内存 Map | `server/lockService.ts` | 单进程有效 | **保留** + 接口不变，实现从文件锁（on-prem 单机无需变） |

### 2.8 数据导出 — ✅ 全部保留（Microsoft 公开授权）

| 格式 | 实现 | 必要性 |
|---|---|---|
| MSPDI XML（MS Project） | `server/exporters.ts` `toMsProjectXml` | ✅ 保留 |
| CSV（Excel 直接打开） | `server/exporters.ts` `toCsv` | ✅ 保留 |
| Markdown TODO 清单 | `server/exporters.ts` `toTodosMarkdown`（U05） | ✅ 保留 —— 这是亮眼差异化 |
| 文件名格式 | `{planName}-v{version}.{ext}` 或 `{planName}-todos-{all|mine}-v{version}.md` | ✅ 保留 |

### 2.9 数据导入 — ⚠️ 分级处理

| 格式 | 实现 | 平台 | 处置 |
|---|---|---|---|
| `.mpp` / `.mpx` | MPXJ Java 桥 | 仅 Mac/Linux（带 JRE） | **保留** + 加 Windows 启动脚本；Docker 不挂 JRE 镜像，需 `enable-mpp-import.sh` |
| `.xml`（MSPDI） | 纯 TS 解析 | 全部平台 | ✅ **保留**且**作为默认 fallback** |
| `.xer` / `.pod` | MPXJ 桥 | 同 `.mpp` | ✅ **保留**但稍后做（BACKLOG P0 #1） |

### 2.10 autoSync / Mac 本地专属 — ❌ 删除（开源版不需要）

| 项 | 路径 | 处置 |
|---|---|---|
| `server/autoSync.ts` | 内嵌 | **删除**（开源版无 rsync 同步场景，云端不挂 SMB） |
| `config/app.config.local.json` | 内嵌 | **删除**（Mac 专属覆盖） |
| `config/app.config.json` 的 `autoSync` 段 | 内嵌 | **删除** |
| `sync-to-share.sh` 脚本 | 根目录 | **删除**（脚本与具体 公司项目绑定） |

### 2.11 元文档 / 元文件 — ❌ 从零搭建

| 项 | 现状 | 处置 |
|---|---|---|
| `LICENSE` | 无 | **新增**：AGPL-3.0（推荐）/ Apache-2.0 / MIT 三选一（用户裁定） |
| `README.md` | 有但中文 + 项目内部语气 | **重写**：English first（GitHub 主流读者），徽章（license/build/test/awesome-selfhosted），5-minute-quickstart，self-host badge |
| `CONTRIBUTING.md` | 无 | **新增**：commit 规范、PR 流程、test 必须通过、DCO（可选） |
| `SECURITY.md` | 无 | **新增**：披露邮箱 + 响应时间承诺 + supported versions |
| `CODE_OF_CONDUCT.md` | 无 | **新增**：Contributor Covenant v2.1 标准 |
| `CHANGELOG.md` | 无 | **新增**：从 git tag 反向生成（v1.0.0 / v1.1.0 / v1.1.1） |
| `docs/SELF-HOSTING.md` | 无 | **新增**：5 分钟上手 + 升级 + 备份 + 迁移指南 |
| `docs/ARCHITECTURE.md` | `system_design.md` 56K 太学术 | **新增/重写**：1-2 页面向 contributor 的全景图 |

### 2.12 测试覆盖 — ⚠️ 现状很好（383 例），新增补 5 个套件

| 套件 | 现状 | 处置 |
|---|---|---|
| `shared/__tests__/{scheduler,datetime,calendar,todo,people,types}.test.ts` | ✅ 181 例 | 保留 |
| `server/__tests__/{routes,locks,calendar,storage,exporters,mppImport,assignee,api.smoke}.test.ts` | ✅ 108 例 | 保留 |
| `src/__tests__/{store,columns,taskTable,drawer,filter}.test.tsx` | ✅ 94 例 | 保留 |
| **新增 `server/__tests__/auth.test.ts`** | — | bcrypt + session + cookie + workspace 隔离 |
| **新增 `server/__tests__/workspace.test.ts`** | — | 邀请 token + 加入流程 + 跨 workspace 隔离 |
| **新增 `server/__tests__/invite.test.ts`** | — | 一次性 token 24h 过期 + 已加入不二次加入 |
| **新增 `data/seed/__tests__/seeding.test.ts`** | — | seed 计划可加载、字段完整 |
| **新增 `e2e/self-hosting.test.ts`** | — | docker compose up → curl /health → 登录 → 创建 → 保存 → 关闭，10 步全跑通 |

### 2.13 国际化 — ⚠️ 重写策略

| 现状 | 处置 |
|---|---|
| UI 全中文 + 少量英文按键 | **主仓 README 双语**（英语主+中文次），**UI 中英混排**保持现态（开源后用 i18n 渐进迁移） |
| 中文术语（WBS、变更纪要、负责人、顾问人、TODO、依赖、时长） | **保留中文** + 在 README 提供 terminology 表（PMI/MS Project 对照） |
| `china-holidays` | **保留** + README 说明"目前仅内置中国节假日，非中国团队可 fork 自定义或等 PR" |

### 2.14 已固化不变量白名单（用户已裁定，**绝对不动**）

> 这些是之前迭代中用户拍板的关键约束，开源化必须保留语义，否则会引入"漂移"型 bug。

| 不变量 | 来源 |
|---|---|
| **K16**：TaskTable 与 GanttChart 共用 32px 行高逐行镜像 | U01 列宽迭代 |
| **K9**：API 统一响应 `{code, data, message}` 包装 | 系统设计 |
| **K11/K13**：编辑锁（claim-and-hold）+ 乐观并发（baseVersion） | routes.ts 写路径 |
| **K14**：save 先 history 后 plan（snapshot 链路稳定） | storage.ts `appendVersion` |
| **U04 enforceTodoOwnerConsistency**：`todo.assignee = X 且 X ∉ owner∪consultant` → 自动并入 owner（**单向只增不自动移除**） | `shared/normalizePlan.ts` |
| **U05 isMine**：owner ∪ consultant 命中，trim + lower-case 无关大小写空格 | `shared/people.ts` |
| **U05 mine counter**：`{planName}-todos-{all|mine}-v{version}.md` 用 all/mine 显式区分 | `server/exporters.ts` |
| **404 → 2004 (`ERR_PLAN_NOT_FOUND`)**：所有 API 走 `fail(...)` 包装不直返 404 | routes.ts |
| **Todo 独立资源（方案 B）**：todos.json 单调 revision，不进 plan.json、不进 history、不进排程 | U04 设计裁定 |
| **Diagnostic 三档**：error 阻断保存 / warn 仅提示 / info 装饰 | shared/types.ts |

---

## 3. 增量机会清单（公开版 vs 内网版的真正差别）

这些是**开源版独有的、不开源就根本不会出现**的能力：

1. **Docker Compose 一键部署**：内置 `app + optional samba 容器` 让团队挂 NAS，5 分钟跑通。
2. **Demo 数据 seed**：`data/seed/sample-workspace.json`，clone 后一键 npm run seed，开箱即玩。
3. **awesome-selfhosted PR 友好**：在 README 加 badge（self-hosted、AGPL-3.0、no-telemetry），搜得到。
4. **双语 README**：英文主+中文次，HackerNews 用户能读完，团队协作。
5. **CHANGELOG 自动生成**：CI 跑 `git-cliff` 每周攒版本，contributor 看变更一目了然。
6. **GitHub Actions public CI**：lint + vitest + build + bundle，三平台矩阵（Mac/Linux/Windows）。
7. **Online Demo**（可选，WorkBuddy sites 部署一个 demo）：seed 数据 + read-only 模式 + "Want to deploy your own? See GitHub" 按钮。

---

## 4. 不可触碰清单（开源后 contributor 不能改）

- 全部 19 endpoint 签名（路径 + 方法 + 入参 schema），乱改会破坏 v1.1.1 客户端用户
- 数据类型 `Plan/Task/TodoItem/Duration/Dependency/...` 字段名，schemaVersion 升级才能动
- 排程算法在 `shared/scheduler.ts` 里的所有不变量（错误诊断语义不能升级 breaking change）
- `server-build/server.cjs` 内部的 two-fork daemon（autoSync 删除，但导出 runtime 必须保留 esbuild bundle）

---

## 5. 我的"开干"建议

> 用户上一轮明确「独立副本 + 主仓零触碰」。本节给出下一步具体动作。

### 第一阶段：副本迁移 + 基线（0.5 天）
| 步 | 动作 | 验收 |
|---|---|---|
| 1 | `npm install`（副本） | 装完无 error |
| 2 | `npm test`（分段跑） | server 108 + shared 181 + src 94 全绿 |
| 3 | `npm run build && ./build-server-bundle.sh` | dist/ + server.cjs 产出 |

### 第二阶段：身份层改造（2-3 天）
| 步 | 动作 |
|---|---|
| 4 | 加 `server/auth.ts`：bcrypt 哈希 + httpOnly cookie session + `/api/login` + `/api/logout` |
| 5 | 把所有 `req.body.user` → `req.session.userId`，加中间件 `requireAuth()` |
| 6 | 加 `GET /api/me` 当前用户信息 |

### 第三阶段：workspace 概念（2-3 天）
| 步 | 动作 |
|---|---|
| 7 | 加 `server/workspace.ts`：物理隔离目录 `data/workspaces/<wsId>/...` |
| 8 | 加 `POST /api/workspaces`（admin）+ `GET /api/me/workspaces` |
| 9 | 所有 `/plans/*` `/calendar` 加 `?ws=<id>` 或路径前缀隔离 |

### 第四阶段：邀请机制（1 天）
| 步 | 动作 |
|---|---|
| 10 | 加 `POST /api/workspaces/:id/invites` 一次性 token |
| 11 | 加 `POST /api/invites/redeem` 注册即加入 |

### 第五阶段：seed + 部署形态（1-2 天）
| 步 | 动作 |
|---|---|
| 12 | 写 `data/seed/sample-workspace.json`（虚构 Project Phoenix / Project Cobra）|
| 13 | 写 `Dockerfile` + `docker-compose.yml` + `docs/SELF-HOSTING.md` |
| 14 | 保留 enable-mpp-import，**为 Linux 加 .sh 启动** |

### 第六阶段：开源元文件（0.5 天）
| 步 | 动作 |
|---|---|
| 15 | 加 LICENSE + CONTRIBUTING + SECURITY + COC + CHANGELOG |
| 16 | README 重写：English first + badges + quickstart + screenshot |

### 第七阶段：去公司化痕迹（0.5 天）
| 步 | 动作 |
|---|---|
| 17 | `data/` 加入 .gitignore（仓库无数据，仅 demo seed）|
| 18 | 删除 `autoSync` + `app.config.local.json` + `sync-to-share.sh` |
| 19 | 删除 `start-plan-gantt.bat` / `plan-gantt 一键启动.cmd` 或挪到 docs/deploy-internal/ |

### 第八阶段：邮箱清洗 + 推送（0.5 天）
| 步 | 动作 |
|---|---|
| 20 | `git filter-repo --mailmap` 重写 公司邮箱 → 个人邮箱 |
| 21 | push 到 GitHub public 仓库 |

**总计**：7-10 天（1.5-2 周）。早期第 1-2 步必须先跑通，否则后续改造失去基线。

---

## 6. 等你拍板的 4 件事

1. **License 三选一**：AGPL-3.0 / Apache-2.0 / MIT（**推荐 AGPL-3.0**：保护你想做 SaaS 商业化的可能性）
2. **总入口规模**：是否按 §5 的 8 阶段 7-10 天一次推完？还是分阶段（先引擎 demo / 再协作层）让你能看到中间产物？
3. **第一步要不要先跑基线**（npm install + test + build，全部在副本里）确认起点干净？还是跳过直接动手？
4. **是否需要 WorkBuddy sites 部署一个在线 demo**？还是只做 Docker 本地自托管 / 暂时不做 demo？

回我话我就接着干。
