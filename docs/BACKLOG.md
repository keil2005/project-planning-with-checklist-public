# BACKLOG · plan-gantt

> 待办/延迟项清单。优先级：P0 最高。标注「本次已落地」的为已完成项，供追溯。

## 本次已落地（2026-08-26 ~ 08-28）
- [x] **MPP 导入（本机 Mac + Java）**：`server/MppImport.java` 桥接 + `server/mppImport.ts` 映射 + `POST /plans/import` + 前端「导入」按钮 + 能力门 501。
- [x] **gated 集成测试**：`mpp-import.integration.test.ts`（无 Java 自动 skip），含 MSPDI 真实 fixture。
- [x] **Windows 共享盘部署包**：`/Volumes/dev/00 public/PM tool/plan-gantt/`，排除 `server/mpxj` → 导入自动 501；含 `README-Windows.md` + `start-windows.bat`。
- [x] **部署文档与复盘**：`docs/deploy.md`（既有）、`docs/LESSON_LEARN.md`、`docs/BACKLOG.md`。


## 本次已落地（2026-09-03）
- [x] **左侧表格列宽可调**：表头每列右缘 7px 分隔条，拖动调宽（拖期间仅改 CSS 变量、不触发 React 重渲染）、双击按该列最长可见内容自适应、立即写 localStorage（键 `plan-gantt:column-widths:v1`，结构不符自动降级默认值）。
- [x] **负责人下拉按最长候选撑开**：MUI `slotProps.popper.style` 覆盖默认 `width` 为 `max-content` + min 200 / max 520，三档列宽（90/120/327）实测下拉均为 200 px。
- [x] **列定义集中化**：原散落在 `TaskTable.tsx` 的 `GRID_COLUMNS` / `MIN_TABLE_WIDTH` 常量外置为 `src/columns.ts` 的 `COLUMNS` 单一真源（key/label/def/min/max），未来增删列只需改一处。
- [x] **配套单测**：`src/__tests__/columns.test.ts`（**24 用例**）覆盖 COLUMNS 结构、clamp（含 NaN/±Infinity → def）、grid/CSS 变量、load/save（结构不符逐项回落 + localStorage 抛错的降级）、autoFit 的**降级**（离屏测量 → null）与**正向计算**（装饰宽 + 最长文本 + padding，含缩进层级与 clamp）。
- [x] **autoFitWidth 兜底口径修正**：原用「行总宽 ≤ 0」判断测量失效，但 name 列的装饰宽（缩进 + 折叠三角）本身就 > 0，导致离屏环境下会把列错误地夹到 min。改为用**纯文字宽度** `textMax` 判断 → 测量不可用则保持原样不改列宽。真实浏览器行为不变（已用 Project-A 复验，数值与修正前逐一相同）。
- [x] **文档**：`docs/prd_increment_column_widths.md`、`docs/design_increment_column_widths.md`。
- **数据**：playwright 真实浏览器实测 31Jul + Project-A 两个计划，Project-A 双击「任务名称」260→282（最长 32 字符任务名「Internal part supplier selection」）、双击「依赖」110→210、双击「开始/结束」96→136、双击「时长」78→60（命中 min）。
- **全量单测**：252 → **276** 全绿（14 个套件）；`tsc --noEmit` 0 错误；改后已重新 `vite build` 并重启本机服务复验。

## 本次已落地（2026-09-02）
- [x] **roster 名单裁定：User14 保留**（用户裁定原文「user14要留的，且清单内放在user13后面」）。现状本就满足（索引 13，紧随 `User13` 索引 12），本次补齐的是**四处遗漏的同步**：
  - 代码：`shared/roster.ts` 头注释（索引 0..19 → 0..20，共 21 人）；`shared/__tests__/roster.test.ts`（长度 20→21、逐项数组插入 `User14`、尾部索引 17/18→18/19）；`server/__tests__/api.smoke.test.ts` 与 `server/__tests__/assignee.test.ts` 的 `GET /api/users` 期望（20→21，并新增断言 `User13`=12 / `User14`=13 锁定相对顺序）。
  - 文档：`prd_increment_roster_assignee.md`（新增「变更记录」表 + P0-1/Q1/验收清单/C4/US-1/P1-4 等 6 处口径）、`design_increment_roster_assignee.md`（新增「变更记录」表 + 源码示例/单测示例等 10 处口径）、`increment-sequence-diagram.mermaid`（2 处）。
  - **处理原则**：PRD §1「原始需求复述」是历史事实（20 人），**不做回改**，改为在头部加「变更记录」并注明「当前生效口径以变更记录与 P0-1 为准」。
  - 全量测试（放宽 `hookTimeout=120s`）：**252 passed / 0 failed，13 个套件全绿**（此前 5 个失败断言全部消除）。
- [x] **共享盘同步：用户明确暂缓**（「共享盘先不同步，我们本地还有需要迭代的内容」）。Windows 方案 C 的产物全部留在开发机，`/Volumes/dev/00 public/PM tool/plan-gantt/` **未做任何写入**。

