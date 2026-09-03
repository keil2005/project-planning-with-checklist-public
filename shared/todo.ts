/**
 * shared/todo.ts —— 任务细分交付清单（TodoItem）的唯一真源：清洗、一致性、进度、ID 生成。
 *
 * 背景（U04，2026-09-03）：
 *  - todo 是「轻量验收清单」，不是 WBS 子任务（不进甘特/依赖/排程/导出资源）。
 *  - 字段：text + done + order + assignee?（assignee 单人，MVP 即做）。
 *
 * 一致性不变量（用户裁定）：
 *  - 当 `todo.assignee = X` 且 `X ∉ (负责人 ∪ 顾问人)` 时，**自动把 X 并入负责人**；
 *  - **单向只增、不自动移除**：X 的 assignee 被清掉后，之前并入的负责人保留，由用户手动清理
 *    （避免误删用户手动填的负责人）。
 *  - 由此「Assign to me 只认负责人/顾问人」自动覆盖「我负责了某个 todo」。
 */

import type { TodoItem, TodoOp } from './types';
import { normalizePeople } from './people';

/** todo id 生成计数器（仅 makeTodoId 用，模块级无副作用导出，不污染纯函数） */
let todoSeq = 0;

/** 生成任务内唯一 todo id（store 新建明细用） */
export function makeTodoId(): string {
  todoSeq += 1;
  return `td-${Date.now().toString(36)}-${todoSeq}`;
}

/**
 * 清洗 TodoItem 数组：非法项 / 空文本丢弃；id 空或重复时做确定性补救（任务内唯一）；
 * order 按数组序重排；assignee trim（空则省略字段）。
 * 跑在 normalizePlan 里，不能因为脏数据炸掉整个计划加载。
 */
export function sanitizeTodos(raw: unknown, taskId: string): TodoItem[] {
  if (!Array.isArray(raw)) return [];
  const out: TodoItem[] = [];
  const seen = new Set<string>();
  raw.forEach((r) => {
    const item = (r ?? {}) as Partial<TodoItem>;
    if (typeof item !== 'object' || item === null) return;
    const text = typeof item.text === 'string' ? item.text.trim() : '';
    if (text === '') return;
    let id = typeof item.id === 'string' && item.id !== '' ? item.id : '';
    if (id === '' || seen.has(id)) id = `${taskId}-td-${out.length}`;
    seen.add(id);
    const assignee = typeof item.assignee === 'string' ? item.assignee.trim() : '';
    out.push({
      id,
      text,
      done: item.done === true,
      order: out.length,
      ...(assignee !== '' ? { assignee } : {}),
    });
  });
  return out;
}

/**
 * 一致性不变量（单向只增）：todo.assignee 不在负责人/顾问人里时，自动并入负责人。
 * 就地修改（调用方传入 normalizePlan 里的 cleaned 副本）。比较大小写不敏感。
 */
export function enforceTodoOwnerConsistency(
  tasks: { owner?: unknown; consultant?: unknown; todos?: TodoItem[] }[],
): void {
  for (const t of tasks) {
    const owners = normalizePeople(t.owner);
    const consultants = normalizePeople(t.consultant);
    const present = new Set([...owners, ...consultants].map((p) => p.trim().toLowerCase()));
    let changed = false;
    for (const todo of t.todos ?? []) {
      const a = todo.assignee;
      if (!a) continue;
      const key = a.trim().toLowerCase();
      if (present.has(key)) continue;
      owners.push(a);
      present.add(key);
      changed = true;
    }
    if (changed) t.owner = owners;
  }
}

export interface TodosProgress {
  done: number;
  total: number;
}

/** done 计数 / 总数（UI 徽章与导出共用） */
export function todosProgress(todos: readonly TodoItem[] | undefined): TodosProgress {
  const list = todos ?? [];
  let done = 0;
  for (const t of list) if (t.done) done += 1;
  return { done, total: list.length };
}

/** 'x/y' 进度文本；0 项返回空串（调用方自行决定占位符） */
export function todosProgressText(todos: readonly TodoItem[] | undefined): string {
  const { done, total } = todosProgress(todos);
  if (total === 0) return '';
  return `${done}/${total}`;
}

/**
 * 对单个任务的 todo 清单执行一条指令（add / update / delete / move），返回新数组。
 * 纯函数（不就地修改），供服务端指令接口与单测共用：
 *   - add    ：push 新项（text 空 → 原样返回）
 *   - update ：按 todoId 打补丁（text/done/assignee；空文本不更新）
 *   - delete ：按 todoId 删除（不存在 → 幂等）
 *   - move   ：按 todoId 上移(-1)/下移(+1)，越界 → 原样返回
 * 末尾统一按数组序重排 order，保证 order === 下标。
 */
export function applyTodoOp(todos: readonly TodoItem[], op: TodoOp, makeId: () => string): TodoItem[] {
  const list = [...todos];
  const idx = op.todoId ? list.findIndex((t) => t.id === op.todoId) : -1;

  switch (op.op) {
    case 'add': {
      const text = typeof op.text === 'string' ? op.text.trim() : '';
      if (text === '') return list;
      list.push({ id: makeId(), text, done: false, order: list.length });
      break;
    }
    case 'update': {
      if (idx < 0 || !op.patch) return list;
      const cur = list[idx];
      const next: TodoItem = { ...cur };
      if (op.patch.text !== undefined) {
        const t = op.patch.text.trim();
        if (t === '') return list;
        next.text = t;
      }
      if (op.patch.done !== undefined) next.done = op.patch.done;
      if (op.patch.assignee !== undefined) {
        const a = op.patch.assignee.trim();
        if (a === '') delete next.assignee;
        else next.assignee = a;
      }
      list[idx] = next;
      break;
    }
    case 'delete': {
      if (idx < 0) return list;
      list.splice(idx, 1);
      break;
    }
    case 'move': {
      if (idx < 0) return list;
      const target = idx + (op.direction === -1 ? -1 : 1);
      if (target < 0 || target >= list.length) return list;
      const [item] = list.splice(idx, 1);
      list.splice(target, 0, item);
      break;
    }
  }

  return list.map((t, i) => ({ ...t, order: i }));
}
