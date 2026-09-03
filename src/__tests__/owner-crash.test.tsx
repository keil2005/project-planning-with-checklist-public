// @vitest-environment jsdom
/**
 * 回归测试（P0-A）：渲染 TaskTable → 点击「负责人」单元格 → 选候选，
 * 断言：(1) 不抛渲染期异常（ErrorBoundary 不触发、无 removeChild 类崩溃）；
 *       (2) owner 已写入 store。
 * 这正是用户反馈的"点击负责人后整页闪退、内容被清空"场景。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { type MutableRefObject } from 'react';
import { createEmptyTask, normalizePlan } from '../../shared/scheduler';
import { NATURAL_CALENDAR, SCHEMA_VERSION, type Plan } from '../../shared/types';
import { useStore } from '../store';
import TaskTable from '../components/TaskTable';

function makePlan(): Plan {
  const t = createEmptyTask('T-0001', 1, null, '任务A');
  t.owner = '';
  return normalizePlan({
    schemaVersion: SCHEMA_VERSION,
    planId: 'p-crash',
    name: 'owner crash',
    version: 1,
    createdAt: '2026-08-26T00:00:00.000Z',
    updatedAt: '2026-08-26T00:00:00.000Z',
    updatedBy: 'User01',
    nextTaskSeq: 2,
    calendar: { mode: 'WORKWEEK5', anchorDate: '2026-08-26', defaultDuration: '1d' },
    tasks: [t],
  });
}

describe('P0-A 负责人单元格不闪退', () => {
  beforeEach(() => {
    useStore.setState({
      session: { user: 'User01', mode: 'EDITING', lockToken: null },
      preview: null,
      plan: makePlan(),
      calendar: NATURAL_CALENDAR,
      diagnostics: [],
      sched: null,
      dirty: false,
    });
  });

  it('点击负责人→选候选：不抛错且 owner 写入', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const scrollRef = { current: null } as MutableRefObject<HTMLDivElement | null>;

    await act(async () => {
      render(<TaskTable scrollRef={scrollRef} onScroll={() => {}} />);
    });

    // 进入负责人编辑态
    const cell = screen.getByTitle('点击设置负责人');
    await act(async () => {
      fireEvent.click(cell);
    });

    // Autocomplete 输入框出现
    const input = await screen.findByPlaceholderText('输入或选择负责人');
    await act(async () => {
      fireEvent.change(input, { target: { value: 'User01' } });
    });

    // 选中候选
    const option = await screen.findByRole('option', { name: /User01/ });
    await act(async () => {
      fireEvent.click(option);
    });
    // 等待 deferred unmount（setTimeout 0）+ store 更新
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(useStore.getState().plan!.tasks[0].owner).toBe('User01');
    // 关键：ErrorBoundary 不应被触发（白屏恢复文案不该出现）
    expect(screen.queryByText(/界面出现渲染错误/)).toBeNull();
    // 不应出现 removeChild / 渲染期异常
    const errText = consoleError.mock.calls.map((c) => String(c[0])).join('\n');
    expect(errText).not.toMatch(/removeChild|The above error|Minified React error/);
    consoleError.mockRestore();
  });
});
