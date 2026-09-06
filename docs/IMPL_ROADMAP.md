# plan-gantt 实现路线图（2026-09-05）

> **回答一个核心问题**：要实现哪些 feature？哪些不做？
>
> 这是 `FEATURE_REVIEW.md`（现状诊断）的**实施层补充**——review 写"现状/差异/建议"，roadmap 写"做/不做/优先级/工程量/验收"。
>
> **路线定位**：个人成就感 + 副业口碑 + 免费 + on-prem 自托管 + Docker 一键；**主仓零触碰**，全程在 `distribution/open-source` 分支副本推进。

---

## TL;DR（决策一览）

| 阶段 | 范围 | 工程量 | 目标 |
|---|---|---|---|
| **Phase A — 开源 v1.0 发布** | P0 全部（16 项） | **~13 人·天** | GitHub public 仓库 + Docker Hub 镜像 + 自托管 5 分钟跑通 |
| **Phase B — 增值 v1.1** | P1 精选（8 项） | **~12 人·天** | OpenAPI 文档 + i18n + Docker Hub 发布 + 评论/基线对比 |
| **Phase C — 生态 v1.2** | 按用户/社区反馈挑 P2 子集 | ~25+ 人·天 | 边角料，路标式迭代 |
| **OUT-OF-SCOPE** | 9 类明确不做 | — | 防止 scope creep |

**关键取舍**：
- **保留**：现有引擎层（排程/锁/历史/导出）+ 全部 18 个 REST endpoints → 直接复用
- **重做**：身份层（soft-login → bcrypt + cookie session）+ workspace 概念 + 部署形态（SMB .bat → Docker + env）
- **新增**：协作层（邀请链接/RBAC）+ demo seed + LICENSE/CONTRIBUTING/SECURITY/Docker
- **不做**：实时协同 / SaaS 多租户 / 计费 / 移动端原生 / 实时通知 / Jira 集成

---

## 0. 全局不变量（**绝不动**）

实现任何 feature 前，以下不变量必须保持：

| ID | 不变量 | 来源 |
|---|---|---|
| K11 | 编辑锁：同一 planId+taskId 只能被一个 user 持有，30s heartbeat，超时强占 | K11 锁约束 |
| K12 | 排程权威：服务端是排程的唯一 source of truth | K12 |
| K13 | 乐观并发：保存必传 `baseVersion`，服务端校验 → 不匹配返回 409 | K13 |
| K15 | Todo 自动入 owner：`todo.assignee ∉ (owner ∪ consultant)` 时自动并入 owner（**单向只增**） | K15 |
| K16 | 任务表 + 甘特图 32px 同步行高；todo 详情用右侧 Drawer 不用行内展开 | K16 |
| K4 | U05 MD 导出 mine 计数受 K15 自动并入影响，测试 setup 要先 merge assignee | K4 |
| ENGINE-1 | MSPDI XML 导出/导入使用 Microsoft 公开规范（README 必须引用 spec） | 法律零风险核心 |
| LICENSE-1 | Apache-2.0；下游可商用、可改、可再分发，但必须保留版权 + 不使用 "plan-gantt" 商标 | LICENSE §6 |
| PRIVACY-1 | demo seed 数据**绝不包含**真实业务代号（Project-A/Project-B/Project-C/ACME 等） | 用户 IP 隔离 |

---

## 1. Phase A — P0（开源 v1.0 必须）

### 1.1 元文件（开源前置）

| ID | Feature | 工程 | 验收 | 状态 |
|---|---|---|---|---|
| **LIC-1** | `LICENSE` Apache-2.0 标准全文 | 0.05d | `head -3 LICENSE` 显示 "Apache License Version 2.0" | ✅ 已落 |
| **LIC-2** | `CONTRIBUTING.md`（PR 流程 + commit 规范 + 测试必须绿） | 0.1d | 含 Issue / PR / commit 模板链接 | TODO |
| **LIC-3** | `SECURITY.md`（披露邮箱 + 响应时间承诺） | 0.1d | `security@keilzheng.dev`（或用户选定）+ 90 天响应 | TODO |
| **LIC-4** | `CODE_OF_CONDUCT.md`（Contributor Covenant v2.1） | 0.05d | 仓库根有 c-o-c.md | TODO |
| **LIC-5** | `CHANGELOG.md` 初始 + git tag v1.0.0 | 0.1d | 从 git tag 反向生成，v1.0.0 一节描述此版本 | TODO |
| **LIC-6** | `.github/ISSUE_TEMPLATE/{bug,feature}.md` | 0.1d | 提 issue 时自动加载模板 | TODO |
| **LIC-7** | `.github/PULL_REQUEST_TEMPLATE.md` | 0.05d | 提 PR 时自动加载模板 | TODO |

