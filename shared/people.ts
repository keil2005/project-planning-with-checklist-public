/**
 * shared/people.ts —— 人员字段（负责人 / 顾问人）的唯一真源：类型、归一化、格式化。
 *
 * 背景（2026-09-03 增量）：
 *  - 原 `Task.owner?: string` 只支持一个人；需求改为「负责人 / 顾问人都允许不止一个人」。
 *  - 因此 `owner` 由 string 升级为 string[]，并新增同构的 `consultant`。
 *
 * 设计约定：
 *  1. **落盘形态恒为数组**：归一化统一在 `normalizePlan()` 完成（前后端共用，见 shared/scheduler.ts），
 *     所以业务代码拿到的 task.owner / task.consultant 只可能是 string[]（可能为空数组），
 *     不需要再写 `Array.isArray` 判空——但读取外部 JSON 时仍建议过一遍 normalizePeople。
 *  2. **去重大小写不敏感、保留首次出现的原始写法**：名单固定 21 人（`shared/roster.ts`），
 *     同一个人的 `User01` / `user01` 不应产生两个 Resource；但用户手打的自定义姓名原样保留。
 *  3. **历史字符串自动拆分**：旧数据里若有人手打成 "User01,User13"，按分隔符拆成两人；
 *     单个名字 "User01" 拆完仍是 ["User01"]，无副作用。
 *  4. **顺序即录入顺序**：不做排序，用户先选谁谁在前（导出 Resource 顺序依赖它）。
 */

/** 人员字段：负责人 / 顾问人（两列同构，渲染与提交逻辑共用） */
export type PeopleField = 'owner' | 'consultant';

export const PEOPLE_FIELDS: readonly PeopleField[] = ['owner', 'consultant'] as const;

/** 展示分隔符：中文顿号（'、'），用于表格单元格与导出文本 */
export const PEOPLE_SEP = '、';

/**
 * 拆分分隔符：中英文逗号 / 顿号 / 分号 / 竖线 / 斜杠。
 * 只用于「历史字符串 → 数组」的迁移与自由文本粘贴，不影响名单内含空格的姓名（如 'Group A'）。
 */
const SPLIT_RE = /[,，、;；|/]+/;

/** 去重（大小写不敏感，保留首次出现的原始写法）+ 去空白项 + trim */
function dedupe(raw: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of raw) {
    const t = s.trim();
    if (t === '') continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

/**
 * 把任意来源（字符串 / 字符串数组 / null / 脏数据）规整成人员数组。
 * 非字符串、非数组一律返回空数组，不抛错——它跑在 normalizePlan 里，不能因为脏数据炸掉整个计划加载。
 */
export function normalizePeople(v: unknown): string[] {
  if (Array.isArray(v)) {
    const flat: string[] = [];
    for (const item of v) {
      if (typeof item !== 'string') continue;
      // 数组元素里若仍含逗号（例如从 CSV 粘进来的 "User01,User13"），同样拆开
      flat.push(...item.split(SPLIT_RE));
    }
    return dedupe(flat);
  }
  if (typeof v === 'string') {
    return dedupe(v.split(SPLIT_RE));
  }
  return [];
}

/** 人员数组 → 展示文本（空数组 → 空串，调用方自行决定占位符） */
export function formatPeople(names: readonly string[] | undefined, sep: string = PEOPLE_SEP): string {
  if (!names || names.length === 0) return '';
  return names.join(sep);
}

/** 从任务上取某个人员字段（永远返回数组，外部 JSON 也安全） */
export function peopleOf(task: { owner?: unknown; consultant?: unknown } | undefined, field: PeopleField): string[] {
  if (!task) return [];
  return normalizePeople(field === 'owner' ? task.owner : task.consultant);
}

/** 两列合并去重后的姓名集合（用于「本计划已用过的名单外姓名」候选收集） */
export function collectPeople(task: { owner?: unknown; consultant?: unknown } | undefined): string[] {
  if (!task) return [];
  return dedupe([...normalizePeople(task.owner), ...normalizePeople(task.consultant)]);
}
