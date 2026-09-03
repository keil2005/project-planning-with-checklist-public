/**
 * server · 编辑锁状态机测试（覆盖任务 b）。
 * 直接构造 LockService 实例，避免依赖单例与真实配置。
 * 运行：npm test
 */
import { describe, expect, it } from 'vitest';
import { DomainError, ErrCode, type LockCfgPublic } from '../../shared/types';
import { LockService, publicLockState } from '../lockService';

const CFG: LockCfgPublic = { timeoutMs: 30_000, heartbeatMs: 10_000, sweepMs: 5_000, pollMs: 5_000 };
const CFG_FAST: LockCfgPublic = { timeoutMs: 50, heartbeatMs: 10, sweepMs: 10, pollMs: 10 };

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe('b·编辑锁状态机', () => {
  it('acquire 成功 → EDITING + 持有 token', () => {
    const svc = new LockService(CFG);
    const st = svc.acquire('p1', 'Alice');
    expect(st.status).toBe('EDITING');
    expect(st.holder).toBe('Alice');
    expect(typeof st.lockToken).toBe('string');
    expect(st.lockToken!.length).toBeGreaterThan(0);
    expect(st.expiresAt).toBeGreaterThan(Date.now());
  });

  it('被他人持锁 → 抛 ERR_LOCK_HELD(2001) 且 data.holder', () => {
    const svc = new LockService(CFG);
    svc.acquire('p1', 'Alice');
    try {
      svc.acquire('p1', 'Bob');
      throw new Error('应当抛错但未抛');
    } catch (e) {
      expect(e).toBeInstanceOf(DomainError);
      expect((e as DomainError).code).toBe(ErrCode.ERR_LOCK_HELD);
      expect((e as DomainError).data).toMatchObject({ holder: 'Alice' });
    }
  });

  it('同一用户重复 acquire → 幂等复用 token', () => {
    const svc = new LockService(CFG);
    const t1 = svc.acquire('p1', 'Alice');
    const t2 = svc.acquire('p1', 'Alice');
    expect(t2.lockToken).toBe(t1.lockToken);
    expect(t2.holder).toBe('Alice');
  });

  it('heartbeat 刷新 lastHeartbeatAt / expiresAt', async () => {
    const svc = new LockService(CFG);
    const t1 = svc.acquire('p1', 'Alice');
    const before = t1.lastHeartbeatAt!;
    await sleep(15);
    const t2 = svc.heartbeat('p1', 'Alice', t1.lockToken!);
    expect(t2.lastHeartbeatAt!).toBeGreaterThanOrEqual(before);
    expect(t2.expiresAt).toBeGreaterThan(Date.now());
  });

  it('heartbeat 错误 token / 非 holder → ERR_LOCK_LOST(2002)', () => {
    const svc = new LockService(CFG);
    const t1 = svc.acquire('p1', 'Alice');
    expect(() => svc.heartbeat('p1', 'Alice', 'wrong-token')).toThrowError();
    expect(() => svc.heartbeat('p1', 'Bob', t1.lockToken!)).toThrow();
    try {
      svc.heartbeat('p1', 'Bob', t1.lockToken!);
    } catch (e) {
      expect((e as DomainError).code).toBe(ErrCode.ERR_LOCK_LOST);
    }
  });

  it('超时后惰性自动释放（current/status 返回 IDLE）', async () => {
    const svc = new LockService(CFG_FAST);
    const t1 = svc.acquire('p1', 'Alice');
    await sleep(80); // > timeoutMs(50)
    const st = svc.status('p1');
    expect(st.status).toBe('IDLE');
    expect(st.holder).toBeNull();
    expect(st.lockToken).toBeNull();
    // 超时后写校验应失败
    expect(() => svc.assertHolder('p1', 'Alice', t1.lockToken!)).toThrow();
    try {
      svc.assertHolder('p1', 'Alice', t1.lockToken!);
    } catch (e) {
      expect((e as DomainError).code).toBe(ErrCode.ERR_LOCK_LOST);
    }
  });

  it('standalone sweeper 显式回收', async () => {
    const svc = new LockService({ timeoutMs: 30, sweepMs: 10, heartbeatMs: 10, pollMs: 10 });
    svc.acquire('p1', 'Alice');
    svc.startSweeper(10);
    await sleep(80);
    expect(svc.status('p1').status).toBe('IDLE');
    svc.stopSweeper();
  });

  it('assertHolder 缺 token → ERR_NO_LOCK(2003)', () => {
    const svc = new LockService(CFG);
    svc.acquire('p1', 'Alice');
    try {
      svc.assertHolder('p1', 'Alice', null as unknown as string);
    } catch (e) {
      expect((e as DomainError).code).toBe(ErrCode.ERR_NO_LOCK);
    }
  });

  it('release 正确 token → IDLE；错误 token → 2002', () => {
    const svc = new LockService(CFG);
    const t1 = svc.acquire('p1', 'Alice');
    expect(() => svc.release('p1', 'Alice', 'wrong')).toThrow();
    svc.release('p1', 'Alice', t1.lockToken!);
    expect(svc.status('p1').status).toBe('IDLE');
  });

  it('publicLockState 剔除 lockToken', () => {
    const svc = new LockService(CFG);
    const st = svc.acquire('p1', 'Alice');
    const pub = publicLockState(st);
    expect(pub.lockToken).toBeNull();
    expect(pub.holder).toBe('Alice');
  });

  it('IDLE 状态下 heartbeat 过期 token → 2002', () => {
    const svc = new LockService(CFG);
    try {
      svc.heartbeat('p1', 'Alice', 'ghost');
    } catch (e) {
      expect((e as DomainError).code).toBe(ErrCode.ERR_LOCK_LOST);
    }
  });
});
