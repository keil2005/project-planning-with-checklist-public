# 增量设计文档：左侧表格列宽可调 + 负责人下拉按最长候选撑开

| 项 | 内容 |
| --- | --- |
| 文档版本 | v1.3（基线 `docs/system_design.md` v1.0 + `docs/design_increment_roster_assignee.md` v1.1 已交付） |
| 架构师 | User01（自写自评） |
| 形态 | 不变（Vite + React + MUI + Tailwind，Node/Express 中心化服务） |
| 对应 PRD | `docs/prd_increment_column_widths.md` |
| 目标读者 | 工程师（据此直接编码，不必读基线全文） |

> 本文件是**增量 diff 视角**。未提及的文件/逻辑一律视为**保持不变**，请勿重写。

### 变更记录

| 日期 | 变更 |
| --- | --- |
| 2026-09-03 | 新增列宽模块 `src/columns.ts`；表头分隔条 + 拖动 + 双击自适应 + 持久化；OwnerAutocomplete popper 宽度改 max-content |
| 2026-09-03 | `autoFitWidth` 兜底判据由「行总宽 ≤ 0」改为「**纯文字**宽 ≤ 0」（详见 §2.3 修正说明） |
| 2026-09-03 | **列宽改按计划独立记忆**：存储键 `plan-gantt:column-widths:v1`（全局）→ `plan-gantt:colw:v2:<planId>`（每计划），带 v1 值迁移（§2.6） |

---

## 1. 增量变更点清单（对 system_design 的 diff）

### 1.1 新增的文件

| 文件 | 内容 | 说明 |
| --- | --- | --- |
| `src/columns.ts` | 列定义 `COLUMNS`（8 列 × {key, label, def, min, max}）、`FLEX_COLUMN_INDEX`（=1，name 列）、`GRID_TEMPLATE_VARS`、`COL_VAR_NAMES`、`TABLE_MIN_W_VAR`、`columnCssVars()`、`clampWidth()`、`gridTemplate()`、`tableMinWidth()`、`defaultWidths()`、`loadWidths(planId)` / `saveWidths(widths, planId)`（**每计划一键** `plan-gantt:colw:v2:<planId>`；旧全局键 `plan-gantt:column-widths:v1` 仅作迁移初值，只读不写）、`autoFitWidth()`（用离屏 span 测量文本宽度，测量不可用时安全降级返回 null） | 列宽单一真源；前后端不耦合（仅前端） |
| `src/__tests__/columns.test.ts` | 单测：COLUMNS 结构、clamp、grid、CSS 变量、load/save（**含按计划独立、v1 迁移、迁移只读不写、planId 为空的兼容**）、autoFit 降级与正向计算 | 30 个用例覆盖纯函数与降级路径 |
| `docs/prd_increment_column_widths.md` | 本次增量 PRD | — |
| `docs/design_increment_column_widths.md` | 本文件 | — |

### 1.2 改动的文件

| 文件 | 改什么 | 说明 |
| --- | --- | --- |
| `src/components/TaskTable.tsx` | ① 删除局部常量 `GRID_COLUMNS` / `MIN_TABLE_WIDTH`；② 新增列宽 state（`useState<number[]>(loadWidths)`）+ `dragRef` + `dragIndex`；③ 拖期间仅 `scrollRef.current.style.setProperty('--col-xxx', ...)` 改 CSS 变量，不触发 React 重渲染，松手才 `setWidths()` 落库；④ 表头用 `COLUMNS.map` 渲染，每列右侧挂 7px 分隔条（`onMouseDown` 起拖、`onDoubleClick` 自适应）；⑤ `RowProps` 增加 `gridStyle` 字段，行 `style={gridStyle}`；⑥ `OwnerAutocomplete` 给 Autocomplete 加 `slotProps.popper.style = { width: 'max-content', minWidth: 200, maxWidth: 520 }` + `slotProps.paper.sx.maxWidth = 520` | 表头不再有手写列名/列宽，所有列结构来自 `COLUMNS` |
| `src/index.css` | 新增 `.pg-th`（定位上下文 + 禁选）、`.pg-th-label`（overflow ellipsis）、`.pg-col-resizer`（7px 命中区、右缘、`:hover` 蓝色 2px 线）、`body.pg-resizing`（全局 col-resize + 禁选） | 视觉提示 |

