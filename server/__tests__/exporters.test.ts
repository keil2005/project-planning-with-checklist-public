/**
 * server · 导出层测试（覆盖任务 d：MSPDI XML + CSV）。
 * 运行：npx vitest run server/__tests__/exporters.test.ts
 *
 * 口径：所有用例显式注入 WEEKEND_ONLY 夹具（仅周六日非工作、无节假日），
 * 使调度与导出断言均不受 2026 节假日数据变动影响、结果确定。基准日 2026-08-26 = 周三。
 */
import { describe, expect, it } from 'vitest';
import { createEmptyTask, normalizePlan, schedule } from '../../shared/scheduler';
import { SCHEMA_VERSION, type Plan, type Task } from '../../shared/types';
import { WEEKEND_ONLY, CAL_2026 } from '../../shared/__tests__/calendar.test';
import {
  depTypeToLinkType,
  exportFileName,
  lagToTenthMinutes,
  toCsv,
  toMsProjectXml,
} from '../exporters';

function makePlan(tasks: Task[], anchorDate = '2026-08-26'): Plan {
  return normalizePlan({
    schemaVersion: SCHEMA_VERSION,
    planId: 'p-export',
    name: '导出测试计划',
    version: 3,
    createdAt: '2026-08-26T00:00:00.000Z',
    updatedAt: '2026-08-26T00:00:00.000Z',
    updatedBy: 'Alice',
    nextTaskSeq: tasks.length + 1,
    calendar: { mode: 'NATURAL', anchorDate, defaultDuration: '1d', holidays: [] },
    tasks,
  });
}

function task(id: string, name: string, patch: Partial<Task> = {}): Task {
  return { ...createEmptyTask(id, 0, null, name), ...patch };
}

/** 构造一个含 4 种依赖类型的计划，前置均为 T-0001（注入 WEEKEND_ONLY 调度） */
function buildPlan(): Plan {
  const pred = task('T-0001', '前置', { input: { start: '2026-08-26', end: null, duration: '5d' } });
  const fs = task('T-0002', 'FS任务', {
    input: { start: '2026-08-26', end: null, duration: '3d' },
    deps: [{ predecessorId: 'T-0001', type: 'FS', lag: null, lagSign: 1, raw: '1FS' }],
  });
  const ss = task('T-0003', 'SS任务', {
    input: { start: '2026-08-26', end: null, duration: '3d' },
    deps: [{ predecessorId: 'T-0001', type: 'SS', lag: null, lagSign: 1, raw: '1SS' }],
  });
  const ff = task('T-0004', 'FF任务', {
    input: { start: null, end: null, duration: '3d' },
    deps: [{ predecessorId: 'T-0001', type: 'FF', lag: { value: 1, unit: 'w' }, lagSign: 1, raw: '1FF+1w' }],
  });
  const sf = task('T-0005', 'SF任务', {
    input: { start: null, end: null, duration: '3d' },
    deps: [{ predecessorId: 'T-0001', type: 'SF', lag: { value: 3, unit: 'd' }, lagSign: -1, raw: '1SF-3d' }],
  });
  return makePlan([pred, fs, ss, ff, sf]);
}

/** 抽取某 DayType 对应的 DayWorking 值（周一=2…周日=1…周六=7） */
function dayWorkingOf(xml: string, dayType: number): string {
  const re = new RegExp(
    `<WeekDay>[\\s\\S]*?<DayType>${dayType}<\\/DayType>[\\s\\S]*?<DayWorking>(\\d)<\\/DayWorking>`,
  );
  const m = xml.match(re);
  return m ? m[1] : '';
}

