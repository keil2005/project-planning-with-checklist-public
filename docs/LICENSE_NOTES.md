# License 选择说明（2026-09-05 拍板）

> 这是给未来自己的备忘，不是开源协议的一部分。

## 决定：Apache-2.0

**用户拍板（2026-09-05）**：plan-gantt 走 **Apache-2.0** 开源。

## 为什么不是 AGPL-3.0

| 维度 | Apache-2.0 | AGPL-3.0 |
|---|---|---|
| 真开源（OSI 认证） | ✅ | ✅ |
| 防 fork 闭源卖 SaaS | ❌ | ✅✅ |
| 企业法务接受度 | ✅✅ 极广 | ⚠️ 部分企业禁用 GPL 系 |
| Patent grant | ✅ 显式 | ⚠️ §13 模糊 |
| 与"个人成就感 + 副业口碑"路线契合度 | ✅✅ 强（口碑 = 企业愿意用 = contributor 多） | ⚠️ 过度保护，与路线不符 |

**关键判断**：用户明确"个人成就感 + 副业口碑 + 免费"路线，**SaaS 商业化不是优先目标**。AGPL 防 SaaS fork 闭源的能力在个人项目层面没有实战价值（云厂商不会 fork 你），反而把"个人路线下无意义"的保护成本，转嫁到"未来企业用得难受"的用户体验上。**Apache-2.0 是匹配个人免费路线的最优解**。

## 为什么不是 MIT

- MIT 缺 patent grant → 如果未来某人改完用 plan-gantt 的某个算法申请专利，反过来告原作者（理论上罕见，但有先例），Apache 的 patent grant 防御这一手
- Apache 比 MIT 多一个 "explicit patent grant" + "trademark 隔离" + "贡献者协议明示"——多出来的条款是工业界标准、企业法务无忧
- 对 contributor 数量没本质影响

## 兼容性下游

- Apache-2.0 是 **GPLv3 兼容**（单向：Apache 代码可合并到 GPLv3 项目，反之不行）
- 与本项目当前所有依赖（MIT/BSD/ISC/0BSD/Apache）**全部无冲突**
- 如果未来有人 fork 并用 GPL 系授权，**他们**的代码不能用回**我们的**Apache 主干（这是 Apache 的设计，不是 bug）

## 关键决策点（拍板日期 2026-09-05）

| 决策点 | 选择 | 理由 |
|---|---|---|
| License | **Apache-2.0** | 个人免费路线 + 企业法务友好 + patent grant |
| Trademark 隔离 | 标准 §6（不授权使用"plan-gantt"作为商标） | 个人项目也得护住名字 |
| 是否提供 CLA | **暂不** | 个人项目 + Apache 已有 implicit contribution license，过度形式化反而阻碍 |
| 第三方依赖 license 策略 | 仅允许 MIT/BSD/ISC/Apache/0BSD/CC0 系 | GPL/AGPL/SSPL 传染库**禁止**进入；CI 加 `license-checker --failOn 'GPL'` |
| NOTICE 文件 | 暂不创建 | 当前无第三方需要 attributions，简化 |
| Sponsorship 入口 | GitHub Sponsors（暂不主动开） | 个人项目，不主动募资 |