### 1.3 不改的文件

- `server/`、`shared/`、`server-build/`：列宽是纯前端 UI 偏好，不入数据模型与持久化
- `GanttChart.tsx`、`Dialogs.tsx`、`Toolbar.tsx`、`DatePickerPopover.tsx`：本次不动
- `shared/types.ts`、`shared/scheduler.ts`：无新字段

---

## 2. 关键设计决策

### 2.1 为什么走 CSS 变量、不走 React state 驱动每行重渲染？

59 行表拖动时若每行 `setState` 重渲染，会有可见的卡顿（实测前方案的早期版本）。改方案：拖期间 `setProperty('--col-name', '400px')` 一次只动一行（容器），所有行靠 CSS 变量继承即时变化。React 只在松手 `mouseup` 时 `setWidths(快照)` 一次，整体开销可控。

### 2.2 为什么「负责人下拉宽度」用 `max-content` 而不是 canvas 测宽？

canvas `measureText` 在 jsdom 下会触发「Not implemented: HTMLCanvasElement.prototype.getContext」噪音（不影响通过，但污染测试日志）。改为 CSS `max-content`：浏览器原生基于真实布局计算最宽子项宽度，离屏/jest 环境根本不需要这条计算逻辑（因为 `slotProps.popper.style` 是 React 内联样式，jsdom 测试不渲染 Autocomplete）。

### 2.3 为什么自适应测量用「离屏 span」而不是 canvas？

实测：canvas 在 jsdom 下抛「Not implemented」，需要 try/catch + 降级；离屏 span 的 `getBoundingClientRect()` 在 jsdom 下返回 0 而不抛，由 `autoFitWidth()` 的「测量不可用 → 返回 null」分支接住降级。两路径都安全；span 优势：浏览器环境下自动用当前字体（含 CJK 回退），无需手动拼 `font` 字符串。

> **修正（2026-09-03，实现口径）**：最初的判据是 `if (max <= 0) return null`，其中 `max` 是「行总宽（装饰宽 + 文本）」的最大值。这在 name 列上**永远不成立**——装饰宽 `depth*16 + 18` 本身恒 > 0，于是离屏环境下 `autoFitWidth` 会返回 `clamp(index, 18 + 26)` → 被夹到列宽下限 120，等于「双击把列缩到最小」，与「测量失败就别动」的预期相反。
>
> 现在拆成两个量分别取最大：`textMax`（表头文字 + 各行文本，**纯文字**）与 `rowMax`（装饰宽 + 该行文本）。判据改用 `textMax <= 0`（文字一律测不出 → 测量机制不可用）返回 `null`；最终宽度取 `max(textMax, rowMax) + AUTOFIT_PADDING`。因 `rowMax ≥ 任意单行文本宽`（装饰宽非负），**正常浏览器下 `max(textMax, rowMax) === max(表头, 各行总宽)`，与原口径完全等价**；已用 Project-A 计划复验，8 列自适应后的数值与修正前逐一相同。

### 2.4 「唯一可伸缩列」选 name 的原因

- 任务名才是用户最常需要变长的列
- 固定 px 列（日期、时长、依赖、负责人、操作）的宽度由内容天然决定（YYYY-MM-DD = 10 字符固定、5d/2w 短字符串）
- name 列用 `minmax(W, 1fr)` 让表格自动填满左面板，无需手动对齐右沿

### 2.5 持久化键名加 `:v1`

