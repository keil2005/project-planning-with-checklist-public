// @vitest-environment jsdom
/**
 * U02 人员单元格（负责人 / 顾问人）行为回归：
 *  1) 多选连选：下拉不关闭，连续选两人 → 两人都进 store；
 *  2) Esc 关闭编辑器（P0 回归）：MUI useAutocomplete 在 Escape 分支里调了
 *     event.stopPropagation()，挂在包装 div 上的 React onKeyDown 收不到 → 必须走捕获阶段监听；
 *  3) 顾问人与负责人互相独立写入。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { type MutableRefObject } from 'react';
import { createEmptyTask, normalizePlan } from '../../shared/scheduler';
import { NATURAL_CALENDAR, SCHEMA_VERSION, type Plan } from '../../shared/types';
import { useStore } from '../store';
import TaskTable from '../components/TaskTable';

const scrollRef: MutableRefObject<HTMLDivElement | null> = { current: null };

function makePlan(owner: string[] = [], consultant: string[] = []): Plan {
  const t = createEmptyTask('T-0001', 1, null, '任务A');
  t.owner = owner;
  t.consultant = consultant;
  return normalizePlan({
    schemaVersion: SCHEMA_VERSION,
    planId: 'p-people',
    name: 'people cell',
    version: 1,
    createdAt: '2026-08-26T00:00:00.000Z',
    updatedAt: '2026-08-26T00:00:00.000Z',
    updatedBy: 'User01',
    nextTaskSeq: 2,
    calendar: { mode: 'WORKWEEK5', anchorDate: '2026-08-26', defaultDuration: '1d' },
    tasks: [t],
  });
}

function setup(owner: string[] = [], consultant: string[] = []): void {
  useStore.setState({
    session: { user: 'User01', mode: 'EDITING', lockToken: null },
    preview: null,
    plan: makePlan(owner, consultant),
    calendar: NATURAL_CALENDAR,
    diagnostics: [],
    sched: null,
    dirty: false,
    // v1.2.0 起：人员候选来自 workspace members（不再有 BUILTIN_USERS）。
    // 这里直接给一份固定的成员名单作为 autocomplete 候选用。
    users: ['User01', 'User13', 'User02', 'User08', 'User03'],
    workspaces: [
      {
        workspaceId: 'ws-test',
        name: 'test',
        members: [
          { userId: 'u-user01', displayName: 'User01', role: 'owner' },
          { userId: 'u-user13', displayName: 'User13', role: 'editor' },
          { userId: 'u-gu', displayName: 'User02', role: 'editor' },
        ],
        createdBy: 'u-user01',
        createdAt: '2026-08-26T00:00:00.000Z',
      },
    ],
    currentWorkspaceId: 'ws-test',
  } as Partial<ReturnType<typeof useStore.getState>>);
}

/** 等 setTimeout(0) 的 deferred unmount + store 落地 */
async function flush(ms = 30): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

/** 打开某一列的编辑态（用只读态的 title 定位） */
async function openEditor(label: '负责人' | '顾问人'): Promise<HTMLElement> {
  const cell = screen.getByTitle(`点击设置${label}`);
  await act(async () => {
    fireEvent.click(cell);
  });
  return screen.findByPlaceholderText(`输入或选择${label}`);
}

function editors(): number {
  return document.querySelectorAll('.pg-people-editor').length;
}

describe('U02 人员单元格', () => {
  beforeEach(() => {
    setup();
  });
  // 本 test 文件未开 vitest globals，RTL 不会自动 cleanup，必须手动卸载，
  // 否则上一个用例的表格残留在 document 里，getByTitle 会命中多份。
  afterEach(() => {
    cleanup();
  });

  it('多选连选：一次编辑里依次选两人，两人都写入（下拉不因选中而关闭）', async () => {
    await act(async () => {
      render(<TaskTable scrollRef={scrollRef} onScroll={() => {}} />);
    });
    await openEditor('负责人');

    const first = await screen.findByRole('option', { name: /User01/ });
    await act(async () => {
      fireEvent.click(first);
    });
    await flush();

    // 关键：选完第一个人后编辑器仍在（disableCloseOnSelect），才能继续选
    expect(editors()).toBe(1);

    const second = await screen.findByRole('option', { name: /User13/ });
    await act(async () => {
      fireEvent.click(second);
    });
    await flush();

    expect(useStore.getState().plan!.tasks[0].owner).toEqual(['User01', 'User13']);
  });

  it('Esc 关闭编辑器（回归：MUI 在 Escape 上 stopPropagation，冒泡监听收不到）', async () => {
    await act(async () => {
      render(<TaskTable scrollRef={scrollRef} onScroll={() => {}} />);
    });
    const input = await openEditor('负责人');
    expect(editors()).toBe(1);

    // 从输入框派发：捕获阶段先经过 .pg-people-editor 的原生监听
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Escape' });
    });
    await flush();

    expect(editors()).toBe(0);
    // 回到只读态（未选人 → 占位符“—”的容器重新出现）
    expect(screen.getByTitle('点击设置负责人')).toBeTruthy();
    expect(useStore.getState().plan!.tasks[0].owner).toEqual([]);
  });

  it('顾问人独立写入，不影响负责人', async () => {
    setup(['User01'], []);
    await act(async () => {
      render(<TaskTable scrollRef={scrollRef} onScroll={() => {}} />);
    });
    await openEditor('顾问人');

    const opt = await screen.findByRole('option', { name: /User02/ });
    await act(async () => {
      fireEvent.click(opt);
    });
    await flush();

    const t = useStore.getState().plan!.tasks[0];
    expect(t.consultant).toEqual(['User02']);
    expect(t.owner).toEqual(['User01']);
  });
});
