# 增量设计文档：新增「顾问人」列 + 负责人/顾问人支持多人

| 项 | 内容 |
| --- | --- |
| 文档版本 | v1.4（基线 `docs/system_design.md` v1.0 + `docs/design_increment_column_widths.md` v1.3 已交付） |
| 架构师 | User01（自写自评） |
| 形态 | 不变（Vite + React + MUI + Tailwind，Node/Express 中心化服务） |
| 对应 PRD | `docs/prd_increment_consultant_multi.md` |
| 目标读者 | 工程师（据此直接编码，不必读基线全文） |

> 本文件是**增量 diff 视角**。未提及的文件/逻辑一律视为**保持不变**，请勿重写。

### 变更记录

| 日期 | 变更 |
| --- | --- |
| 2026-09-03 | 新增 `shared/people.ts`（人员字段单一真源）；`Task.owner` 升级为 `string[]`、新增 `Task.consultant`；`TaskTable` 用 `PeopleCell` 取代 `OwnerAutocomplete`；`columns.ts` 新增顾问人列 + 列宽存储 v2→v3；导出/导入适配 |
| 2026-09-03 | **修正 A**：Esc 关闭编辑器改用**捕获阶段原生监听**（MUI `useAutocomplete` 在 Escape 分支 `stopPropagation()`，冒泡阶段的 React `onKeyDown` 收不到） |
| 2026-09-03 | **修正 B**：选中行滚动由 `scrollIntoView` 改为**只改 `scrollTop`**（行宽 > 面板宽时 `inline:'nearest'` 会横向猛跳 314px） |
| 2026-09-03 | **部署修正**：改了 `shared/` 必须 `./build-server-bundle.sh` 重打服务端 bundle，只跑 `vite build` 会让服务端用旧 `normalizePlan()` 把数组型 owner 静默丢弃 |

---

## 1. 增量变更点清单（对 system_design 的 diff）

### 1.1 新增的文件

| 文件 | 内容 | 说明 |
| --- | --- | --- |
| `shared/people.ts` | `PeopleField`（`'owner' \| 'consultant'`）、`PEOPLE_FIELDS`、`PEOPLE_SEP`（`、`，**不能是逗号**）、`normalizePeople()`、`formatPeople()`、`peopleOf()`、`collectPeople()` | 人员字段的**唯一真源**，前后端共用；拆分/去重/格式化规则只此一份 |
| `shared/__tests__/people.test.ts` | 16 例：字符串迁移（单人 / 空串 / 7 种分隔符 / 含空格姓名不被拆）、数组透传与清洗、脏数据降级、`formatPeople`、`peopleOf` / `collectPeople` | — |
| `src/__tests__/people-cell.test.tsx` | 3 例：多选连选、**Esc 关闭编辑器回归**、顾问人与负责人互不影响 | 用 RTL + jsdom；**必须手动 `cleanup()`**（本文件未开 vitest globals） |

### 1.2 改动的文件

| 文件 | 改什么 | 说明 |
| --- | --- | --- |
| `shared/types.ts` | `TaskField` 移除 `'owner'`（人员字段改走独立动作）；`Task.owner?: string[]`、`Task.consultant?: string[]` | 单人字符串 → 多人数组 |
| `shared/scheduler.ts` | `normalizePlan()` 里改恒写 `owner: normalizePeople(t.owner)` / `consultant: normalizePeople(t.consultant)` | **归一化即迁移**：历史字符串自动拆数组，缺失 consultant 补 `[]`；不做独立 schema 迁移脚本 |
| `shared/people.ts` → `src/store.ts` | 新增 `updatePeople(taskId, field, names)`（整段替换 + `normalizePeople` 归一 + 内容相同则跳过赋值）；`addRow` 默认 `owner=[] / consultant=[]`；`useOwnerCandidates()` 用 `collectPeople()` 同时收两列的名单外姓名 | 与 `updateCell` 分开：人员是 `string[]`，不是文本单元格 |
| `src/columns.ts` | ① `ColumnKey` 加 `'consultant'`；② `COLUMNS` 加「顾问人」(def/min/max = 120/90/360)；③ `columnTexts()` 两列都走 `formatPeople()`；④ **存储 v2→v3**：`plan-gantt:colw:v3:<planId>` 存**按列名对象**，新增 `LEGACY_LAYOUT`（v1/v2 时代的 8 列顺序，仅作迁移解释依据，历史事实勿改）、`widthsFromLegacyArray()` | 见 §2.4 |
| `src/components/TaskTable.tsx` | ① 删 `OwnerAutocomplete`（164 行）→ 新增 `PeopleCell`（多选编辑器）；② 行组件内 `ownerEditing` / `consultantEditing` 两个 state，编辑时给单元格加 `.pg-cell--people-editing` 放开 `overflow`；③ 选中行滚动改纵向专用 | 见 §2.3 |
| `src/index.css` | `.pg-cell--people{position:relative}`、`.pg-cell--people-editing{overflow:visible;z-index:20}`、`.pg-people-editor{position:absolute;left:4px;top:2px;min-width:248px;max-width:420px;max-height:104px;overflow-y:auto;z-index:30}` | 浮层不占文档流 → 行高恒 32 |
| `src/components/GanttChart.tsx` | `formatPeople(t.owner)` 顿号拼接显示；顾问人不上条（按裁定只作备注） | 两处任务条渲染 |
| `server/exporters.ts` | 新增 `buildNotes(t)`（原备注 + `顾问人：A、B`）；Resources/Assignments 遍历 `normalizePeople(t.owner)` 展开多人；`CSV_HEADER` 插入 `'顾问人'`（12 → 13 列），人员列用顿号拼接 | 见 §2.5 |
| `server/mppImport.ts` | MPP 的资源名 → 包成单元素数组；`consultant: []` 恒为数组 | — |
| 测试文件 | `columns.test.ts`（9 列结构 + v3 存储语义重写）、`store.test.ts`、`owner-commit.test.ts`、`owner-crash.test.tsx`、`server/__tests__/assignee.test.ts`、`exporters.test.ts`、`mpp-import.test.ts` | 历史快照与断言同步改为数组语义 |

