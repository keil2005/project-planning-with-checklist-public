<!--
感谢你的 PR！请填写下面所有 section。
Maintainer 会按 CONTRIBUTING.md 的 DoD 评审。
-->

## 改了什么

<!-- 用 1-2 句话说清这个 PR 解决什么问题 / 加什么能力 -->

- 
- 
- 

## 关联 Issue

<!-- 用 `Closes #123` / `Fixes #123` / `Refs #123` -->

Closes #

## 改动类型

- [ ] Bug fix（非 breaking）
- [ ] New feature（非 breaking）
- [ ] Breaking change（fix / feature 导致现有行为变化）
- [ ] Documentation
- [ ] Refactor（无行为变化）
- [ ] Tests
- [ ] CI / Build

## 怎么测的

### 自动化测试

```bash
NODE_OPTIONS=--max-old-space-size=2048 npx vitest run server/__tests__
NODE_OPTIONS=--max-old-space-size=2048 npx vitest run shared/__tests__
NODE_OPTIONS=--max-old-space-size=2048 npx vitest run src/__tests__
```

- [ ] 新代码加了 vitest 测试
- [ ] 所有既有测试仍然通过
- [ ] 没引入新的 lint warning

### 手动测试

<!-- 怎么手动验证的？docker compose up 后做了什么？ -->

```bash
docker compose up -d
# 打开浏览器...
```

### 截图（UI 改动必填）

<!-- before / after -->

## 不变量检查

<!-- 改动是否影响 IMPL_ROADMAP §0 列出的不变量？K11-K16 / ENGINE-1 / LICENSE-1 / PRIVACY-1 -->

- [ ] 不影响任何不变量
- [ ] 影响了 K（请说明）：__________
- [ ] 同步更新了 `docs/IMPL_ROADMAP.md §0`

## 文档同步

- [ ] 改动了用户文档（README / docs/SELF-HOSTING.md）
- [ ] 改动了开发者文档（docs/* / CONTRIBUTING.md）
- [ ] 改动了 API 文档（如有）
- [ ] 加了 CHANGELOG 条目（仅 feature / breaking）

## 敏感信息

- [ ] 没含公司内部信息（IP / 主机名 / 邮箱 / 客户数据）
- [ ] 没含真实业务计划数据（用了 demo seed 或脱敏）

## 依赖

- [ ] 没引入新依赖
- [ ] 加了新依赖（说明）：__________
- [ ] 检查过 license（仅允许 MIT/BSD/ISC/Apache/0BSD/CC0 系，禁 GPL/AGPL/SSPL）

## Checklist

- [ ] PR 标题遵循 Conventional Commits
- [ ] commit 信息遵循 Conventional Commits
- [ ] 本地跑过 `npm run lint && npm test && npm run build`
- [ ] 改了 `shared/`（提醒：必须 `npx vite build && ./build-server-bundle.sh`）
- [ ] 部署相关（rsync exclude 列表已包含 `config/app.config.local.json` / `deploy/internal/` / `data/`）
