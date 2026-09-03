# 增量设计文档：左侧表格筛选 + Assign to me

> 增量编号：U03

### 变更记录
| 日期 | 版本 | 说明 |
|------|------|------|
| 2026-09-03 | v1 | 首版 |

## 1. 增量变更点清单（对 system_design 的 diff）

### 1.1 新增的文件
| 文件 | 职责 |
|------|------|
| `src/filter.ts` | 过滤模型与纯函数：`FilterState`、`ColumnFilter`（枚举/文本/日期三类）、列值提取、匹配、祖先链 keep 计算、激活判断、摘要文案 |
| `src/components/ColumnFilterMenu.tsx` | 表头漏斗 + MUI Popover 菜单（枚举勾选 / 文本条件 / 日期条件） |
| `src/components/FilterBar.tsx` | 表格顶部工具条：Assign to me + 已筛 chips + 计数 + 清除全部 |
| `src/__tests__/filter.test.ts` | 纯函数单测（18 例） |
| `src/__tests__/filter-ui.test.tsx` | UI 单测（7 例） |

### 1.2 改动的文件
| 文件 | 改动 |
|------|------|
| `shared/scheduler.ts` | `computeVisibleTasks` 增加可选 `keepIds` 参数（`Set<string> \| null`），过滤与折叠取交集、折叠语义优先 |
| `src/store.ts` | 新增 `filter` 状态 + `setColumnFilter` / `setOnlyMine` / `clearAllFilters`；`useVisibleTasks` 改为 `useMemo` 版接入过滤；切计划/新建/导入/预览/恢复版本时重置筛选；新增行数计数选择器 |
| `src/components/TaskTable.tsx` | 表头每列挂漏斗（行号/操作除外）；顶部挂 `FilterBar`；过滤态禁用「新增一行」；底部只读提示改为等高条 |
| `src/components/GanttChart.tsx` | 顶部加等高筛选条；底部图例条改为固定等高 |
| `src/index.css` | 新增 `--filter-bar-h` 变量、`.pg-filter-bar` / `.pg-th-filter` / `.pg-filter-popover` 样式；底部等高条样式 |

### 1.3 不改的文件
- `shared/types.ts`（`Task` / `ComputedTask` 结构不变，过滤是纯视图态，不进数据模型，也不进导出）。

## 2. 关键实现

### 2.1 过滤是「纯视图态」，不落数据、不进导出

筛选只作用于前端可见行的计算，**不修改 `plan.tasks`、不写历史、不进 MSPDI/CSV 导出**。因为 `TaskTable` 与 `GanttChart` 共用同一个 `useVisibleTasks()`（K16 行对齐约束），过滤天然两侧同步，无需在甘特图侧另写一套。

### 2.2 `computeVisibleTasks(tasks, keepIds?)` —— 过滤与折叠的「交集」

```ts
export function computeVisibleTasks(tasks: Task[], keepIds?: Set<string> | null): Task[] {
  const byId = buildTaskIndex(tasks);
  const hidden = new Set<string>();
  for (const t of tasks) {
    const p = t.parentId;
    if (!p) continue;
    const parent = byId.get(p);
    if (!parent) continue;
    // 折叠语义优先：父折叠或父被隐藏 → 子隐藏
    if (hidden.has(p) || parent.collapsed === true) hidden.add(t.id);
  }
  return tasks.filter((t) => !hidden.has(t.id) && (keepIds == null || keepIds.has(t.id)));
}
```

要点：`keepIds` 传 `null` 表示不过滤（现有调用点零改动即可继续用）；折叠隐藏与过滤**同时**生效，折叠语义优先（被折叠隐藏的行即使命中过滤也不显示，直到展开父任务）。

### 2.3 `src/filter.ts` —— 三类列筛选 + 祖先链

```ts
type ColumnFilter =
  | { type: 'enum'; values: string[]; includeBlank: boolean }   // 负责人/顾问人/依赖/时长
  | { type: 'text'; op: 'contains'|'notContains'|'startsWith'|'equals'; q: string }  // 任务名称
  | { type: 'date'; op: 'before'|'onOrAfter'|'after'|'onOrBefore'|'between'; from?: string; to?: string }; // 开始/结束
```