未来若列定义结构变化（增删列、调顺序），`:v1` 后缀能强制丢弃旧值、回落到默认宽度，不至于解析旧结构炸数据。

### 2.6 列宽存储：为什么「每计划一个键」而不是一个大 JSON（2026-09-03 新增）

用户裁定「列宽按计划独立记忆」后，有两种落盘方案：

| 方案 | 优点 | 缺点 |
| --- | --- | --- |
| A. 单键存 `{ [planId]: number[] }` | 键少，一眼看全 | 每次保存都要「读全量 → 改一项 → 写全量」；**单个计划的值损坏会连带全部计划回落到默认** |
| **B. 每计划一个键 `plan-gantt:colw:v2:<planId>`（选用）** | 写入只影响一个计划；单个键损坏只丢该计划；无需读改写 | 键数量随计划增长（每键约 40 字节，可忽略） |

选 B。前缀统一为 `plan-gantt:colw:`，便于批量清理与测试断言。

#### 迁移策略：只读不写，避免凭空产生配置

```ts
export function loadWidths(planId?: string | null): number[] {
  const def = defaultWidths();
  try {
    if (typeof localStorage === 'undefined') return def;
    const own = localStorage.getItem(storageKeyFor(planId));  // plan-gantt:colw:v2:<planId>
    if (own) return parseWidths(own);
    if (planId) {
      const legacy = localStorage.getItem(LEGACY_STORAGE_KEY); // plan-gantt:column-widths:v1
      if (legacy) return parseWidths(legacy);                  // 迁移：用旧全局值作初值
    }
    return def;
  } catch {
    return def;
  }
}
```

关键取舍：**迁移阶段不写新键**。用户只是打开计划看看，不该因此落盘一份配置。一旦用户真的拖动/双击自适应，`TaskTable` 的 `useEffect` 就会把值写到该计划专属键，此后与 v1 全局值脱钩。

> 注意别做「值等于默认就不写」的小优化——那会导致用户把某列拖回默认值时旧值残留，下次打开又弹回去。无条件写才是对的。

#### 组件侧的计划切换

`TaskTable` 用 ref 记录「当前 `widths` 属于哪个计划」，只在 planId 真的变化时重载，避免挂载时的无谓 setState：

```tsx
const planId = plan?.planId ?? null;
const [widths, setWidths] = useState<number[]>(() => loadWidths(planId));
const loadedPlanRef = useRef<string | null>(planId);
useEffect(() => {
  if (loadedPlanRef.current === planId) return;
  loadedPlanRef.current = planId;
  setWidths(loadWidths(planId));
}, [planId]);
```

---

## 3. 关键代码片段

### 3.1 `src/columns.ts` 节选

```ts
export const COLUMNS: ColumnDef[] = [
  { key: 'seq',      label: '行号',     def:  52, min:  40, max: 120 },
  { key: 'name',     label: '任务名称', def: 260, min: 120, max: 960 },
  // ... 其余 6 列
];

/** grid-template-columns 的「变量版」：挂在滚动容器上，所有行继承 */
export const GRID_TEMPLATE_VARS = COLUMNS.map((c, i) =>
  i === FLEX_COLUMN_INDEX ? `minmax(var(--col-${c.key}), 1fr)` : `var(--col-${c.key})`,
).join(' ');

/** 离屏 span 测宽，jsdom 下返回 0 → autoFitWidth 返回 null 降级 */
export function measureTextWidth(text: string): number { ... }
```

### 3.2 `TaskTable.tsx` 节选：拖拽期只动 CSS 变量