describe('d·exporters · MSPDI XML（注入 WEEKEND_ONLY）', () => {
  const plan = buildPlan();
  const sched = schedule(plan, { calendar: WEEKEND_ONLY });
  const xml = toMsProjectXml(plan, sched, WEEKEND_ONLY);

  it('含周一~周五工作8h + 周末非工作的真实工作日历', () => {
    expect(xml).not.toContain('Natural(7x8h)');
    expect(xml).toContain('WorkCalendar(5d×8h)');
    const weekDays = xml.match(/<WeekDay>/g) ?? [];
    expect(weekDays).toHaveLength(7);
    expect(dayWorkingOf(xml, 1)).toBe('0'); // 周日非工作
    expect(dayWorkingOf(xml, 2)).toBe('1'); // 周一~周五工作
    expect(dayWorkingOf(xml, 3)).toBe('1');
    expect(dayWorkingOf(xml, 4)).toBe('1');
    expect(dayWorkingOf(xml, 5)).toBe('1');
    expect(dayWorkingOf(xml, 6)).toBe('1');
    expect(dayWorkingOf(xml, 7)).toBe('0'); // 周六非工作
    expect(xml).toContain('<FromTime>08:00:00</FromTime>');
    expect(xml).toContain('<ToTime>16:00:00</ToTime>');
  });

  it('含 Start / Finish / Duration / PredecessorLink 元素', () => {
    expect(xml).toContain('<Start>');
    expect(xml).toContain('<Finish>');
    expect(xml).toContain('<Duration>');
    expect(xml).toContain('<PredecessorLink>');
  });

  it('依赖类型映射 FF=0 / FS=1 / SF=2 / SS=3', () => {
    expect(depTypeToLinkType('FF')).toBe(0);
    expect(depTypeToLinkType('FS')).toBe(1);
    expect(depTypeToLinkType('SF')).toBe(2);
    expect(depTypeToLinkType('SS')).toBe(3);
    const types = xml.match(/<Type>(\d)<\/Type>/g) ?? [];
    expect(types).toContain('<Type>0</Type>');
    expect(types).toContain('<Type>1</Type>');
    expect(types).toContain('<Type>2</Type>');
    expect(types).toContain('<Type>3</Type>');
  });

  it('LinkLag 工作日口径（FF+1w 锚点09-02→28800，SF-3d 锚点08-26→-9600，2026-09-07 端点式）', () => {
    // 锚点 pred.end = 2026-09-02（周三，WEEKEND_ONLY 调度得出）；+1w = 5 工作日跨 6 自然日 → 6×480×10
    expect(lagToTenthMinutes({ value: 1, unit: 'w' }, 1, '2026-09-02', WEEKEND_ONLY)).toBe(28800);
    // 锚点 pred.start = 2026-08-26（周三）；-3d = 倒数 3 个工作日跨 2 自然日 → −2×480×10
    expect(lagToTenthMinutes({ value: 3, unit: 'd' }, -1, '2026-08-26', WEEKEND_ONLY)).toBe(-9600);
    expect(xml).toContain('<LinkLag>28800</LinkLag>');
    expect(xml).toContain('<LinkLag>-9600</LinkLag>');
  });

  it('Duration 以工作日计（5 工作日 → PT40H0M0S）', () => {
    expect(xml).toContain('PT40H0M0S');
  });

  it('Finish 为 end−1day@16:00（pred.end 现为 09-02 → 09-01T16:00:00）', () => {
    expect(xml).toContain('2026-09-01T16:00:00');
    // Start 为 start@08:00（保持不变）
    expect(xml).toContain('2026-08-26T08:00:00');
  });

  it('父任务 Summary=1 / OutlineLevel 按 depth+1', () => {
    const plan2 = makePlan([
      task('T-0001', '父', { input: { start: '2026-08-26', end: null, duration: '5d' } }),
      task('T-0002', '子', { parentId: 'T-0001', input: { start: '2026-08-26', end: null, duration: '2d' } }),
    ]);
    const x2 = toMsProjectXml(plan2, schedule(plan2, { calendar: WEEKEND_ONLY }), WEEKEND_ONLY);
    expect(x2).toContain('<Summary>1</Summary>'); // 父
    expect(x2).toContain('<OutlineLevel>1</OutlineLevel>');
    expect(x2).toContain('<OutlineLevel>2</OutlineLevel>');
  });
});

describe('d·exporters · 例外边界（注入 WEEKEND_ONLY）', () => {
  it('WEEKEND_ONLY 不应产生任何节假日/补班例外', () => {
    const plan = buildPlan();
    const sched = schedule(plan, { calendar: WEEKEND_ONLY });
    const xml = toMsProjectXml(plan, sched, WEEKEND_ONLY);
    expect(xml).not.toContain('<TimePeriodFrom>');
    expect(xml).not.toContain('<Exception>');
  });
});