## 待办（P0）
- [ ] **MPP 导出**：用户此前明确 defer（「导出仍留在 BACKLOG」）。本机 Java 可补 `MppExport` 桥接；Windows 共享包按同样能力门设计 → 无 Java 时导出按钮 501。需确认导出目标格式（MSPDI XML 最通用，可被 MS Project / ProjectLibre / GanttProject 读回）。
  - 阻塞点：导出逻辑与导入对称，但需反向映射（应用 `Plan` → MPXJ `ProjectFile` → 写文件）。工作量中等。

## 待办（P1）
- [ ] **多实例 / 多机文件锁**：当前为**单进程内存锁**（`lockService`），单实例部署前提。共享盘多同事并发编辑需改造为**文件锁 / 原子写**。`LockService` 已抽接口，便于替换实现。
  - 风险：当前多人同时打开「查看」安全；但两人先后点「编辑」时第二人会被禁用（符合设计），仅单实例能保证锁有效。
- [~] **Windows 直接支持 MPP 导入**：当前 Windows 包不含 `server/mpxj/` → 501。
  - 硬约束：MPXJ 只能跑 JVM，而部署版要零依赖；当前部署包仅 **8.8MB**，内置 JRE 会显著放大体积。
  - 四个方案与权衡见 `docs/LESSON_LEARN.md` §7.8（A 内置完整 JRE ≈140MB / B jlink 精简 ≈62MB / **C 按需启用脚本，保持 8.8MB，推荐** / D 仅支持 MSPDI XML 纯 TS 解析）。
  - **方案 C 已于 2026-09-02 在开发机实现完毕（代码 + 文档 + 自检全过）**，本机侧已做：① `server/mpxj/enable-mpp-import.ps1`（下载 Temurin JRE 到 `%LOCALAPPDATA%\plan-gantt\jre` + 30 个 jar + 部署预编译 `.class` + 桥接自检）+ 根目录 `enable-mpp-import.bat`（UTF-8 BOM/CRLF/pushd，符合 §2.z 坑 B·C）；② `mppImport.ts` 用 `resolveJava()` 三级探测（`PLAN_GANTT_JAVA` → 便携 JRE → 系统 PATH）取代原 `javaOnPath()`；③ classpath 用 `path.delimiter` 自动适配 `;` / `:`；④ 新增 `mppImportStatus()`，501 提示按「缺 Java / 缺桥接产物」分原因；⑤ `server/index.ts` 启动时打印 MPP 导入状态；⑥ `README-Windows.md` 新增 §5.1。
  - **用户裁定（2026-09-02）：共享盘先不同步**，理由「本地还有需要迭代的内容」。待本地迭代完成后再整体同步。
  - **剩余一步：同步到共享盘部署包**（`enable-mpp-import.bat`、`server/mpxj/enable-mpp-import.ps1`、`MppImport.class`、`MppImport.java`、`log4j2.xml`、`README-Windows.md`、重打包的 `server-build/server.cjs`）→ **待用户拍板后执行**，未擅自覆盖。
  - **首次在真实 Windows 上跑 `enable-mpp-import.bat` 是唯一未验证环节**（开发机无 pwsh/powershell，无法预检语法）。
  - 顺带优化（未做）：把 `UniversalProjectReader` 改为按扩展名显式分派，可将 `server/mpxj/lib` 从 37MB 裁到约 15–18MB，能显著缩短 Windows 端首次启用耗时。

## 待办（P1）


## 待办（P2）
- [ ] **计划 schema 迁移**：`Plan.schemaVersion` + `migrate()` 钩子已预留接口，未落地。未来字段演进时可平滑迁移旧 `plan.json`。
- [ ] **历史快照外置**：`versions[].snapshotRef` 已预留，目前历史为内联全量快照（append-only）。计划较大时外置可减小单文件体积。
- [ ] **资源 / 负责人 / 进度的增强 UI**：当前已支持 owner、进度%、依赖、备注；可加：资源负载视图、按负责人筛选/分组、燃尽/完成度报表。
- [ ] **日历增强**：中国法定节假日/补班日已种子化（2026）；需加入「逐年自动扩覆盖」与「项目级自定义日历」UI。

## 待办（P3）
- [ ] **用户真实身份认证**：当前仅「从 `config/users.json` 选名」，服务端不校验。如需审计级追溯，加轻量登录（仍无密码，仅 token 绑定编辑者）。
- [ ] **前端代码分包**：当前单 JS chunk ~558KB（gzip 182KB）。可用 `manualChunks` 或路由级 `import()` 拆分，缩短首屏。非阻塞。
- [ ] **导入健壮性**：超大 `.mpp`、损坏文件、时区异常等边界，桥接层应返回结构化错误而非堆栈；前端给出可读提示。

## 已知限制（部署相关，非缺陷）
- Windows 共享包**不支持 MPP 导入**（设计如此，501）。
- 单实例运行（见 P1）。
- 前端为预构建产物；如需改源码后自构建，`npm install` 会装上 vite，可 `npm run build`（部署包非必须但可行）。