```tsx
useEffect(() => {
  if (dragIndex === null) return;
  const onMove = (ev: MouseEvent): void => {
    const d = dragRef.current;
    if (!d) return;
    const next = clampWidth(d.index, d.base[d.index] + (ev.clientX - d.startX));
    if (next === d.current) return;
    d.current = next;
    const el = scrollRef.current;
    if (el) {
      el.style.setProperty(COL_VAR_NAMES[d.index], `${next}px`);
      const sum = d.base.reduce((a, b, i) => a + (i === d.index ? next : b), 0);
      el.style.setProperty(TABLE_MIN_W_VAR, `${sum}px`);
    }
  };
  const onUp = (): void => { /* 落库 setWidths */ };
  document.body.classList.add('pg-resizing');
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  return () => { /* 清理 */ };
}, [dragIndex, scrollRef]);
```

### 3.3 `OwnerAutocomplete` 节选：MUI popper 宽度

```tsx
<Autocomplete
  ...
  slotProps={{
    popper: {
      placement: 'bottom-start',
      style: { width: 'max-content', minWidth: OWNER_DROPDOWN_MIN_W, maxWidth: OWNER_DROPDOWN_MAX_W },
    },
    paper: { sx: { maxWidth: OWNER_DROPDOWN_MAX_W } },
  }}
  ...
/>
```

> MUI 源码（`node_modules/@mui/material/Autocomplete/Autocomplete.js:656`）将 popper 的默认 `style={{ width: anchorEl.clientWidth }}` 通过 `_extends` 先于 `popperSlotProps` 展开；只要我们在 `slotProps.popper.style` 里重写就能完全替代。

---

## 4. 验证记录

- `tsc --noEmit` 0 错误
- `vitest run`：14 套件 / **282** 测试全绿（含 `columns.test.ts` 30 例）
- playwright 真实浏览器实测：
  - 8 列默认宽 → 拖动 → 越界夹紧 → 双击自适应 → 刷新持久化 ✓
  - Project-A 计划双击「任务名称」分隔条：260 → 282（最长 32 字符任务名「Internal part supplier selection」）
  - Project-A 计划双击「依赖」分隔条：110 → 210（最长依赖表达式）
  - Project-A 计划双击「开始 / 结束」分隔条：96 → 136（日期文本 + 日历按钮 22px）
  - Project-A 计划双击「时长」分隔条：78 → 60（命中 min 下限）
  - 负责人下拉：120 / 90 / 327 三档列宽下，浮层均为 200 px ✓
  - **列边界对齐**：默认列宽 / name 拖到 697px / 横向滚到最右（scrollLeft=631）三种场景下，55 行（含追加行）的 8 列边界与表头逐像素对齐 ✓
  - **按计划独立**：A 拖到 457 → 切 B 仍是默认 260 → B 拖到 137 → 切回 A 恢复 457 → 切回 B 恢复 137 ✓
  - **v1 迁移**：只留旧全局键 `[52,465,96,96,78,101,120,136]` 时，A、B 均继承 465；把 B 改成 162 后 A 仍为 465 ✓
- 控制台 0 报错

---

## 5. 风险与已知坑

| 风险 | 缓解 |
| --- | --- |
| 横向滚动时分隔条被滚出左面板，鼠标拖不动 | 真实使用中用户看不见的分隔条不会去拖；测试时记得 `scrollLeft=0` 后再交互 |
| localStorage 满 / 隐私模式 | `load/save` 全包 try/catch，降级为默认宽度 |
| 列定义未来变化 | 持久化键带 `:v1` / `:v2` 后缀；`loadWidths` 检测结构不符自动回退默认 |
| 自动测量把缩进算进文本宽度 | `autoFitWidth` 对 name 列把 `depth * 16` + 折叠三角 18px 作为 chrome 单加（per-row），不是 global 估算 |
| **降级判据被常量项顶住**（2026-09-03 真实踩坑） | 原判据 `行总宽 <= 0` 因 chrome（装饰宽）恒 > 0 而永不触发。判据必须只用「纯测量值」：`textMax <= 0`。详见 §2.3 |
| 计划被删除后残留列宽键 | 键约 40 字节，无清理入口；若日后做「删除计划」可顺带清 `plan-gantt:colw:v2:<planId>`。当前**不处理** |