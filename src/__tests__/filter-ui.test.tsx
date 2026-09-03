// @vitest-environment jsdom
/**
 * U03 增量测试 · 筛选的 UI 层。
 *
 * 覆盖：
 *  1) 「Assign to me」开关：点击 → 只显示与我相关的行（含祖先链），再点恢复；
 *  2) 未选择身份时该按钮禁用（避免空身份下整表消失）；
 *  3) 表头漏斗 →  enum 面板取消勾选一个值即时生效，且漏斗高亮；
 *  4) 筛选生效时禁止插入新行（新行会被立刻过滤，看起来像没反应）；
 *  5) 「清除全部」一次性复位。
 *
 * ⚠️ 本仓库未开 vitest globals，RTL 的自动 cleanup 不生效，必须显式 cleanup
 *    （否则上一个用例的表格残留在 document 里，下一个用例 getBy* 命中多份）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { MutableRefObject } from 'react';
import { createEmptyTask, normalizePlan } from '../../shared/scheduler';
import { NATURAL_CALENDAR, SCHEMA_VERSION, type Plan, type Task } from '../../shared/types';
import { useStore } from '../store';
import { EMPTY_FILTER } from '../filter';
import TaskTable from '../components/TaskTable';

const scrollRef: MutableRefObject<HTMLDivElement | null> = { current: null };

/**
 * 树：1 阶段一 / 2 设计(User01) / 3 评审(owner User13, consultant User01) / 4 阶段二 / 5 采购(User05) / 6 试产(无)
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
  return [t1, t2, t3, t4, t5, t6];
}

function setup(user: string | null = 'User01'): void {
  useStore.setState({
    session: { user, mode: 'EDITING', lockToken: null },
    preview: null,
    plan: normalizePlan({
      schemaVersion: SCHEMA_VERSION,
      planId: 'p-filter-ui',
      name: 'filter UI',
      version: 1,
      createdAt: '2026-09-03T00:00:00.000Z',
      updatedAt: '2026-09-03T00:00:00.000Z',
      updatedBy: 'User01',
      nextTaskSeq: 7,
      calendar: { mode: 'WORKWEEK5', anchorDate: '2026-09-01', defaultDuration: '1d' },
      tasks: makeTasks(),
    }) as Plan,
    sched: null,
    calendar: NATURAL_CALENDAR,
    filter: EMPTY_FILTER,
    selectedTaskId: null,
  });
}

/** 数据行数（.pg-row 里最后一个是「新增一行」占位行，要扣掉） */
function dataRows(container: HTMLElement): number {
  return container.querySelectorAll('.pg-row').length - 1;
}

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  setup();
});