**子小计**：0.55 人·天

### 1.2 演示与文档

| ID | Feature | 工程 | 验收 | 状态 |
|---|---|---|---|---|
| **DOC-1** | README 重写（feature 列表 + screenshot + quickstart + 自托管徽章 + license 徽章） | 0.5d | 首页 < 5 分钟看完并能 5 分钟内 `docker compose up` 跑通 | TODO |
| **DOC-4** | demo seed 数据脚本（虚构 Project Phoenix / Project Cobra + 各 5-8 个任务 + 3-4 个 todo） | 0.5d | `npm run seed` 创建 2 个 workspace，每个含一份 sample plan + 一个虚构 owner | TODO |
| **DOC-5** | `docs/SELF-HOSTING.md`（5 分钟指南：装 Docker → 启 → 改 admin 密码 → 邀请团队） | 0.3d | 新 contributor 拿 README + SELF-HOSTING.md 跑通不超 10 分钟 | TODO |

**子小计**：1.3 人·天

### 1.3 身份与协作层（核心差异化）

| ID | Feature | 工程 | 验收 | 状态 |
|---|---|---|---|---|
| **AUTH-1** | 用户名/密码注册 + bcrypt（cost 12） | 0.5d | POST `/auth/register` 创建用户；同 username 重复 → 409 | TODO |
| **AUTH-2** | Session cookie（`httpOnly; Secure; SameSite=Lax`；HMAC 签名 + DB 持久化 session_id） | 0.5d | 登录成功 set-cookie；后续请求带 cookie 自动鉴权；伪造 cookie → 401 | TODO |
| **AUTH-3** | Workspace 概念 + URL prefix（`/api/ws/:wsId/...`） | 0.5d | workspace 不存在 → 404；非成员访问 → 403 | TODO |
| **AUTH-4** | 邀请链接（一次性 token + 7 天过期 + 注册后失效） | 0.5d | 生成 `INVITE-<random>` token；使用后表内 `consumed_at` 设值；二次使用 → 410 | TODO |
| **AUTH-5** | 三角色 RBAC（owner 全权 / editor 可改 / viewer 只读） | 0.5d | editor 调 DELETE plan → 403；viewer 调 PUT task → 403 | TODO |
| **AUTH-6** | Logout + session 失效（DB 删 session 行） | 0.1d | logout 后 cookie 在 DB 找不到 → 401 | TODO |
| **AUTH-7** | Admin 初始账号（环境变量 `ADMIN_USERNAME` / `ADMIN_PASSWORD` 启动时创建） | 0.1d | `docker run -e ADMIN_USER=...` 首次启动自动建超级管理员 | TODO |

**子小计**：2.7 人·天

### 1.4 数据层

| ID | Feature | 工程 | 验收 | 状态 |
|---|---|---|---|---|
| **DATA-1** | Workspace 物理目录隔离（`data/workspaces/<wsId>/plans/<planId>/{plan,history,todos}.json`） | 0.5d | 切换 workspace 看到的 plans 不重叠；删一个 workspace 不影响另一个 | TODO |
| **DATA-2** | `DATA_DIR` env 覆盖（默认 `./data`）；`PORT` env（默认 3000）；`NODE_ENV` 自动 `production` 禁 source map | 0.1d | `DATA_DIR=/var/lib/plan-gantt node server.cjs` 写入正确路径 | TODO |
| **DATA-3** | 工作区元信息 `workspaces.json`（wsId/name/owner/members/createdAt）独立存储 | 0.2d | 删除某 workspace 元信息不影响其他 | TODO |
| **DATA-4** | 首次启动 seed 检测：空 `DATA_DIR` → 自动加载 DOC-4 的 demo seed | 0.2d | `docker run` 首次启动后 `data/workspaces/sample-1/plans/...` 已就位 | TODO |

**子小计**：1.0 人·天

### 1.5 CI/CD 与部署

