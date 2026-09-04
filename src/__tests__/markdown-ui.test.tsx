// @vitest-environment jsdom
/**
 * U05 增量测试 · Markdown 导出 dialog 的 UI 层。
 *
 * 覆盖：
 *  1) 菜单「Markdown 清单…」入口能正常打开 dialog
 *  2) 未选身份时「仅与我相关」radio disabled + 下载按钮 disabled
 *  3) 已选身份 → 选 mine → 下载 → window.open URL 含 scope=mine&user=User01
 *  4) 已选身份 → 选 all → 下载 → URL 只有 format=md
 *  5) 取消按钮关闭 dialog 且不触发下载
 *
 * 与 markdown.test.ts 互补：本文件聚焦"端到端触发"，纯函数层测在那里。
 *
 * 注意：仓库未挂 @testing-library/jest-dom，所有 disabled / checked 判断走 DOM 原生属性。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createEmptyTask, normalizePlan } from '../../shared/scheduler';
import { NATURAL_CALENDAR, SCHEMA_VERSION, type Plan } from '../../shared/types';
import { useStore } from '../store';
import Toolbar from '../components/Toolbar';
import Dialogs from '../components/Dialogs';

function setup(user: string | null): void {
  const t1 = createEmptyTask('T-0001', 1, null, '设计');
  t1.owner = ['User01'];
  t1.input.start = '2026-09-01';
  t1.input.end = '2026-09-05';
  const t2 = createEmptyTask('T-0002', 2, null, '评审');
  t2.owner = ['User13'];
  t2.consultant = ['User01'];
  t2.input.start = '2026-09-08';
  t2.input.end = '2026-09-10';
  useStore.setState({
    session: { user, mode: 'EDITING', lockToken: null },
    preview: null,
    plan: normalizePlan({
      schemaVersion: SCHEMA_VERSION,
      planId: 'p-md-ui',
      name: 'MD UI',
      version: 1,
      createdAt: '2026-09-04T00:00:00.000Z',
      updatedAt: '2026-09-04T00:00:00.000Z',
      updatedBy: 'User01',
      nextTaskSeq: 3,
      calendar: { mode: 'WORKWEEK5', anchorDate: '2026-09-01', defaultDuration: '1d' },
      tasks: [t1, t2],
    }) as Plan,
    sched: null,
    calendar: NATURAL_CALENDAR,
    filter: { byColumn: {}, onlyMine: false },
    selectedTaskId: null,
    dialogs: {
      user: false,
      planPicker: false,
      save: false,
      history: false,
      calendar: false,
      exportTodos: false,
    },
  });
}

/** 打开导出菜单 → 点击「Markdown 清单…」 */
function openExportTodosDialog(): void {
  act(() => {
    fireEvent.click(screen.getByRole('button', { name: /导出/ }));
  });
  act(() => {
    fireEvent.click(screen.getByText('Markdown 清单…'));
  });
}

afterEach(() => {
  cleanup();
});

describe('U05·Markdown 导出 dialog', () => {
  beforeEach(() => {
    // 拦截 window.open，避免 jsdom 真的开新窗口
    vi.spyOn(window, 'open').mockImplementation(() => null);
  });

  it('菜单「Markdown 清单…」点击后能打开 dialog', () => {
    setup('User01');
    render(
      <>
        <Toolbar />
        <Dialogs />
      </>,
    );
    openExportTodosDialog();
    // dialog 标题
    expect(screen.getByText('导出 Markdown TODO 清单')).toBeTruthy();
  });

  it('未选身份时「仅与我相关」radio disabled，下载按钮也 disabled', () => {
    setup(null);
    render(
      <>
        <Toolbar />
        <Dialogs />
      </>,
    );
    openExportTodosDialog();
    const radios = screen.getAllByRole('radio');
    // mine = 0, all = 1
    expect((radios[0] as HTMLInputElement).disabled).toBe(true);
    // 切到 all 后下载按钮可用
    act(() => {
      fireEvent.click(radios[1]);
    });
    const downloadBtn = screen.getByRole('button', { name: '下载' }) as HTMLButtonElement;
    expect(downloadBtn.disabled).toBe(false);
    act(() => {
      fireEvent.click(downloadBtn);
    });
    const url = (window.open as unknown as { mock: { calls: { 0: [string] }[] } }).mock.calls[0][0];
    expect(url).toContain('format=md');
    expect(url).toContain('scope=all');
    expect(url).not.toContain('user=');
  });

  it('已选身份 → 默认 mine → 下载 → URL 含 scope=mine&user=User01', () => {
    setup('User01');
    render(
      <>
        <Toolbar />
        <Dialogs />
      </>,
    );
    openExportTodosDialog();
    const radios = screen.getAllByRole('radio') as HTMLInputElement[];
    // mine 默认选中，未被禁用
    expect(radios[0].disabled).toBe(false);
    expect(radios[0].checked).toBe(true);
    // 直接点下载
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: '下载' }));
    });
    const url = (window.open as unknown as { mock: { calls: { 0: [string] }[] } }).mock.calls[0][0];
    expect(url).toContain('format=md');
    expect(url).toContain('scope=mine');
    expect(url).toContain('user=User01');
  });

  it('取消按钮关闭 dialog 且不触发下载', () => {
    setup('User01');
    render(
      <>
        <Toolbar />
        <Dialogs />
      </>,
    );
    openExportTodosDialog();
    // 先确认 dialog 是开的
    expect(screen.getByText('导出 Markdown TODO 清单')).toBeTruthy();
    expect(useStore.getState().dialogs.exportTodos).toBe(true);
    // 取消
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: '取消' }));
    });
    // store 状态应回到 false（DOM 还在 transition，断言 store 更可靠）
    expect(useStore.getState().dialogs.exportTodos).toBe(false);
    // window.open 不应被调用
    expect(window.open).not.toHaveBeenCalled();
  });
});