describe('d·exporters · 工作日历例外（注入 CAL_2026）', () => {
  it('导出含国庆非工作 Exception 与补班工作 Exception（带 WorkingTimes）', () => {
    const plan = makePlan([
      task('T-0001', '十月任务', { input: { start: '2026-10-01', end: null, duration: '2w' } }),
    ]);
    const sched = schedule(plan, { calendar: CAL_2026 });
    const xml = toMsProjectXml(plan, sched, CAL_2026);
    // 国庆非工作例外（2026-10-01）
    expect(xml).toContain('2026-10-01T00:00:00');
    expect(xml).toContain('2026-10-01T23:59:00');
    // 补班工作例外（2026-10-10，带 WorkingTimes，DayWorking=1）
    expect(xml).toContain('2026-10-10T00:00:00');
    expect(xml).toContain('2026-10-10T23:59:00');
    expect(xml).toMatch(/<Exception>[\s\S]*2026-10-10[\s\S]*<WorkingTimes>/);
    expect(xml).toMatch(/2026-10-10[\s\S]*?<DayWorking>1<\/DayWorking>/);
  });
});

describe('d·exporters · CSV', () => {
  const plan = buildPlan();
  const csv = toCsv(plan, schedule(plan, { calendar: WEEKEND_ONLY }));

  it('带 UTF-8 BOM', () => {
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.startsWith('﻿')).toBe(true);
  });

  it('含表头与任务名（中文）、依赖表达式、来源', () => {
    expect(csv).toContain('行号,任务ID,层级,任务名称(缩进),父任务ID,开始,结束,时长,依赖,负责人,顾问人,TODO 进度,来源,备注');
    expect(csv).toContain('前置');
    expect(csv).toContain('1FS'); // 依赖表达式
    expect(csv).toContain('DEP'); // 来源列
  });

  it('文件名 {name}-v{version}.xml/csv', () => {
    expect(exportFileName(plan, 'mspdi')).toBe('导出测试计划-v3.xml');
    expect(exportFileName(plan, 'csv')).toBe('导出测试计划-v3.csv');
  });
});

describe('d·exporters · TODO 交付清单导出', () => {
  const todoTask = () =>
    task('T-0001', '交付任务', {
      input: { start: '2026-08-26', end: null, duration: '5d' },
      owner: ['User01'],
      todos: [
        { id: 'td1', text: '出原理图', done: true, order: 0 },
        { id: 'td2', text: '出BOM', done: false, order: 1, assignee: '张三' },
        { id: 'td3', text: '过安规', done: false, order: 2 },
      ],
    });

  it('MSPDI Notes 含 TODO 摘要（x/y + [x]/[ ] + assignee）；assignee 经一致性规则并入负责人成为 Resource', () => {
    const plan = makePlan([todoTask()]);
    const xml = toMsProjectXml(plan, schedule(plan, { calendar: WEEKEND_ONLY }), WEEKEND_ONLY);
    expect(xml).toContain('TODO（1/3）：');
    expect(xml).toContain('[x] 出原理图');
    expect(xml).toContain('[ ] 出BOM（张三）');
    expect(xml).toContain('[ ] 过安规');
    // todo.assignee「张三」被 normalizePlan 单向并入 owner → 作为资源导出（负责人口径一致）；
    // 这是预期行为：assignee 经一致性不变量成为负责人，而非 todo 直接生成资源。
    const resources = [...xml.matchAll(/<Resources>[\s\S]*?<\/Resources>/g)].map((m) => m[0]).join('');
    expect(resources).toContain('<Name>User01</Name>');
    expect(resources).toContain('<Name>张三</Name>');
  });

  it('无 todo 时 Notes 不含 TODO 摘要', () => {
    const plan = makePlan([task('T-0001', '无todo', { input: { start: '2026-08-26', end: null, duration: '5d' } })]);
    const xml = toMsProjectXml(plan, schedule(plan, { calendar: WEEKEND_ONLY }), WEEKEND_ONLY);
    expect(xml).not.toContain('TODO（');
  });

  it('CSV 含「TODO 进度」列：有项显示 x/y，无项留空', () => {
    const plan = makePlan([
      todoTask(),
      task('T-0002', '无todo', { input: { start: '2026-08-31', end: null, duration: '3d' } }),
    ]);
    const csv = toCsv(plan, schedule(plan, { calendar: WEEKEND_ONLY }));
    const header = csv.replace(/^\uFEFF/, '').split('\r\n')[0];
    expect(header).toContain('TODO 进度');
    expect(csv).toContain('1/3');
    // 无 todo 的任务行：TODO 进度列留空（其前后为「顾问人」空列与「来源」列）
    const noTodoLine = csv.split('\r\n').find((l) => l.includes('无todo'));
    expect(noTodoLine).toBeDefined();
    expect(noTodoLine).not.toContain('1/3');
  });
});