| ID | Feature | 工程 | 验收 | 状态 |
|---|---|---|---|---|
| **CI-1** | `.github/workflows/ci.yml`（lint → vitest → vite build → build-server-bundle.sh；Mac + Linux + Windows 三平台矩阵） | 0.5d | PR 自动跑；所有平台绿；CI badge 加 README | TODO |
| **CI-2** | `Dockerfile` 多阶段（node:22-alpine builder + node:22-alpine runtime） | 0.5d | `docker build -t plan-gantt .` 成功；`docker run -p 3000:3000` 起服务 | TODO |
| **CI-3** | `docker-compose.yml`（app 单服务 + 默认卷挂载 `DATA_DIR`） | 0.1d | `docker compose up` 起服务并持久化数据；删除容器数据不丢 | TODO |
| **CI-4** | `.dockerignore`（排除 node_modules/dist/data/.git/docs） | 0.05d | 镜像层数 < 10 | TODO |
| **CI-5** | `Dockerfile.ci-test`（CI 用，含全部 dev deps，跑测试） | 0.2d | CI 中 docker build 测试镜像成功 | TODO |

**子小计**：1.35 人·天

### 1.6 隐私 / 安全 / 仓库清理

| ID | Feature | 工程 | 验收 | 状态 |
|---|---|---|---|---|
| **PRIV-1** | `data/` 加入 `.gitignore`（防止真实业务代号入库） | 0.05d | `git check-ignore data/plans/*` 返回真实路径 | DONE |
| **PRIV-2** | `git filter-repo --mailmap` 重写 `user01@example.com` → 个人邮箱 | 0.3d | `git log --format='%ae' | sort -u` 不再有公司邮箱域名 | DONE |
| **PRIV-3** | 部署脚本路径脱敏（`plan-gantt 一键启动 v1.1.1.cmd` `start-plan-gantt v1.1.1.bat` 占位符化；移入 `deploy/internal/` 不入库） | 0.3d | SMB 路径 `\\192.0.2.8\r&d\` 字符串在仓库内**0 命中** | TODO |
| **PRIV-4** | README/LESSON_LEARN/各 docs 中内网路径替换为 `<your-server>/<your-share>` | 0.2d | `grep -rIn "200\.200\.200\.8\|192\.168\.129\.2\|HN-JAGUAR" --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=data` 返回空 | TODO |
| **PRIV-5** | LICENSE 引用 + NOTICE（如有第三方 attribution） | 0.1d | LICENSE 在仓库根；NOTICE 仅在需要时创建 | DONE |
| **PRIV-6** | `npm audit --omit=dev` 在 CI 跑；HIGH/CRITICAL 阻塞 merge | 0.1d | CI 出现 GHSA-xxxx → fail | TODO |

**子小计**：1.05 人·天

### 1.7 测试套件扩展

| ID | Feature | 工程 | 验收 | 状态 |
|---|---|---|---|---|
| **TEST-1** | Auth 套件（注册 / 登录 / 注销 / bcrypt 验证 / cookie 签名 / session 过期 / 暴力破解限速） | 0.8d | ≥ 25 例 | TODO |
| **TEST-2** | Workspace 套件（创建 / 切换 / 成员管理 / 非成员访问拒绝 / 跨 workspace 数据隔离） | 0.5d | ≥ 15 例 | TODO |
| **TEST-3** | Invite 套件（生成 / 使用 / 重复使用 / 过期 / 撤销） | 0.3d | ≥ 8 例 | TODO |
| **TEST-4** | RBAC 套件（owner/editor/viewer 行为矩阵） | 0.3d | ≥ 12 例 | TODO |
| **TEST-5** | Docker e2e（docker compose up → curl 注册 → curl 创 plan → 验证落盘） | 0.3d | CI 中跑通 | TODO |
| **TEST-6** | demo seed 验证脚本（启动后 workspace 数 / plan 数 / todo 数符合预期） | 0.1d | ≥ 3 例 | TODO |

**子小计**：2.3 人·天

### 1.8 Phase A 文档与发布

| ID | Feature | 工程 | 验收 | 状态 |
|---|---|---|---|---|
| **REL-1** | GitHub release v1.0.0（写 release notes：feature 列表 + 自托管步骤 + screenshot） | 0.3d | https://github.com/.../releases/tag/v1.0.0 可访问 | TODO |
| **REL-2** | `git filter-repo` 后首次 push 到 public GitHub | 0.1d | 仓库可见；`git log --format='%ae' | sort -u` 已脱敏 | TODO |
| **REL-3** | Docker Hub 镜像（`docker push keilzheng/plan-gantt:v1.0.0`） | 0.2d | `docker pull keilzheng/plan-gantt:v1.0.0` 可用 | TODO |
| **REL-4** | launch post（Reddit r/selfhosted + HN Show HN） | 0.5d | 文案 + 链接准备好；用户手动发 | TODO |
| **REL-5** | awesome-selfhosted PR（新增条目到 PM 类目） | 0.2d | PR 模板准备好；用户手动提 | TODO |

**子小计**：1.3 人·天

### Phase A 合计

| 分类 | 人·天 |
|---|---|
| 1.1 元文件 | 0.55 |
| 1.2 演示与文档 | 1.30 |
| 1.3 身份与协作层 | 2.70 |
| 1.4 数据层 | 1.00 |
| 1.5 CI/CD 与部署 | 1.35 |
| 1.6 隐私 / 安全 / 仓库清理 | 1.05 |
| 1.7 测试套件扩展 | 2.30 |
| 1.8 发布 | 1.30 |
| **Phase A 总计** | **~11.5 人·天 ≈ 2.5 周** |

---

## 2. Phase B — P1（增值 v1.1，发布后 4-6 周）

| ID | Feature | 工程 | 验收 | 备注 |
|---|---|---|---|---|
| **DOC-2** | VitePress 用户文档站（`docs-site/`） | 1.0d | GitHub Pages 自动部署；左导航分用户/管理员/开发者 | |
| **CI-6** | Docker Hub 自动构建（GitHub Actions → `docker push` on tag） | 0.3d | 打 tag → 自动出新镜像 | |
| **CI-7** | K8s Helm chart（`charts/plan-gantt/`） | 0.5d | `helm install` 跑通；含 PV/PVC/Secret/Service | |
| **INT-2** | OpenAPI 3.1 文档 + Swagger UI（`/api-docs`） | 1.0d | 全部 endpoints 自动生成；Swagger UI 可调 | |
| **INT-4** | LDAP 接（自托管企业偏好） | 1.5d | 配置 LDAP_URL 后用 AD 账号登录 | |
| **I18N-1** | 中英双语 UI（`react-intl`） | 1.5d | 右上角语言切换；中英字符串完整 | |
| **COLLAB-2** | 操作历史时间线页面（who-did-what when） | 1.5d | 点 plan → "活动" Tab → 列表 | |
| **EXPORT-4** | JSON 项目级导出 / 导入（plan → file → plan） | 0.5d | 导出 JSON 含 plan + history；导入还原 | |
| **EXPORT-5** | PNG 甘特图导出（html2canvas） | 0.5d | 点"导出 PNG"下载 | |
| **ENG-2** | 中国节假日多年份种子（2026 + 自动检测覆盖年度） | 0.5d | `china-holidays --coverage` 命令 | |
| **X-1** | Critical Path 自动标识 | 0.5d | 甘特图红色边框标关键路径 | |
| **X-6** | 截止日期预警（at-risk / overdue 标识） | 0.5d | TaskTable 列上色 + 筛选 | |
| **BETA-1** | 公开 beta 测试 + 收反馈（Reddit / HN 评论） | 1.0d | 收集 ≥ 10 条反馈归档 | |

**Phase B 合计**：~11.8 人·天 ≈ 2.5 周

---

## 3. Phase C — P2（生态 v1.2+，按反馈挑）

> 不一次性做完，按反馈挑 3-5 个最值钱的先做。

| ID | Feature | 工程 | 备注 |
|---|---|---|---|
| **DOC-3** | 开发者文档（架构图 + API 详解 + 插件机制） | 1.0d | 吸引 contributor |
| **CI-8** | 多架构 Docker 镜像（linux/amd64 + linux/arm64） | 0.3d | 树莓派 / Apple Silicon 用户 |
| **INT-1** | Webhook（plan 改动 → POST JSON 到用户 URL） | 1.0d | Slack/Teams 桥接 |
| **INT-3** | OIDC（AzureAD/Google 接） | 1.5d | 企业 SaaS 自托管 |
| **INT-5** | Slack/Teams 通知 bot | 0.8d | 需 Webhook 先行 |
| **I18N-2** | 日期/数字 locale（dayjs locale） | 0.5d | I18N-1 后做 |
| **I18N-3** | 键盘导航完整化 | 0.5d | 可达性 |
| **I18N-4** | a11y axe-core 测试 | 0.5d | 阻止新增 a11y 问题 |
| **COLLAB-1** | 评论 + @mention | 1.5d | 复用 workspace 成员 |
| **COLLAB-3** | 邮件通知（计划到期 / @mention 触发） | 1.0d | 需 SMTP 配置 |
| **EXPORT-6** | iCal (.ics) 导出 | 0.3d | 任务到日历 |
| **PERF-1** | 大计划（500+ 任务）首屏优化（流式 + IndexedDB） | 2.0d | 性能瓶颈 |
| **PERF-2** | Worker thread 排程隔离 | 0.5d | 大计划场景 |
| **PERF-3** | IndexedDB 缓存层 | 1.0d | 离线优先 |
| **PWA-1** | PWA 化（manifest + service worker） | 0.8d | 安装到桌面 |
| **PWA-2** | 移动端响应式优化 | 1.0d | PWA-1 后做 |
| **TPL-1** | 内置计划模板（sprint / waterfall / bug fix） | 0.5d | 起点模板 |
| **TPL-2** | Markdown 模板 | 0.3d | 从 MD 创建 plan |
| **X-2** | 基线对比（baseline snapshot + diff） | 1.5d | 对比"理想 vs 实际" |
| **X-3** | 资源利用率视图（按人 / 按组） | 1.0d | 派活合理性 |
| **X-4** | 风险 / Issue 跟踪 | 1.5d | 关联到任务 |
| **X-7** | Sprint 视图（sprint planning / burndown） | 1.5d | 敏捷派 |

**Phase C 总**：~25 人·天（按需挑选 5-8 项 → ~10-12 人·天 / 季度）

---

## 4. OUT-OF-SCOPE（明确不做）

| 类别 | 不做原因 | 替代方案 |
|---|---|---|
| **COLLAB-4 实时协同编辑（WebSocket）** | 复杂度爆表（CRDT/OT 引擎 + 服务端冲突解决）；单实例 1-3 月工程量；on-prem 单用户场景用不到 | "保存后刷新"模型；冲突靠 K13 乐观并发兜底 |
| **多租户 SaaS** | 与"个人成就感 + on-prem"路线冲突；需要 Postgres/鉴权/支付/合规全套重做 | 用户自建 = 天然多租户隔离 |
| **订阅计费 / Stripe** | 免费路线不需要；商业化路线才需要 | GitHub Sponsors / OpenCollective（被动） |
| **移动端原生 App（iOS/Android）** | React Native 重写 + 商店审核；PWA 已覆盖大部分需求 | PWA-1/PWA-2 渐进 |
| **实时通知（WebSocket 推送）** | 与 COLLAB-4 一同砍 | 邮件通知（COLLAB-3）足够 |
| **Jira 单向同步（INT-5）** | vendor lock-in；做了反而限制 contributor | Webhook（INT-1）让用户自己接 Jira webhook |
| **Atlassian Marketplace 上架** | vendor lock-in + 收费被锁 | 仅 GitHub 即可 |
| **运营 / 营销 / 推广** | 个人项目；做反而稀释精力 | awesome-selfhosted + HN 自然流量 |
| **多设备 session 管理 UI** | v1 简化；session 在 DB 可手动清 | 后续按反馈 |

---

## 5. 推荐推进节奏

### 阶段 A：先看全景（你现在）
1. ✅ 主仓零触碰 → `distribution/open-source` 副本就位
2. ✅ 基线全绿（383 测试通过）
3. ✅ Apache-2.0 LICENSE 已落
4. ✅ `IMPL_ROADMAP.md` 已落（本文档）
5. **📌 你现在 review**——确认 P0 清单 + Phase B 选哪些

### 阶段 B：按 P0 全跑（用户拍板 → ~2.5 周）

按依赖顺序串行：

```
PRIV-1/2/3/4 (仓库清理)
  ↓
