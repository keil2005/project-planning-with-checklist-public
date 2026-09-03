/**
 * U03 增量测试 · 列筛选与「Assign to me」的纯函数层。
 *
 * 纯 Node 环境：computeKeepIds / taskMatches 都是无副作用的纯函数，
 * 不触达 DOM，也不依赖 store，直接喂 Task[] 断言返回的保留集合。
 *
 * 另有一组「折叠优先」用例，覆盖过滤与折叠叠加时的语义（折叠是用户显式意图，优先于筛选）。
 */
import { describe, expect, it } from 'vitest';
import {
  buildIdSeqMaps,
  computeVisibleTasks,
  createEmptyTask,
  normalizePlan,
} from '../../shared/scheduler';
import { SCHEMA_VERSION, type Task } from '../../shared/types';
import {
  EMPTY_FILTER,
  activeColumnKeys,
  collectColumnValues,
  computeKeepIds,
  describeColumnFilter,
  isFilterActive,
  isMine,
  type FilterContext,
  type FilterState,
} from '../filter';
import { COLUMNS } from '../columns';

/**
 * 测试用树：
 *   1 阶段一（父，无人员）
 *     2 设计（owner User01）
 *     3 评审（owner User13，consultant User01）
 *   4 阶段二（父，无人员）
 *     5 采购（owner User05）
 *     6 试产（无人员）
 */
function makeTasks(): Task[] {
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

  return normalizePlan({
    schemaVersion: SCHEMA_VERSION,
    planId: 'p-filter',
    name: 'filter 测试',
    version: 1,
    createdAt: '2026-09-03T00:00:00.000Z',
    updatedAt: '2026-09-03T00:00:00.000Z',
    updatedBy: 'User01',
    nextTaskSeq: 7,
    calendar: { mode: 'WORKWEEK5', anchorDate: '2026-09-01', defaultDuration: '1d' },
    tasks: [t1, t2, t3, t4, t5, t6],
  }).tasks;
}

const ids = (keep: Set<string> | null): string[] => (keep ? [...keep].sort() : []);

function ctx(tasks: Task[], me: string | null = 'User01'): FilterContext {
  return { computed: {}, idToSeq: buildIdSeqMaps(tasks).idToSeq, me };
}

function keepOf(f: FilterState, tasks: Task[], me: string | null = 'User01'): string[] {
  return ids(computeKeepIds(tasks, f, ctx(tasks, me)));
}

/** 折叠 + 过滤后的可见行序号（1-based，即 task.seq） */
function visibleSeqs(f: FilterState, tasks: Task[], me: string | null = 'User01'): number[] {
  const keep = computeKeepIds(tasks, f, ctx(tasks, me));
  return computeVisibleTasks(tasks, keep).map((t) => t.seq);
}