### 1.3 不改的文件

- v1.1.x 历史的固定人员名单已废弃（详见 v1.2.0 commit `b2ab140`），运行时改为 workspace 邀请制
- `server/lockService.ts` / `api` 路由 / `calendar` 相关：与人员字段无关
- `shared/types.ts` 的 `schemaVersion`（保持 1）

---

## 2. 关键实现

### 2.1 `shared/people.ts` —— 人员字段单一真源

```ts
export type PeopleField = 'owner' | 'consultant';
export const PEOPLE_SEP = '、';          // 展示/CSV 拼接符；逗号会撑出额外 CSV 列
const SPLIT_RE = /[,，、;；|/]+/;        // 只按分隔符拆，不拆含空格的姓名（保留 "First Last" 类双词姓名）

export function normalizePeople(v: unknown): string[] {
  if (Array.isArray(v)) return dedupe(v.flatMap((x) => (typeof x === 'string' ? x.split(SPLIT_RE) : [])));
  if (typeof v === 'string') return dedupe(v.split(SPLIT_RE));
  return [];                             // null / 数字 / 对象 / 布尔 → 空数组
}
```

`dedupe()`：trim → 去空 → **大小写不敏感去重，保留首次出现的写法**（`['User01','user01','User02']` → `['User01','User02']`）。

> 注意：`normalizePeople` 的去重是**一次提交内部**生效的。`updatePeople` 是整段替换，跨提交重新提交 `['User01','user13']` 时，`user13` 在本次提交里是首次出现，会保留小写写法 —— 单测已按此语义锁定。

### 2.2 归一化即迁移（`shared/scheduler.ts`）

```ts
// 人员字段（负责人 / 顾问人）：恒归一化为数组。
// 历史数据：owner 可能手打过 "<示例名>,<示例名>"，normalizePeople 自动拆分为数组
// 旧计划缺失 consultant → 空数组。写回后即完成升级，无需单独的 schemaVersion 迁移脚本。
owner: normalizePeople(t.owner),
consultant: normalizePeople(t.consultant),
```

磁盘上 4 个既有计划的 owner 实测仍是字符串（`User05` / `User04` / `User06` / `user14`），打开后由这条规则直接以数组形态显示，**用户保存时才落盘为数组**。

### 2.3 `PeopleCell` —— 窄格里的多选编辑器

```
只读态  <div class="pg-input" title="点击设置负责人（当前：A、B）">A、B</div>
编辑态  <div class="pg-people-editor">            ← position:absolute，不占文档流
          <Autocomplete multiple freeSolo disableCloseOnSelect … />
        </div>
```

| 关键点 | 为什么 |
| --- | --- |
| `disableCloseOnSelect` | MUI 多选默认选完一个就关闭下拉，无法连选 |
| `slotProps.popper.style = { width:'max-content', minWidth:248, maxWidth:420 }` | 覆盖 MUI「浮层与输入框同宽」的默认，120px 窄格也能撑开 |
| 父级 `.pg-cell--people-editing{overflow:visible}` | `.pg-cell` 默认 `overflow:hidden`，会把绝对定位的浮层裁成 120px 一条 |
| `onChange` 里即时 `onCommit(normalizePeople(val))` | 实时落库，不依赖失焦，避免"选完就跑"丢数据 |
| `close()` 用 `setTimeout(…, 0)` 延迟卸载 | 避免「选中即同步卸载」触发 MUI portal 的 `removeChild` 竞态（老坑，会整页白屏） |

#### 修正 A：Esc 必须用捕获阶段监听

