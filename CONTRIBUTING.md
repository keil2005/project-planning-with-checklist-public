# Contributing to Project Planning with Checklist

> 感谢你愿意贡献 Project Planning with Checklist！这份文档会告诉你怎么提 issue / 写代码 / 提 PR。

## 一句话原则

> **修一个 bug 或加一个 feature，必须配套测试；CI 必须全绿。** 没有测试的 PR 我们不收——不是因为严格，是因为三个月后你自己也看不懂。

---

## 1. 工作流

```
issue（讨论）
   ↓
fork / 分支
   ↓
实现 + 测试
   ↓
本地跑通：lint + test + build
   ↓
PR（含描述 + 截图 + 关联 issue）
   ↓
CI 全绿 + maintainer review
   ↓
合并 + 自动 changelog
```

---

## 2. 提 Issue

**先搜**：在 https://github.com/keil2005/project-planning-with-checklist/issues 搜一下，避免重复。

**Bug 报告**：用 `.github/ISSUE_TEMPLATE/bug.md` 模板，必须含：
- 复现步骤（一步一步来）
- 期望 vs 实际
- 环境（OS / Node 版本 / Docker 还是源码）
- 截图或日志（如有）

**功能建议**：用 `.github/ISSUE_TEMPLATE/feature.md` 模板，说清楚：
- 痛点（什么场景让你需要这个）
- 你期望的体验（最好有截图或草图）
- 替代方案（如果存在）
- 是否愿意自己写（PR 优先于纯建议）

---

## 3. 写代码

### 3.1 环境准备

```bash
git clone https://github.com/<your-fork>/project-planning-with-checklist
cd project-planning-with-checklist
npm install
npm test                  # 全跑（分段跑避免 OOM）
npm run build              # 前端 + 服务端 bundle
```

### 3.2 分支命名

| 类型 | 命名 | 例子 |
|---|---|---|
| Bug fix | `fix/<short-desc>` | `fix/lock-timeout-race` |
| 新 feature | `feat/<short-desc>` | `feat/oidc-sso` |
| 重构 | `refactor/<short-desc>` | `refactor/storage-fs` |
| 文档 | `docs/<short-desc>` | `docs/oidc-setup` |
| 测试 | `test/<short-desc>` | `test/lock-concurrency` |

### 3.3 Commit 规范

遵循 [Conventional Commits](https://www.conventionalcommits.org/)：

```
<type>(<scope>): <subject>

<body>

<footer>
```

**Type**: `feat | fix | refactor | docs | test | chore | perf | ci`

**例子**：
```
feat(auth): add OIDC SSO support

Closes #123

- Add server/auth/oidc.ts (passport-openidconnect)
- Add OIDC_* config keys
- Add vitest coverage for happy path + callback failure
- Update README + SELF-HOSTING.md
```

### 3.4 代码风格

- **TypeScript strict**：不开 strict 的新代码不收
- **ESLint**：`npm run lint` 通过
- **Prettier**：跟项目 `.prettierrc`，提交前自动 format
- **命名**：组件 PascalCase / 函数 camelCase / 常量 UPPER_SNAKE_CASE / 类型 PascalCase

### 3.5 测试

- 新代码必须带 vitest 测试
- 单元测试放 `server/__tests__/` / `shared/__tests__/` / `src/__tests__/`
- 测试文件命名 `<unit>.test.ts`
- 不变量（IMPL_ROADMAP §0）必须有专门测试覆盖

**跑测试**：
```bash
npm test                       # 全跑（需分次，OOM）
NODE_OPTIONS=--max-old-space-size=2048 npx vitest run server/__tests__
NODE_OPTIONS=--max-old-space-size=2048 npx vitest run shared/__tests__
NODE_OPTIONS=--max-old-space-size=2048 npx vitest run src/__tests__
```

---

## 4. 提 PR

用 `.github/PULL_REQUEST_TEMPLATE.md` 模板。**必填**：
- 改了什么（feature / fix / refactor）
- 怎么测的（手动命令 + 自动化测试结果）
- 截图（UI 改动必须）
- 关联 issue（`Closes #xxx`）

**DoD（Definition of Done）**：
- [ ] CI 全绿（lint + test + build 三平台矩阵）
- [ ] 新代码覆盖率 ≥ 既有水平（不会硬降）
- [ ] 文档同步（README / SELF-HOSTING / docs/*）
- [ ] 无 公司内网 / 公司邮箱 / 客户数据等敏感信息
- [ ] 没引入 GPL/AGPL/SSPL 系传染依赖

---

## 5. 项目不变量（改动前必读）

这些是 Project Planning with Checklist 的**核心承诺**，改动前请确认不会破坏：

| ID | 不变量 |
|---|---|
| K11 | 编辑锁：同一 planId+taskId 只能被一个 user 持有，30s heartbeat |
| K12 | 服务端是排程的唯一 source of truth |
| K13 | 保存必传 `baseVersion`，不匹配返回 409 |
| K15 | `todo.assignee ∉ (owner ∪ consultant)` 自动并入 owner（单向只增） |
| K16 | TaskTable + GanttChart 32px 同步行高；todo 详情用右侧 Drawer |
| ENGINE-1 | MSPDI XML 导出/导入基于 Microsoft 公开规范 |
| LICENSE-1 | Apache-2.0；下游可商用、改、再分发；不授权使用 "Project Planning with Checklist" 商标 |

详见 `docs/IMPL_ROADMAP.md §0`。

---

## 6. 不收的 PR

- ❌ 引入 GPL/AGPL/SSPL 传染依赖
- ❌ 引入 SaaS 多租户架构（与路线冲突）
- ❌ 引入实时协同编辑（CRDT 复杂度超 v1.x 路线）
- ❌ 删除现有测试
- ❌ 改动不变量却没更新 IMPL_ROADMAP §0
- ❌ 含公司内部信息（主机名 / 邮箱 / 客户数据）
- ❌ 纯文档 typo fix（直接改，少开 PR）

---

## 7. 沟通

- **GitHub Issues**：bug / feature 讨论
- **GitHub Discussions**：开放问题、最佳实践、show & tell
- **邮件**：[见 SECURITY.md](SECURITY.md) 仅用于安全漏洞披露，**不**用于普通支持

---

## 8. 许可证

贡献即同意你的代码按 [Apache-2.0](LICENSE) 发布。无需额外 CLA（项目暂不要求）。如需保留第三方代码片段版权，PR 描述里注明出处。