LIC-1~7 (元文件)
  ↓
DATA-1/2/3 (存储 + env)
  ↓
AUTH-1/2/3/4/5/6/7 (身份层)
  ↓
DOC-4 + DATA-4 (seed)
  ↓
TEST-1~6 (测试)
  ↓
CI-2/3/4/5 (Docker)
  ↓
CI-1 (GitHub Actions)
  ↓
DOC-1/5 (README + self-hosting)
  ↓
REL-1/2/3 (release + push + Docker Hub)
  ↓
REL-4/5 (launch)
```

### 阶段 C：收反馈，定 P1 选 5 项

---

## 6. 待你拍板

| # | 问题 | 我的建议 |
|---|---|---|
| 1 | P0 清单（16 大项）有没有要砍/加的？ | **按现表全做** |
| 2 | Phase B 里 P1 的 13 项，要先做哪 5 个？ | **INT-2 OpenAPI + I18N-1 双语 + COLLAB-2 历史时间线 + EXPORT-5 PNG + ENG-2 多年份** |
| 3 | AUTH-3 我推荐 **URL prefix 模式**（`/api/ws/:wsId/...`），你 OK 吗？另一种是 subdomain（`acme.example.com`）更复杂 | **URL prefix** |
| 4 | LICENSE_NOTES.md 我提了 `security@keilzheng.dev`，你有自己的公开邮箱吗？ | 用哪个？ |

回我即开干。