```ts
// MUI useAutocomplete 在自己的 Escape 分支里调了 event.stopPropagation()，而 React 的事件是
// 委托在 root 容器上的，冒泡到包装 div 之前就被 MUI 掐断 → 实测 Esc 关不掉编辑器（只能靠失焦）。
// 捕获阶段先于目标元素的 MUI 处理器执行，这里 stopPropagation 还能顺带屏蔽 MUI 自己的处理。
useEffect(() => {
  const el = wrapRef.current;
  if (!editing || !el) return;
  const onEsc = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    finishRef.current();
  };
  el.addEventListener('keydown', onEsc, true);
  return () => el.removeEventListener('keydown', onEsc, true);
}, [editing]);
```

`finishRef` 存最新 `finish`，避免 effect 因 `onCommit` 每次渲染换引用而反复解绑重绑。

#### 修正 B：选中行只纵向滚动

```ts
useEffect(() => {
  if (!selectedTaskId) return;
  const el = rowRefs.current.get(selectedTaskId);
  const box = scrollRef.current;
  if (!el || !box) return;
  const boxRect = box.getBoundingClientRect();
  const head = box.querySelector('.pg-sticky-head');
  const top = boxRect.top + (head ? head.getBoundingClientRect().height : 0);
  const bottom = boxRect.bottom;
  const r = el.getBoundingClientRect();
  if (r.top < top) box.scrollTop += r.top - top;
  else if (r.bottom > bottom) box.scrollTop += r.bottom - bottom;
}, [selectedTaskId, scrollRef]);
```

原 `el.scrollIntoView({ block:'nearest' })` 默认 `inline:'nearest'`，**行宽 > 面板宽度时浏览器会横向对齐边缘** → 点任意单元格表格横向跳 314px（新增顾问人列后表格更宽，必现）。横向滚动位置是用户自己选的视图，不该被动。

### 2.4 列宽存储 v2 → v3（按列名）

```ts
const STORAGE_KEY_PREFIX = 'plan-gantt:colw:v3:';
const LEGACY_V2_KEY_PREFIX = 'plan-gantt:colw:v2:';
const LEGACY_V1_KEY = 'plan-gantt:column-widths:v1';
/** v1/v2 时代的 8 列顺序 —— 描述历史事实，将来增删列都不要改 */
const LEGACY_LAYOUT: readonly ColumnKey[] = ['seq','name','start','end','duration','deps','owner','actions'];
type StoredWidths = Partial<Record<ColumnKey, number>>;
```

降级链：v3 本计划键 → v2 本计划键（迁移） → v1 全局键（迁移） → 默认值。**迁移只读不写**。

### 2.5 导出语义（`server/exporters.ts`）

```ts
function buildNotes(t: Task): string {
  const note = typeof t.note === 'string' ? t.note : '';
  const consultants = normalizePeople(t.consultant);
  if (consultants.length === 0) return note;
  const line = `顾问人：${formatPeople(consultants)}`;
  return note.trim() === '' ? line : `${note}\n${line}`;
}
```

- **MSPDI**：`Resource` / `Assignment` 只遍历 `normalizePeople(t.owner)`（一任务多人 → 每人一条）；顾问人只进 `Notes`。
- **CSV**：表头 13 列，人员列用 `formatPeople()`（顿号），不能用逗号。

---

## 3. 部署注意（易踩坑）

| 坑 | 现象 | 处置 |
| --- | --- | --- |
| **只跑 `vite build`，没重打服务端 bundle** | 服务端仍是旧 `normalizePlan()`（`typeof t.owner === 'string'` 才保留）→ **数组型 owner 被静默丢弃、consultant 直接没有**，保存后重载人员全空，且没有任何报错 | 改了 `shared/` 下任何文件后，必须 `./build-server-bundle.sh` 重新 esbuild 打包，再 `pkill -f server-build/server.cjs && ./start-mac.sh` |
| 测试全绿但线上行为不对 | vitest 直接跑 TS 源码，用的是新 `shared/`；而运行的是 `server-build/server.cjs` 里的旧副本 | 同上；把「重打 bundle」纳入发布清单 |

---

## 4. 测试与验证

| 层 | 内容 | 结果 |
| --- | --- | --- |
| 单测 | 16 套件 / 312 例（新增 30 例：`people.test.ts` 16 + `columns.test.ts` 重写 + `people-cell.test.tsx` 3 + 各文件断言改数组） | **全绿** |
| 类型 | `tsc --noEmit` | **0 错误** |
| 真实浏览器 | Playwright / Chromium：9 列列序、历史字符串迁移显示、负责人/顾问人各选 2 人、行高恒 32、Esc 关闭、保存→重载持久化、落盘为数组 | **全绿，0 控制台错误** |

手动回归步骤（后续改动人员字段时照做）：

```bash
npx vite build && ./build-server-bundle.sh
pkill -f "server-build/server.cjs"; ./start-mac.sh
python3 /tmp/ui_save_test.py     # 新建计划 → 多人 → 保存（填变更纪要）→ 重载回查
python3 /tmp/ui_people2.py       # 真实计划：列序 / 迁移显示 / 多选 / 行高 / Esc
```
