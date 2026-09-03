// @vitest-environment jsdom
/**
 * src/__tests__/columns.test.ts —— 列宽模块单测（U01）。
 *
 * 用 jsdom：autoFitWidth 测试需要 `Element.prototype.getBoundingClientRect`
 * 做 stub 验证「离屏 → 不做任何改动」降级路径；其他测试在 jsdom 下也能跑。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COLUMNS,
  COL_VAR_NAMES,
  FLEX_COLUMN_INDEX,
  GRID_TEMPLATE_VARS,
  TABLE_MIN_W_VAR,
  autoFitWidth,
  clampWidth,
  columnCssVars,
  defaultWidths,
  gridTemplate,
  loadWidths,
  saveWidths,
  tableMinWidth,
} from '../columns';
import { createEmptyTask } from '../../shared/scheduler';

describe('U01 列宽：COLUMNS 常量结构', () => {
  it('10 列、顺序与 grid 模板一致、key 唯一', () => {
    expect(COLUMNS.length).toBe(10);
    const keys = COLUMNS.map((c) => c.key);
    expect(keys).toEqual(['seq', 'name', 'start', 'end', 'duration', 'deps', 'owner', 'consultant', 'todo', 'actions']);
    expect(new Set(keys).size).toBe(10);
  });

  it('顾问人列紧跟负责人、TODO 列紧跟顾问人、都在操作列之前', () => {
    const keys = COLUMNS.map((c) => c.key);
    expect(keys.indexOf('consultant')).toBe(keys.indexOf('owner') + 1);
    expect(keys.indexOf('todo')).toBe(keys.indexOf('consultant') + 1);
    expect(keys.indexOf('todo')).toBe(keys.indexOf('actions') - 1);
    expect(COLUMNS[keys.indexOf('consultant')].label).toBe('顾问人');
    expect(COLUMNS[keys.indexOf('todo')].label).toBe('TODO');
  });

  it('每列 min ≤ def ≤ max（合法范围）', () => {
    for (const c of COLUMNS) {
      expect(c.min).toBeLessThanOrEqual(c.def);
      expect(c.def).toBeLessThanOrEqual(c.max);
      expect(c.min).toBeGreaterThan(0);
    }
  });

  it('FLEX_COLUMN_INDEX 指向 name（唯一可伸缩列）', () => {
    expect(COLUMNS[FLEX_COLUMN_INDEX].key).toBe('name');
  });
});

describe('U01 列宽：defaultWidths / clampWidth', () => {
  it('defaultWidths() 返回 [def, def, ...]，长度与 COLUMNS 一致', () => {
    const d = defaultWidths();
    expect(d.length).toBe(COLUMNS.length);
    expect(d).toEqual(COLUMNS.map((c) => c.def));
  });

  it('clampWidth 把越界值夹到 [min, max]，并取整', () => {
    expect(clampWidth(0, 999)).toBe(COLUMNS[0].max); // seq max
    expect(clampWidth(0, -1)).toBe(COLUMNS[0].min);
    expect(clampWidth(1, 260.4)).toBe(260);            // name 默认附近 → 260
    expect(clampWidth(1, 260.6)).toBe(261);
  });

  it('clampWidth 非法输入（非数 / NaN / ±Infinity）统一回落到该列默认值', () => {
    expect(clampWidth(2, NaN)).toBe(COLUMNS[2].def);
    expect(clampWidth(2, Number.POSITIVE_INFINITY)).toBe(COLUMNS[2].def);
    expect(clampWidth(2, Number.NEGATIVE_INFINITY)).toBe(COLUMNS[2].def);
  });

  it('clampWidth 索引越界回退到原值（不抛）', () => {
    expect(clampWidth(99, 200)).toBe(200);
    expect(clampWidth(-1, 200)).toBe(200);
  });
});

describe('U01 列宽：gridTemplate / tableMinWidth', () => {
  it('gridTemplate 把 widths 转成 CSS 字符串：flex 列走 minmax，其余 px', () => {
    const ws = defaultWidths();
    const s = gridTemplate(ws);
    // 字符串里包含一个 minmax(Wpx, 1fr) 段
    expect(s).toMatch(/minmax\(\d+px, 1fr\)/);
    expect(s).toContain(`minmax(${ws[FLEX_COLUMN_INDEX]}px, 1fr)`);
    // 其它 7 列各占一个数字 px 段（用 placeholder 替换 minmax 后再切，避免 minmax 内部的逗号/空格干扰）
    const parts = s.replace(/minmax\(\d+px, 1fr\)/, '_FLEX_').split(' ');
    expect(parts.length).toBe(COLUMNS.length);
    for (let i = 0; i < COLUMNS.length; i++) {
      if (i === FLEX_COLUMN_INDEX) continue;
      expect(parts[i]).toBe(`${ws[i]}px`);
    }
  });

  it('tableMinWidth = widths 之和', () => {
    const ws = [40, 120, 84, 84, 60, 80, 90, 110];
    expect(tableMinWidth(ws)).toBe(40 + 120 + 84 + 84 + 60 + 80 + 90 + 110);
    expect(tableMinWidth(defaultWidths())).toBe(COLUMNS.reduce((a, c) => a + c.def, 0));
  });

  it('GRID_TEMPLATE_VARS 是「变量版」grid-template，可独立使用', () => {
    // 不带具体 px，用 var() 引用
    expect(GRID_TEMPLATE_VARS).toContain('var(--col-name)');
    expect(GRID_TEMPLATE_VARS).toContain('var(--col-owner)');
    expect(GRID_TEMPLATE_VARS).not.toMatch(/\d+px/); // 没有任何硬编码 px
  });
});

describe('U01 列宽：columnCssVars / COL_VAR_NAMES / TABLE_MIN_W_VAR', () => {
  it('columnCssVars 输出每个列对应的 px + 表格最小宽度变量', () => {
    const ws = defaultWidths();
    const vars = columnCssVars(ws) as Record<string, string>;
    COLUMNS.forEach((c, i) => {
      expect(vars[`--col-${c.key}`]).toBe(`${ws[i]}px`);
    });
    expect(vars[TABLE_MIN_W_VAR]).toBe(`${tableMinWidth(ws)}px`);
  });

  it('COL_VAR_NAMES 顺序与 COLUMNS 一致', () => {
    expect(COL_VAR_NAMES.length).toBe(COLUMNS.length);
    COL_VAR_NAMES.forEach((v, i) => expect(v).toBe(`--col-${COLUMNS[i].key}`));
  });
});

describe('U01 列宽：loadWidths / saveWidths（localStorage mock）', () => {
  // 用一个简单的内存 store 模拟 localStorage（不依赖 vitest 的 jsdom 环境）
  const store = new Map<string, string>();
  const fakeLS = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  };

  beforeEach(() => {
    store.clear();
    vi.stubGlobal('localStorage', fakeLS);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('saveWidths 后 loadWidths 能完整还原（不丢精度）', () => {
    const widths = [60, 300, 100, 100, 80, 120, 130, 140, 72, 150];
    saveWidths(widths, 'p-A');
    expect(loadWidths('p-A')).toEqual(widths);
  });

  it('落盘形态是按列名的对象，不是按下标的数组', () => {
    const widths = [60, 300, 100, 100, 80, 120, 130, 140, 72, 150];
    saveWidths(widths, 'p-A');
    const raw = store.get('plan-gantt:colw:v3:p-A')!;
    const parsed = JSON.parse(raw) as Record<string, number>;
    expect(Array.isArray(parsed)).toBe(false);
    expect(parsed.name).toBe(300);
    expect(parsed.consultant).toBe(140);
    expect(parsed.actions).toBe(150);
  });

  it('每个计划各存一份，互不干扰（键带 planId）', () => {
    const a = [60, 300, 100, 100, 80, 120, 130, 140, 72, 150];
    const b = [52, 700, 96, 96, 78, 110, 120, 120, 72, 136];
    saveWidths(a, 'p-A');
    saveWidths(b, 'p-B');
    expect(loadWidths('p-A')).toEqual(a);
    expect(loadWidths('p-B')).toEqual(b);
    // 落到了两个不同的键上
    expect(store.has('plan-gantt:colw:v3:p-A')).toBe(true);
    expect(store.has('plan-gantt:colw:v3:p-B')).toBe(true);
  });

  it('未调过宽度的计划不受其它计划影响，回退到默认值', () => {
    saveWidths([60, 300, 100, 100, 80, 120, 130, 140, 72, 150], 'p-A');
    expect(loadWidths('p-C')).toEqual(defaultWidths());
  });

  it('v1 全局键迁移：按下标数组 → 按列名映射，新增的顾问人列取默认而不是被操作列顶替', () => {
    // v1 时代 8 列：[seq, name, start, end, duration, deps, owner, actions]
    const legacy = [52, 465, 96, 96, 78, 101, 120, 136];
    store.set('plan-gantt:column-widths:v1', JSON.stringify(legacy));
    const got = loadWidths('p-A');
    expect(got).toHaveLength(COLUMNS.length);
    // 位置语义正确：actions(最后) 仍是 136，而不是被挪到顾问人列上
    expect(got[0]).toBe(52);
    expect(got[1]).toBe(465);
    expect(got[5]).toBe(101);
    expect(got[6]).toBe(120); // owner
    expect(got[7]).toBe(COLUMNS[7].def); // consultant → 默认 120（不是旧 actions 的 136）
    expect(got[8]).toBe(COLUMNS[8].def); // todo → 默认 72
    expect(got[9]).toBe(136); // actions 仍是 136
  });

  it('v2 本计划键迁移：同样按列名还原，且与 v1 全局值互不影响', () => {
    const legacy = [52, 465, 96, 96, 78, 101, 120, 136];
    store.set('plan-gantt:colw:v2:p-A', JSON.stringify(legacy));
    store.set('plan-gantt:column-widths:v1', JSON.stringify([52, 999, 96, 96, 78, 110, 120, 136]));
    // 本计划有 v2 键 → 优先用它，不看 v1
    expect(loadWidths('p-A')[1]).toBe(465);
    expect(loadWidths('p-A')[9]).toBe(136);
    // 没有 v2 键的计划才吃 v1
    expect(loadWidths('p-B')[1]).toBe(960); // 999 超过 name 的 max=960，被 clamp
  });

  it('迁移只读不写：读历史值不会凭空生成 v3 键', () => {
    store.set('plan-gantt:column-widths:v1', JSON.stringify([52, 465, 96, 96, 78, 101, 120, 136]));
    loadWidths('p-A');
    expect(store.has('plan-gantt:colw:v3:p-A')).toBe(false);
  });

  it('loadWidths 在空存储时回退到默认值', () => {
    expect(loadWidths('p-A')).toEqual(defaultWidths());
  });

  it('按列名存储后，缺失的列取默认、多余的键被忽略', () => {
    // 只存了两列
    store.set('plan-gantt:colw:v3:p-A', JSON.stringify({ name: 400, owner: 200 }));
    const got = loadWidths('p-A');
    expect(got[1]).toBe(400);
    expect(got[6]).toBe(200);
    expect(got[0]).toBe(COLUMNS[0].def);
    expect(got[8]).toBe(COLUMNS[8].def);

    // 多一个不存在的列名 → 忽略，不影响其它
    store.set('plan-gantt:colw:v3:p-A', JSON.stringify({ name: 400, ghost: 777 }));
    expect(loadWidths('p-A')[1]).toBe(400);
    expect(loadWidths('p-A')).toHaveLength(COLUMNS.length);
  });

  it('loadWidths 逐列回落：某列值类型错只影响该列', () => {
    store.set('plan-gantt:colw:v3:p-A', JSON.stringify({ seq: 60, name: 'oops', consultant: null }));
    const got = loadWidths('p-A');
    expect(got[0]).toBe(60);
    expect(got[1]).toBe(COLUMNS[1].def);
    expect(got[7]).toBe(COLUMNS[7].def);
  });

  it('本计划键内容损坏时回退默认值，不会串到 v1 全局值', () => {
    store.set('plan-gantt:colw:v3:p-A', '{ 这不是 JSON');
    store.set('plan-gantt:column-widths:v1', JSON.stringify([52, 465, 96, 96, 78, 101, 120, 136]));
    expect(loadWidths('p-A')).toEqual(defaultWidths());
  });

  it('loadWidths 把越界值 clamp 到合法区间后再还原', () => {
    // 把 name 列塞到 999999（超过 max=960）和 5（低于 min=120）
    store.set('plan-gantt:colw:v3:p-A', JSON.stringify({ name: 999999 }));
    expect(loadWidths('p-A')[1]).toBe(960);

    store.set('plan-gantt:colw:v3:p-A', JSON.stringify({ name: 5 }));
    expect(loadWidths('p-A')[1]).toBe(120);
  });

  it('planId 为空 / undefined 时走 v1 全局键（兼容无计划上下文的调用）', () => {
    const w = [60, 300, 100, 100, 80, 120, 130, 140, 72, 150];
    saveWidths(w, null);
    expect(store.has('plan-gantt:column-widths:v1')).toBe(true);
    expect(loadWidths(null)).toEqual(w);
    expect(loadWidths()).toEqual(w);
  });

  it('localStorage 抛错（隐私模式 / 容量满）时 load/save 不抛、降级到默认值', () => {
    const broken = {
      getItem: () => { throw new Error('SecurityError'); },
      setItem: () => { throw new Error('QuotaExceeded'); },
    };
    vi.stubGlobal('localStorage', broken);
    expect(() => loadWidths('p-A')).not.toThrow();
    expect(loadWidths('p-A')).toEqual(defaultWidths());
    expect(() => saveWidths(defaultWidths(), 'p-A')).not.toThrow();
  });
});

describe('U01 列宽：autoFitWidth（jsdom 下离屏环境降级）', () => {
  // jsdom 默认会给文本元素一个非零宽度（基础 layout 模拟）；
  // 把测量 stub 回 0 就能验证「离屏 → 不做任何改动」的降级路径。
  // 注：必须同时覆盖 HTMLElement 与 Element 两条原型链，jsdom 实际计算在 HTMLElement 上。
  const origHTMLElement = HTMLElement.prototype.getBoundingClientRect;
  const origElement = (globalThis as { Element?: { prototype: { getBoundingClientRect: typeof origHTMLElement } } }).Element?.prototype.getBoundingClientRect;
  beforeEach(() => {
    const zero = () => ({ x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0, toJSON: () => ({}) } as DOMRect);
    HTMLElement.prototype.getBoundingClientRect = zero;
    const El = (globalThis as { Element?: { prototype: { getBoundingClientRect: typeof origHTMLElement } } }).Element;
    if (El) El.prototype.getBoundingClientRect = zero;
  });
  afterEach(() => {
    HTMLElement.prototype.getBoundingClientRect = origHTMLElement;
    const El = (globalThis as { Element?: { prototype: { getBoundingClientRect: typeof origHTMLElement } } }).Element;
    if (El && origElement) El.prototype.getBoundingClientRect = origElement;
  });

  it('离屏环境（getBoundingClientRect → 0）下，autoFitWidth 返回 null（不抛错）', () => {
    // 自检：先确认 stub 真的让任意 span 返回 0
    const probe = document.createElement('span');
    document.body.appendChild(probe);
    probe.textContent = 'hello';
    const w = probe.getBoundingClientRect().width;
    document.body.removeChild(probe);
    expect(w).toBe(0); // 离屏 → 0；非离屏则这里是真实宽度

    const tasks = [createEmptyTask('T-1', 1, null, 'Some Task Name')];
    const got = autoFitWidth(1, {
      tasks,
      depthOf: () => 0,
      isParentOf: () => false,
      depsTextOf: () => '2FS',
    });
    expect(got).toBeNull();
  });

  it('actions 列永远返回 null（不支持自适应）', () => {
    const tasks = [createEmptyTask('T-1', 1, null, 'Some')];
    const got = autoFitWidth(COLUMNS.findIndex((c) => c.key === 'actions'), {
      tasks,
      depthOf: () => 0,
      isParentOf: () => false,
      depsTextOf: () => '',
    });
    expect(got).toBeNull();
  });

  it('空任务列表也不抛（label 宽度为 0 → max 仍 0 → 返回 null）', () => {
    const got = autoFitWidth(1, {
      tasks: [],
      depthOf: () => 0,
      isParentOf: () => false,
      depsTextOf: () => '',
    });
    expect(got).toBeNull();
  });
});

describe('U01 列宽：autoFitWidth（测量可用时的正向计算）', () => {
  // 用确定性 stub 模拟"每个字符 10px"，这样能精确断言计算口径：
  // 最终宽度 = max(表头文字, 各行(装饰宽 + 文字)) + AUTOFIT_PADDING，再 clamp。
  const CHAR_W = 10;
  const origHTMLElement = HTMLElement.prototype.getBoundingClientRect;
  const origElement = (globalThis as { Element?: { prototype: { getBoundingClientRect: typeof origHTMLElement } } }).Element
    ?.prototype.getBoundingClientRect;

  beforeEach(() => {
    const measure = function (this: HTMLElement) {
      const len = (this.textContent ?? '').length;
      const width = len * CHAR_W;
      return { x: 0, y: 0, width, height: 16, top: 0, right: width, bottom: 16, left: 0, toJSON: () => ({}) } as DOMRect;
    };
    HTMLElement.prototype.getBoundingClientRect = measure;
    const El = (globalThis as { Element?: { prototype: { getBoundingClientRect: typeof origHTMLElement } } }).Element;
    if (El) El.prototype.getBoundingClientRect = measure;
  });
  afterEach(() => {
    HTMLElement.prototype.getBoundingClientRect = origHTMLElement;
    const El = (globalThis as { Element?: { prototype: { getBoundingClientRect: typeof origHTMLElement } } }).Element;
    if (El && origElement) El.prototype.getBoundingClientRect = origElement;
  });

  it('name 列：装饰宽（缩进 + 折叠三角）+ 最长任务名 + padding', () => {
    // depth=0、非父任务 → chrome = 0*16 + 18 = 18
    // 任务名 "Some Task Name" 14 字符 → 140；表头 "任务名称" 4 字符 → 40
    // widest = 18 + 140 = 158；+26 padding = 184
    const got = autoFitWidth(1, {
      tasks: [createEmptyTask('T-1', 1, null, 'Some Task Name')],
      depthOf: () => 0,
      isParentOf: () => false,
      depsTextOf: () => '',
    });
    expect(got).toBe(184);
  });

  it('name 列：缩进层级越深，装饰宽越大（depth*16）', () => {
    const got = autoFitWidth(1, {
      tasks: [createEmptyTask('T-1', 1, null, 'Some Task Name')],
      depthOf: () => 2, // chrome = 2*16 + 18 = 50 → 50 + 140 + 26 = 216
      isParentOf: () => false,
      depsTextOf: () => '',
    });
    expect(got).toBe(216);
  });

  it('计算结果会被 clamp 到列的合法区间（deps 列内容极短 → 取 min）', () => {
    const depsIdx = COLUMNS.findIndex((c) => c.key === 'deps');
    const got = autoFitWidth(depsIdx, {
      tasks: [createEmptyTask('T-1', 1, null, 'x')],
      depthOf: () => 0,
      isParentOf: () => false,
      depsTextOf: () => '2FS', // 3 字符 → 30；+26 = 56 < min(80)
    });
    expect(got).toBe(COLUMNS[depsIdx].min);
  });

  it('表头文字也参与取宽（内容全空时不至于塌成 0）', () => {
    const got = autoFitWidth(1, {
      tasks: [createEmptyTask('T-1', 1, null, '')], // 空任务名
      depthOf: () => 0,
      isParentOf: () => false,
      depsTextOf: () => '',
    });
    // 表头 "任务名称" 40 + padding 26 = 66 → clamp 到 min 120
    expect(got).toBe(COLUMNS[1].min);
  });
});