describe('U03·筛选 UI', () => {
  it('初始无筛选：6 行全显示，工具条显示「未筛选」', () => {
    const { container } = render(<TaskTable scrollRef={scrollRef} onScroll={() => {}} />);
    expect(dataRows(container)).toBe(6);
    expect(screen.getByText('未筛选')).toBeTruthy();
    expect(screen.getByText(/显示 6 \/ 共 6 行/)).toBeTruthy();
  });

  it('Assign to me：只显示与我相关的行（负责人或顾问人），并保留父任务', () => {
    const { container } = render(<TaskTable scrollRef={scrollRef} onScroll={() => {}} />);

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /Assign to me/ }));
    });

    expect(useStore.getState().filter.onlyMine).toBe(true);
    // User01：设计(2, 负责人) + 评审(3, 顾问人) + 父任务阶段一(1)
    expect(dataRows(container)).toBe(3);
    expect(screen.getByText(/显示 3 \/ 共 6 行/)).toBeTruthy();

    // 再点一次 = 关掉
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /Assign to me/ }));
    });
    expect(useStore.getState().filter.onlyMine).toBe(false);
    expect(dataRows(container)).toBe(6);
  });

  it('未选择身份时 Assign to me 禁用', () => {
    setup(null);
    render(<TaskTable scrollRef={scrollRef} onScroll={() => {}} />);
    const btn = screen.getByRole('button', { name: /Assign to me/ });
    expect(btn.closest('button')?.disabled).toBe(true);
  });

  it('表头漏斗：取消勾选一个值即时生效，漏斗高亮，chips 出现', () => {
    const { container } = render(<TaskTable scrollRef={scrollRef} onScroll={() => {}} />);

    // 表头漏斗顺序：0 任务名称 / 1 开始 / 2 结束 / 3 时长 / 4 依赖 / 5 负责人 / 6 顾问人
    const funnels = container.querySelectorAll('.pg-th-filter');
    expect(funnels.length).toBe(7);

    act(() => {
      fireEvent.click(funnels[5]);
    });

    // 面板里取消勾选 User05（默认全选，点一下即取消）→ 采购行消失
    act(() => {
      fireEvent.click(screen.getByRole('checkbox', { name: 'User05' }));
    });

    const f = useStore.getState().filter;
    expect(f.byColumn.owner).toEqual({ kind: 'enum', values: ['User01', 'User13'], blanks: true });
    // 命中：User01(2)、User13(3) + 空值行 1/4/6 → 5 行（User05 所在行被过滤）
    expect(dataRows(container)).toBe(5);

    // 漏斗高亮 + chips 出现
    expect(container.querySelector('.pg-th-filter--on')).toBeTruthy();
    expect(screen.getByText(/负责人：User01、User13 \+ 空值/)).toBeTruthy();
  });

  it('筛选生效时禁止插入新行（新行会被立刻隐藏，像没反应）', () => {
    const { container } = render(<TaskTable scrollRef={scrollRef} onScroll={() => {}} />);
    expect(screen.getByRole('button', { name: '新增一行' })).toBeTruthy();

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /Assign to me/ }));
    });

    expect((screen.getByRole('button', { name: '新增一行' }) as HTMLButtonElement).disabled).toBe(true);

    // 行内的「插入同级行」同样禁用。
    // ⚠️ 用 aria-label 定位而不是 getByRole / HTML title：
    //    - MUI Tooltip 不渲染 HTML title 属性，而是把文案写成子元素的 aria-label；
    //    - getByRole 在 Popover 打开时会被背景的 aria-hidden 挡住。
    //    另外父任务行第 0 个 button 是折叠三角，别按下标取。
    const addBtn = container.querySelector('.pg-row button[aria-label*="清除筛选"]') as HTMLButtonElement | null;
    expect(addBtn).toBeTruthy();
    expect(addBtn!.disabled).toBe(true);
  });

  it('清除全部：一次性复位列筛选与 Assign to me', () => {
    const { container } = render(<TaskTable scrollRef={scrollRef} onScroll={() => {}} />);

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /Assign to me/ }));
    });
    act(() => {
      fireEvent.click(container.querySelectorAll('.pg-th-filter')[5]);
    });
    act(() => {
      fireEvent.click(screen.getByRole('checkbox', { name: 'User05' }));
    });

    // 必须关掉筛选面板再查工具条：MUI Popover 作为 modal 会给背景元素加 aria-hidden，
    // 之后 getByRole 就找不到背景里的按钮了（getByText 不受影响）。
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    });

    expect(dataRows(container)).toBeLessThan(6);

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /清除全部/ }));
    });

    expect(useStore.getState().filter).toEqual(EMPTY_FILTER);
    expect(dataRows(container)).toBe(6);
    expect(screen.getByText('未筛选')).toBeTruthy();
  });

  it('枚举列勾满 + 含空 = 视为无筛选（漏斗不高亮）', () => {
    const { container } = render(<TaskTable scrollRef={scrollRef} onScroll={() => {}} />);

    act(() => {
      fireEvent.click(container.querySelectorAll('.pg-th-filter')[5]);
    });
    // 取消勾选 → 再勾回来，条件应被删除而不是留下一个"全选"的空条件
    act(() => {
      fireEvent.click(screen.getByRole('checkbox', { name: 'User05' }));
    });
    expect(useStore.getState().filter.byColumn.owner).toBeDefined();
    act(() => {
      fireEvent.click(screen.getByRole('checkbox', { name: 'User05' }));
    });
    expect(useStore.getState().filter.byColumn.owner).toBeUndefined();
    expect(container.querySelector('.pg-th-filter--on')).toBeNull();
    expect(dataRows(container)).toBe(6);
  });
});
