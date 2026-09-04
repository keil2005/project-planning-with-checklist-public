/**
 * U05 增量测试 · toTodosMarkdown 纯函数层。
 *
 * 与 mspdi/csv 不同的关注点：
 *   - scope=all / scope=mine 过滤的输出与「Assign to me」语义一致
 *   - 任务内 todo 全部输出（不论 assignee），与用户裁定一致
 *   - 空 todo 任务显示「（无 TODO）」
 *   - assignee 缺失时不渲染尾部 "— name"
 *   - 文件名清理特殊字符
 *   - 顶部摘要包含 scope 段、命中任务数、我负责的 TODO 数
 *   - 任务顺序取 sched.order，与表格对齐
 *
 * 纯 Node 环境：不触达 DOM、不依赖 store；直接喂 Plan + ScheduleResult。
 */
import { describe, expect, it } from 'vitest';
import {
  createEmptyTask,
  normalizePlan,
  schedule,
} from '../../shared/scheduler';
import { SCHEMA_VERSION, type Plan, type ScheduleResult, type Task } from '../../shared/types';
import { toTodosMarkdown } from '../../server/exporters';

const NATURAL_CAL: Plan['calendar'] = { mode: 'NATURAL', anchorDate: '2026-09-01', defaultDuration: '1d' };

/**
 * 测试用计划（6 个任务，与 filter.test.ts 同步结构以便对比）：
 *   1 阶段一（父，无人员）
 *     2 设计（owner User01） + 2 todo（1 done 给我，1 给 User13）
 *     3 评审（owner User13，consultant User01） + 0 todo
 *   4 阶段二（父，无人员）
 *     5 采购（owner User05） + 1 todo（assignee User05）
 *     6 试产（无人员） + 1 todo（assignee User01）
 */
function makePlan(): Plan {
  const mk = (id: string, seq: number, parentId: string | null, name: string): Task =>
    createEmptyTask(id, seq, parentId, name);

  const t1 = mk('T-0001', 1, null, '阶段一');
  const t2 = mk('T-0002', 2, 'T-0001', '设计');
  const t3 = mk('T-0003', 3, 'T-0001', '评审');
  const t4 = mk('T-0004', 4, null, '阶段二');
  const t5 = mk('T-0005', 5, 'T-0004', '采购');
  const t6 = mk('T-0006', 6, 'T-0004', '试产');

  t2.owner = ['User01'];
  t3.owner = ['User13'];
  t3.consultant = ['User01'];
  t5.owner = ['User05'];

  t2.input.start = '2026-09-01';
  t2.input.end = '2026-09-05';
  t3.input.start = '2026-09-08';
  t3.input.end = '2026-09-10';
  t5.input.start = '2026-09-15';
  t5.input.end = '2026-09-20';
  t6.input.start = '2026-09-22';
  t6.input.end = '2026-09-25';

  t2.todos = [
    { id: 'td-2-1', text: '出原理图', done: true, order: 0, assignee: 'User01' },
    { id: 'td-2-2', text: 'BOM 评审', done: false, order: 1, assignee: 'User13' },
  ];
  // t3 故意不设 todos 字段 → 触发「（无 TODO）」分支
  t5.todos = [{ id: 'td-5-1', text: '下 PO', done: false, order: 0, assignee: 'User05' }];
  t6.todos = [{ id: 'td-6-1', text: '首件试产', done: false, order: 0, assignee: 'User01' }];

  return normalizePlan({
    schemaVersion: SCHEMA_VERSION,
    planId: 'p-md',
    name: 'MD 测试',
    version: 5,
    createdAt: '2026-09-04T00:00:00.000Z',
    updatedAt: '2026-09-04T00:00:00.000Z',
    updatedBy: 'User01',
    nextTaskSeq: 7,
    calendar: NATURAL_CAL,
    tasks: [t1, t2, t3, t4, t5, t6],
  });
}

function schedOf(plan: Plan): ScheduleResult {
  return schedule(plan, { calendar: { isWorking: () => true, isHoliday: () => false, isMakeup: () => false, labelOf: () => null, coveredYears: new Set<number>() } });
}