- **列值提取口径与单元格显示一致**：负责人/顾问人用 `formatPeople`（顿号拼接）**按人拆开**逐人做枚举（不是整串当一项）；任务名称取 `name`；日期取 `start`/`end` 的 `YYYY-MM-DD`。
- **匹配**：`matches(task, byColumn)` —— 枚举列看「该列任何一个人名 ∈ values」（`includeBlank` 单独处理空名单）；文本列对 `name` 做四种操作；日期列对 `start`/`end` 做五种操作。
- **祖先链 keep**：先算出所有匹配行，再沿 `parentId` 向上逐层加入祖先 id，得到 `computeKeepIds(tasks, byColumn, onlyMine, me)`；`onlyMine` 打开时等价于给「负责人/顾问人」叠一层「含 me」的枚举过滤。
- **摘要**：`filterSummary(...)` 产出工具条 chips 文案（如 `负责人：User17、User02 等 13 项 + 空值`、`任务名称：包含「DQ」`、`开始：不早于 2026-09-01`）。

### 2.4 store 接入（重置时机）

新增 `filter: FilterState`（`{ byColumn: Record<ColumnKey, ColumnFilter | undefined>, onlyMine: boolean }`）。**切计划 / 新建 / 导入 / 预览版本 / 恢复版本时都重置为空**（对应「不记忆」裁定）。`useVisibleTasks` 改为：

```ts
export function useVisibleTasks(): Task[] {
  const plan = useStore((s) => s.plan);
  const filter = useStore((s) => s.filter);
  const session = useStore((s) => s.session);
  return useMemo(() => {
    if (!plan) return [];
    const keep = computeKeepIds(plan.tasks, filter.byColumn, filter.onlyMine, session.user);
    return computeVisibleTasks(plan.tasks, keep);
  }, [plan, filter, session]);
}
```

### 2.5 两侧等高（K16 严格成立）

左侧表格与右侧甘特图是**左右并排、各有一根独立滚动条**，靠「内容总高相等」保证滚动同步。本轮加入顶部筛选条后，两侧都要加**等高**的筛选条（右侧甘特只放一条占位/计数条，不重复放筛选控件）；底部：甘特图有个 24px 图例条，左侧只读提示只有只读态才出现（26px）——**两侧底部条统一为固定等高**，否则差 2px 会导致滚到底时一侧比另一侧多 2px、K16 破功。实测：两侧 `clientHeight` / `scrollHeight` 均相等（733 / 2020），滚到底 `scrollTop` 一致。

## 3. 部署注意（易踩坑）

- 本轮改了 `shared/scheduler.ts`，按 LESSON §7.13 **必须 `./build-server-bundle.sh` 重打服务端 bundle**，否则 `server-build/server.cjs` 里的旧 `computeVisibleTasks` 没有 `keepIds` 参数，前端传参会被忽略（静默不过滤 / 或类型不匹配）。
- 前端 `vite build` 输出到 `dist/`，服务端静态托管；两处构建都要做。

## 4. 测试与验证

- **纯函数** `filter.test.ts`（18 例）：枚举/文本/日期三类匹配、祖先链回补、`computeKeepIds` 与 onlyMine、列值提取（人名按顿号拆开、空白项）、摘要文案、空过滤恒真。**反向验证**：临时改 `for (const id of matched)` 为 `for (const id of [] )` 后，祖先链用例确实失败（10 例红），确认非假绿。
- **UI** `filter-ui.test.tsx`（7 例）：漏斗渲染、负责人勾选后行数减少、Assign to me 切换、过滤态新增行禁用（用 DOM 查询绕开 MUI Popover 的 `aria-hidden` 与 Tooltip 不渲染 `title` 的问题）、清除全部恢复。
- **真实浏览器**（Chromium / Project-A 59 行）：7 个漏斗、负责人面板 16 项（含 `(空白)`）、Assign to me 59→9 且祖先链完整、任务名称「DQ」→1 行、日期「不早于 2026-09-01」→0 行、多列 AND、chips 单项清除 + 清除全部、过滤态新增行禁用、两侧等高滚动同步、**0 控制台错误**。
