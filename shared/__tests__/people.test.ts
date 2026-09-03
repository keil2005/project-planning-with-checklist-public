/**
 * shared/__tests__/people.test.ts —— 人员字段归一化 / 格式化。
 *
 * 覆盖点：
 *  - normalizePeople：字符串迁移、数组透传、脏数据降级、trim / 去空 / 大小写不敏感去重 / 保持顺序；
 *  - formatPeople：顿号拼接、空数组 → 空串、自定义分隔符；
 *  - peopleOf / collectPeople：字段取值与两列合并。
 */
import { describe, expect, it } from 'vitest';
import { collectPeople, formatPeople, normalizePeople, peopleOf, PEOPLE_SEP } from '../people';

describe('normalizePeople：字符串 → 数组（历史数据迁移）', () => {
  it('单人字符串原样迁移', () => {
    expect(normalizePeople('User01')).toEqual(['User01']);
  });

  it('空串 / 纯空白 → 空数组', () => {
    expect(normalizePeople('')).toEqual([]);
    expect(normalizePeople('   ')).toEqual([]);
  });

  it('手打的多人字符串按分隔符拆开（中英文逗号 / 顿号 / 分号 / 竖线 / 斜杠）', () => {
    expect(normalizePeople('User01,User13')).toEqual(['User01', 'User13']);
    expect(normalizePeople('User01，User13')).toEqual(['User01', 'User13']);
    expect(normalizePeople('User01、User13')).toEqual(['User01', 'User13']);
    expect(normalizePeople('User01;User13')).toEqual(['User01', 'User13']);
    expect(normalizePeople('User01；User13')).toEqual(['User01', 'User13']);
    expect(normalizePeople('User01|User13')).toEqual(['User01', 'User13']);
    expect(normalizePeople('User01/User13')).toEqual(['User01', 'User13']);
  });

  it('含空格的姓名不被拆开（Group A 必须保持一个整体）', () => {
    expect(normalizePeople('Group A')).toEqual(['Group A']);
    expect(normalizePeople('Group A,User01')).toEqual(['Group A', 'User01']);
  });
});

describe('normalizePeople：数组透传与清洗', () => {
  it('正常数组原样返回（顺序保持）', () => {
    expect(normalizePeople(['User01', 'User13', 'User02'])).toEqual(['User01', 'User13', 'User02']);
  });

  it('trim 每个元素、丢弃空项', () => {
    expect(normalizePeople([' User01 ', '  ', '', 'User13'])).toEqual(['User01', 'User13']);
  });

  it('大小写不敏感去重，保留首次出现的原始写法', () => {
    expect(normalizePeople(['User01', 'user01', 'USER01'])).toEqual(['User01']);
    expect(normalizePeople(['user01', 'User01'])).toEqual(['user01']);
  });

  it('数组元素里含逗号也会继续拆（粘贴 CSV 场景）', () => {
    expect(normalizePeople(['User01,User13', 'User02'])).toEqual(['User01', 'User13', 'User02']);
  });
});

describe('normalizePeople：脏数据一律降级为空数组，不抛错', () => {
  it('null / undefined / 数字 / 对象 / 布尔', () => {
    expect(normalizePeople(null)).toEqual([]);
    expect(normalizePeople(undefined)).toEqual([]);
    expect(normalizePeople(123)).toEqual([]);
    expect(normalizePeople({ a: 1 })).toEqual([]);
    expect(normalizePeople(true)).toEqual([]);
  });

  it('数组里混非字符串元素时跳过该项，不牵连其它项', () => {
    expect(normalizePeople(['User01', 42, null, 'User13'] as unknown[])).toEqual(['User01', 'User13']);
  });
});

describe('formatPeople', () => {
  it('默认用顿号拼接', () => {
    expect(formatPeople(['User01', 'User13'])).toBe(`User01${PEOPLE_SEP}User13`);
  });

  it('空数组 / undefined → 空串', () => {
    expect(formatPeople([])).toBe('');
    expect(formatPeople(undefined)).toBe('');
  });

  it('单人就是名字本身', () => {
    expect(formatPeople(['User01'])).toBe('User01');
  });

  it('支持自定义分隔符', () => {
    expect(formatPeople(['User01', 'User13'], ', ')).toBe('User01, User13');
  });
});

describe('peopleOf / collectPeople', () => {
  const task = { owner: ['User01', 'User13'], consultant: ['User02'] };

  it('peopleOf 按字段取值，且对脏数据安全', () => {
    expect(peopleOf(task, 'owner')).toEqual(['User01', 'User13']);
    expect(peopleOf(task, 'consultant')).toEqual(['User02']);
    expect(peopleOf({ owner: 'User01' }, 'owner')).toEqual(['User01']);
    expect(peopleOf(undefined, 'owner')).toEqual([]);
  });

  it('collectPeople 合并两列并去重', () => {
    expect(collectPeople({ owner: ['User01'], consultant: ['user01', 'User02'] })).toEqual(['User01', 'User02']);
    expect(collectPeople({ owner: [], consultant: [] })).toEqual([]);
  });
});