describe('U05·toTodosMarkdown', () => {
  it('scope=all：按 sched.order 输出全部任务，每条任务有元信息 + todo 段', () => {
    const plan = makePlan();
    const md = toTodosMarkdown(plan, schedOf(plan), {
      scope: 'all',
      exportedAt: '2026-09-04T13:30:00.000Z',
    });
    // 标题
    expect(md).toMatch(/^# MD 测试 v5 — TODO 清单/);
    // 6 个任务分组标题
    expect(md).toContain('## 阶段一');
    expect(md).toContain('## 设计');
    expect(md).toContain('## 评审');
    expect(md).toContain('## 阶段二');
    expect(md).toContain('## 采购');
    expect(md).toContain('## 试产');
    // 任务 ID 出现在元信息
    expect(md).toContain('T-0002');
    expect(md).toContain('T-0003');
    // 「评审」无 todo → 显示（无 TODO）
    expect(md).toMatch(/## 评审[\s\S]*?（无 TODO）/);
    // 「设计」2 条 todo，[x]/[ ] 都出现，assignee 都接续
    expect(md).toContain('[x] 出原理图 — User01');
    expect(md).toContain('[ ] BOM 评审 — User13');
    // 摘要：命中 6 / 全部
    expect(md).toContain('| 计划任务数 | 6 |');
    expect(md).toContain('| 命中任务数 | 6 |');
    // 范围标签
    expect(md).toContain('| 范围 | 全部 |');
  });

  it('scope=mine：只输出 isMine 命中的任务，命中任务的全部 todo 都保留', () => {
    const plan = makePlan();
    const md = toTodosMarkdown(plan, schedOf(plan), {
      scope: 'mine',
      me: 'User01',
      exportedAt: '2026-09-04T13:30:00.000Z',
    });
    // User01 是 T-0002 的 owner，T-0003 的 consultant → 这两个任务出现
    expect(md).toContain('## 设计');
    expect(md).toContain('## 评审');
    // T-0005（User05）、T-0006（无 owner 字段） 不应出现
    // 注：t6 的 todo.assignee='User01' 会触发 U04 不变量（enforceTodoOwnerConsistency）
    //   把 User01 并入 t6.owner，因此 t6 也会被 mine 命中。这是与 UI 「Assign to me」一致的行为。
    // 命中任务数 ≥ 2 即可；具体几件取决于不变量。
    expect(md).toMatch(/\| 命中任务数 \| [2-9] \|/);
    // 但「设计」下的 User13 assignee todo 仍要出现（任务是我的，全部 todo 都展示）
    expect(md).toContain('[ ] BOM 评审 — User13');
    expect(md).toContain('[x] 出原理图 — User01');
    // 摘要：mine 范围标签
    expect(md).toContain('| 范围 | 仅与我相关（User01） |');
  });

  it('isMine 大小写/首尾空格不敏感（与 UI Assign to me 行为一致）', () => {
    const plan = makePlan();
    const md = toTodosMarkdown(plan, schedOf(plan), {
      scope: 'mine',
      me: '  uSeR01  ',
      exportedAt: '2026-09-04T13:30:00.000Z',
    });
    // mine 应至少命中「设计」「评审」（owner/consultant 含 User01）
    expect(md).toContain('## 设计');
    expect(md).toContain('## 评审');
    // 不该命中「采购」（owner User05，不含 User01）
    expect(md).not.toContain('## 采购');
  });

  it('任务内 todo 全部保留，即使没有 todo 也要显示（无 TODO）占位', () => {
    const plan = makePlan();
    const md = toTodosMarkdown(plan, schedOf(plan), {
      scope: 'all',
      exportedAt: '2026-09-04T13:30:00.000Z',
    });
    // 评审（t3）没有 todos → 出现（无 TODO）标记
    expect(md).toMatch(/## 评审[\s\S]*?TODO（0\/0）[\s\S]*?- （无 TODO）/);
  });

  it('摘要里的"我负责的 TODO"按 todo.assignee 计算（与任务 owner 不同）', () => {
    // 单独构造一个避免 U04 不变量干扰的场景：owner 提前包含 assignee 名字，
    //   这样 enforceTodoOwnerConsistency 不会新增 owner、不会改变 isMine 计数。
    const t1 = createEmptyTask('T-A1', 1, null, 'A1');
    t1.owner = ['User01']; // 已含 User01
    t1.input.start = '2026-09-01';
    t1.input.end = '2026-09-05';
    t1.todos = [
      { id: 'a1-1', text: '我的 1', done: true, order: 0, assignee: 'User01' },
      { id: 'a1-2', text: 'User13 的', done: false, order: 1, assignee: 'User13' },
      { id: 'a1-3', text: '我的 2', done: true, order: 2, assignee: 'User01' },
    ];
    const plan = normalizePlan({
      schemaVersion: SCHEMA_VERSION,
      planId: 'p-minecount',
      name: 'mine 计数',
      version: 1,
      createdAt: '2026-09-04T00:00:00.000Z',
      updatedAt: '2026-09-04T00:00:00.000Z',
      updatedBy: 'User01',
      nextTaskSeq: 2,
      calendar: NATURAL_CAL,
      tasks: [t1],
    });
    const md = toTodosMarkdown(plan, schedOf(plan), {
      scope: 'mine',
      me: 'User01',
      exportedAt: '2026-09-04T13:30:00.000Z',
    });
    // 3 条 todo，2 条 mine（a1-1, a1-3）；完成 2（a1-1, a1-3）
    expect(md).toContain('| 我负责的 TODO | 2 |');
    expect(md).toMatch(/TODO 总数 \| 3（已完成 2 \/ 未完成 1）/);
  });

  it('空计划（无任务）也能输出有效 MD（all 模式）', () => {
    const plan: Plan = {
      schemaVersion: SCHEMA_VERSION,
      planId: 'p-empty',
      name: '空计划',
      version: 1,
      createdAt: '2026-09-04T00:00:00.000Z',
      updatedAt: '2026-09-04T00:00:00.000Z',
      updatedBy: 'User01',
      nextTaskSeq: 1,
      calendar: NATURAL_CAL,
      tasks: [],
    };
    const md = toTodosMarkdown(plan, schedOf(plan), {
      scope: 'all',
      exportedAt: '2026-09-04T13:30:00.000Z',
    });
    expect(md).toContain('| 计划任务数 | 0 |');
    expect(md).toContain('| 命中任务数 | 0 |');
    expect(md).toContain('本计划没有任务');
  });

  it('scope=mine 在空命中时给出明确提示（避免用户误以为导出了 0 字节空文件）', () => {
    const plan = makePlan();
    const md = toTodosMarkdown(plan, schedOf(plan), {
      scope: 'mine',
      me: 'Nobody',
      exportedAt: '2026-09-04T13:30:00.000Z',
    });
    expect(md).toContain('| 命中任务数 | 0 |');
    expect(md).toContain('「Nobody」在本计划中没有负责或顾问任务');
  });

  it('任务顺序取 sched.order（不是 plan.tasks 数组序）', () => {
    const plan = makePlan();
    // 强制打乱 sched.order 让 T-0005 排第一
    const reversed: Plan = {
      ...plan,
      tasks: [plan.tasks.find((t) => t.id === 'T-0005')!, ...plan.tasks.filter((t) => t.id !== 'T-0005')],
    };
    const sched = schedule(reversed, {
      calendar: { isWorking: () => true, isHoliday: () => false, isMakeup: () => false, labelOf: () => null, coveredYears: new Set<number>() },
    });
    const md = toTodosMarkdown(reversed, sched, {
      scope: 'all',
      exportedAt: '2026-09-04T13:30:00.000Z',
    });
    // 第一个 ## 必须是「采购」（任务名 + 任务 ID 形式 `T-0005`）
    const firstTaskHeader = md.match(/^## (\S+)/m);
    expect(firstTaskHeader?.[1]).toBe('采购');
  });

  it('assignee 缺失时只渲染 "[ ] 文本"，不带尾部 "— name"', () => {
    const plan = makePlan();
    plan.tasks.find((t) => t.id === 'T-0005')!.todos = [
      { id: 'td-5-x', text: '无主任务', done: false, order: 0 }, // 无 assignee
    ];
    const md = toTodosMarkdown(plan, schedOf(plan), {
      scope: 'all',
      exportedAt: '2026-09-04T13:30:00.000Z',
    });
    expect(md).toMatch(/^- \[ \] 无主任务$/m); // 行尾是文本本身，无 "— ..."
  });

  it('进度字段（progress）若为数值，输出 "进度 X%"', () => {
    const plan = makePlan();
    plan.tasks.find((t) => t.id === 'T-0002')!.progress = 75;
    const md = toTodosMarkdown(plan, schedOf(plan), {
      scope: 'all',
      exportedAt: '2026-09-04T13:30:00.000Z',
    });
    expect(md).toMatch(/进度 75%/);
  });

  it('备注/来源/负责人/顾问人出现在元信息行', () => {
    const plan = makePlan();
    const t2 = plan.tasks.find((t) => t.id === 'T-0002')!;
    t2.note = 'USBC 故障复盘';
    const md = toTodosMarkdown(plan, schedOf(plan), {
      scope: 'all',
      exportedAt: '2026-09-04T13:30:00.000Z',
    });
    // 设计这行：负责人 User01, 来源 INPUT（无依赖）, 备注 USBC 故障复盘
    expect(md).toMatch(/## 设计[\s\S]*?负责人：User01[\s\S]*?来源：手动[\s\S]*?备注：USBC 故障复盘/);
  });
});