describe('U03·筛选纯函数', () => {
  it('无筛选 → computeKeepIds 返回 null（调用方据此跳过过滤）', () => {
    const tasks = makeTasks();
    expect(computeKeepIds(tasks, EMPTY_FILTER, ctx(tasks))).toBeNull();
    expect(visibleSeqs(EMPTY_FILTER, tasks)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('Assign to me：负责人命中 + 顾问人命中，两者都算', () => {
    const tasks = makeTasks();
    // T-0002 负责人是 User01；T-0003 顾问人是 User01（负责人是 User13）→ 两条都要命中
    expect(keepOf({ byColumn: {}, onlyMine: true }, tasks)).toEqual(['T-0001', 'T-0002', 'T-0003']);
  });

  it('Assign to me：大小写与首尾空格不敏感', () => {
    const tasks = makeTasks();
    expect(isMine(tasks[1], 'user01')).toBe(true);
    expect(isMine(tasks[1], ' USER01 ')).toBe(true);
    expect(isMine(tasks[4], 'user01')).toBe(false); // User05
    expect(keepOf({ byColumn: {}, onlyMine: true }, tasks, 'uSeR01')).toEqual(['T-0001', 'T-0002', 'T-0003']);
  });

  it('Assign to me：未选身份时命中为空（UI 上按钮已禁用，这里兜底）', () => {
    const tasks = makeTasks();
    expect(keepOf({ byColumn: {}, onlyMine: true }, tasks, null)).toEqual([]);
    expect(keepOf({ byColumn: {}, onlyMine: true }, tasks, '  ')).toEqual([]);
  });

  it('祖先链：命中子任务时，其所有祖先一并保留（保持 WBS 上下文）', () => {
    const tasks = makeTasks();
    // 只勾 User05（第 5 行）→ 父任务「阶段二」(4) 也要出现
    const f: FilterState = { byColumn: { owner: { kind: 'enum', values: ['User05'], blanks: false } }, onlyMine: false };
    expect(keepOf(f, tasks)).toEqual(['T-0004', 'T-0005']);
    expect(visibleSeqs(f, tasks)).toEqual([4, 5]);
  });

  it('枚举筛选（负责人）：未勾选的值所在行被过滤，空值由 blanks 开关控制', () => {
    const tasks = makeTasks();
    const withBlank: FilterState = {
      byColumn: { owner: { kind: 'enum', values: ['User01'], blanks: true } },
      onlyMine: false,
    };
    // User01 行(2) + 全部空值行：1、4、6 → 加祖先（1 已在、4 已在）
    expect(visibleSeqs(withBlank, tasks)).toEqual([1, 2, 4, 6]);

    const noBlank: FilterState = {
      byColumn: { owner: { kind: 'enum', values: ['User01'], blanks: false } },
      onlyMine: false,
    };
    expect(visibleSeqs(noBlank, tasks)).toEqual([1, 2]);
  });

  it('枚举筛选（人员列）：任一人命中即命中（多值列的 OR 语义）', () => {
    const tasks = makeTasks();
    const t = createEmptyTask('T-0009', 9, null, '多人任务');
    t.owner = ['User01', 'User05'];
    const list = [...makeTasks(), t];
    const f: FilterState = {
      byColumn: { owner: { kind: 'enum', values: ['User05'], blanks: false } },
      onlyMine: false,
    };
    const keep = keepOf(f, list);
    expect(keep).toContain('T-0009'); // owner 里含 User05 即命中
  });

  it('文本筛选：包含 / 不包含 / 开头是 / 等于', () => {
    const tasks = makeTasks();
    const mkF = (op: 'contains' | 'notContains' | 'startsWith' | 'equals', value: string): FilterState => ({
      byColumn: { name: { kind: 'text', op, value } },
      onlyMine: false,
    });
    expect(visibleSeqs(mkF('contains', '设计'), tasks)).toEqual([1, 2]);
    // 名称不含「阶段」的是 2/3/5/6，但祖先链会把两个父任务带回来 → 全显示
    expect(visibleSeqs(mkF('notContains', '阶段'), tasks)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(visibleSeqs(mkF('startsWith', '阶段'), tasks)).toEqual([1, 4]);
    expect(visibleSeqs(mkF('equals', '试产'), tasks)).toEqual([4, 6]);
  });

  it('文本筛选：关键词为空 = 该列不约束（点开漏斗还没输入时不能整表消失）', () => {
    const tasks = makeTasks();
    const f: FilterState = { byColumn: { name: { kind: 'text', op: 'contains', value: '  ' } }, onlyMine: false };
    expect(visibleSeqs(f, tasks)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('日期筛选：早于 / 不早于 / 介于（含两端）', () => {
    const tasks = makeTasks();
    const mkF = (op: 'before' | 'onOrAfter' | 'between', from: string, to = ''): FilterState => ({
      byColumn: { start: { kind: 'date', op, from, to } },
      onlyMine: false,
    });
    // 早于 09-08：只有 09-01 的「设计」(2) + 祖先(1)
    expect(visibleSeqs(mkF('before', '2026-09-08'), tasks)).toEqual([1, 2]);
    // 不早于 09-15（含当天）：采购(5)、试产(6) + 祖先(4)
    expect(visibleSeqs(mkF('onOrAfter', '2026-09-15'), tasks)).toEqual([4, 5, 6]);
    // 介于 09-08 ~ 09-20（含两端）：评审(3)、采购(5) + 祖先(1, 4)
    expect(visibleSeqs(mkF('between', '2026-09-08', '2026-09-20'), tasks)).toEqual([1, 3, 4, 5]);
  });

  it('日期筛选：空日期的行不参与（不会因为没日期就一直不显示）', () => {
    const tasks = makeTasks();
    // 阶段一(1)/阶段二(4) 没有 input.start，也不在计算值里 → 不命中，但作为祖先仍保留
    const f: FilterState = {
      byColumn: { start: { kind: 'date', op: 'onOrAfter', from: '2026-09-01', to: '' } },
      onlyMine: false,
    };
    // 命中 2/3/5/6，祖先 1、4 补回 → 全都在（这个用例里祖先链把父任务带回来了）
    expect(visibleSeqs(f, tasks)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('多列条件是与（AND）：两个条件同时满足才显示', () => {
    const tasks = makeTasks();
    const f: FilterState = {
      byColumn: {
        owner: { kind: 'enum', values: ['User01', 'User13'], blanks: false },
        name: { kind: 'text', op: 'contains', value: '评审' },
      },
      onlyMine: false,
    };
    // owner∈{User01,User13} 命中 2、3；name 含「评审」只剩 3 → 加祖先 1
    expect(visibleSeqs(f, tasks)).toEqual([1, 3]);
  });

  it('列筛选与 Assign to me 叠加也是与', () => {
    const tasks = makeTasks();
    const f: FilterState = {
      byColumn: { name: { kind: 'text', op: 'contains', value: '设计' } },
      onlyMine: true,
    };
    // 「设计」(2) 且负责人是 User01 → 命中；祖先 1
    expect(visibleSeqs(f, tasks, 'User01')).toEqual([1, 2]);
    // 换成 User13：设计不是他的，且顾问人也不是 → 一条不剩
    expect(visibleSeqs(f, tasks, 'User13')).toEqual([]);
  });

  it('折叠优先于筛选：折叠父任务后，命中筛选的子孙也不显示', () => {
    const tasks = makeTasks();
    tasks[0].collapsed = true; // 折叠「阶段一」
    const f: FilterState = { byColumn: {}, onlyMine: true };
    // 命中 2、3，但被折叠隐藏；祖先 1 仍显示
    expect(visibleSeqs(f, tasks)).toEqual([1]);
  });

  it('候选值收集：去重、排序，且不含空值', () => {
    const tasks = makeTasks();
    const c = ctx(tasks);
    expect(collectColumnValues(tasks, 'owner', c)).toEqual(['User01', 'User05', 'User13']);
    expect(collectColumnValues(tasks, 'consultant', c)).toEqual(['User01']);
    // 只断言内容集合：中文 localeCompare 的排序结果依赖运行环境的 ICU 数据，
    // 这里用「排序后再比」规避环境差异（排序本身不是本用例要覆盖的点）
    const names = collectColumnValues(tasks, 'name', c);
    expect(names.slice().sort()).toEqual(['采购', '评审', '试产', '设计', '阶段一', '阶段二'].sort());
  });

  it('isFilterActive / activeColumnKeys 只认真正设了条件的列', () => {
    expect(isFilterActive(EMPTY_FILTER)).toBe(false);
    expect(isFilterActive({ byColumn: {}, onlyMine: true })).toBe(true);

    const f: FilterState = {
      byColumn: { consultant: { kind: 'enum', values: ['User01'], blanks: true } },
      onlyMine: false,
    };
    expect(isFilterActive(f)).toBe(true);
    expect(activeColumnKeys(f, COLUMNS.map((c) => c.key))).toEqual(['consultant']);
  });

  it('describeColumnFilter：三类条件的摘要文案', () => {
    expect(describeColumnFilter('owner', { kind: 'enum', values: ['User01', 'User13'], blanks: true }, '负责人')).toBe(
      '负责人：User01、User13 + 空值',
    );
    expect(
      describeColumnFilter('owner', { kind: 'enum', values: ['A', 'B', 'C'], blanks: false }, '负责人'),
    ).toBe('负责人：A、B 等 3 项');
    expect(describeColumnFilter('name', { kind: 'text', op: 'contains', value: '设计' }, '任务名称')).toBe(
      '任务名称：包含「设计」',
    );
    expect(
      describeColumnFilter('start', { kind: 'date', op: 'between', from: '2026-09-01', to: '2026-09-10' }, '开始'),
    ).toBe('开始：2026-09-01 ~ 2026-09-10');
    expect(describeColumnFilter('start', { kind: 'date', op: 'onOrAfter', from: '2026-09-01', to: '' }, '开始')).toBe(
      '开始：不早于 2026-09-01',
    );
  });

  it('脏数据：parentId 自环不会把祖先链遍历卡死', () => {
    const tasks = makeTasks();
    tasks[0].parentId = 'T-0001'; // 自环
    const f: FilterState = { byColumn: {}, onlyMine: true };
    expect(keepOf(f, tasks)).toEqual(['T-0001', 'T-0002', 'T-0003']);
  });
});
