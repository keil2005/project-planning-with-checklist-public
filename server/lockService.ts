/**
 * server/lockService.ts —— 编辑锁状态机（§2.6）。
 *
 * IDLE ⇄ EDITING(holder, lockToken, lastHeartbeatAt)
 *   acquire(user)        IDLE → EDITING（同一用户幂等复用，支持刷新页面重进）
 *   heartbeat(user,tk)   刷新 lastHeartbeatAt
 *   release(holder,tk)   EDITING → IDLE
 *   sweeper              now - lastHeartbeatAt > timeoutMs → 自动回收
 *
 * 本期为内存锁（Map<planId, LockState>），进程重启即全部释放（U5）。
 * 后续可替换为 FileLockStore，对外接口不变。
 */

import { randomUUID } from 'node:crypto';
import { DomainError, ErrCode, type LockState } from '../shared/types';
import { config, type LockCfg } from './config';

export class LockService {
  private readonly locks = new Map<string, LockState>();
  private sweeper: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly cfg: LockCfg) {}

  /* ------------------------------ 内部 ------------------------------ */

  private idleState(planId: string): LockState {
    return {
      planId,
      status: 'IDLE',
      holder: null,
      lockToken: null,
      since: null,
      lastHeartbeatAt: null,
      expiresAt: null,
    };
  }

  private isExpired(state: LockState, now: number = Date.now()): boolean {
    if (state.status !== 'EDITING') return true;
    if (state.lastHeartbeatAt === null) return true;
    return now - state.lastHeartbeatAt > this.cfg.timeoutMs;
  }

  /** 取当前有效状态（顺带惰性回收已过期的锁） */
  private current(planId: string): LockState {
    const state = this.locks.get(planId);
    if (!state) return this.idleState(planId);
    if (state.status === 'EDITING' && this.isExpired(state)) {
      console.info(`[lock] 惰性回收过期锁 planId=${planId} holder=${state.holder ?? ''}`);
      const idle = this.idleState(planId);
      this.locks.set(planId, idle);
      return idle;
    }
    return state;
  }

  private assertUser(user: unknown): string {
    if (typeof user !== 'string' || user.trim() === '') {
      throw new DomainError(ErrCode.ERR_VALIDATION, '缺少用户身份（user）');
    }
    return user.trim();
  }

  /* ------------------------------ 对外 API ------------------------------ */

  /** 对外可见状态（剔除 lockToken） */
  public status(planId: string): LockState {
    return publicLockState(this.current(planId));
  }

  /** 抢锁；被他人持有 → ERR_LOCK_HELD(2001)，data 带 holder */
  public acquire(planId: string, user: string): LockState {
    const who = this.assertUser(user);
    const now = Date.now();
    const state = this.current(planId);

    if (state.status === 'EDITING' && state.holder !== null && state.holder !== who) {
      throw new DomainError(ErrCode.ERR_LOCK_HELD, `「${state.holder}」正在编辑该计划`, {
        holder: state.holder,
        expiresAt: state.expiresAt,
      });
    }

    // 同一用户：复用并刷新（幂等）
    const reuseToken = state.status === 'EDITING' && state.holder === who && state.lockToken ? state.lockToken : randomUUID();
    const next: LockState = {
      planId,
      status: 'EDITING',
      holder: who,
      lockToken: reuseToken,
      since: state.status === 'EDITING' && state.since !== null ? state.since : now,
      lastHeartbeatAt: now,
      expiresAt: now + this.cfg.timeoutMs,
    };
    this.locks.set(planId, next);
    console.info(`[lock] acquire planId=${planId} holder=${who}`);
    return { ...next };
  }

  /** 心跳续约；token 失效 → ERR_LOCK_LOST(2002) */
  public heartbeat(planId: string, user: string, token: string): LockState {
    const who = this.assertUser(user);
    const state = this.current(planId);
    if (state.status !== 'EDITING' || state.holder !== who || !token || state.lockToken !== token) {
      throw new DomainError(ErrCode.ERR_LOCK_LOST, '编辑权已失效或已被回收，请重新进入编辑模式', {
        holder: state.holder,
        status: state.status,
      });
    }
    const now = Date.now();
    const next: LockState = { ...state, lastHeartbeatAt: now, expiresAt: now + this.cfg.timeoutMs };
    this.locks.set(planId, next);
    return { ...next };
  }

  /** 释放锁；token 不匹配 → ERR_LOCK_LOST(2002) */
  public release(planId: string, user: string, token: string): void {
    const who = this.assertUser(user);
    const state = this.current(planId);
    if (state.status !== 'EDITING') {
      // 已经是 IDLE：视为幂等成功
      this.locks.set(planId, this.idleState(planId));
      return;
    }
    if (state.holder !== who || !token || state.lockToken !== token) {
      throw new DomainError(ErrCode.ERR_LOCK_LOST, '编辑权不属于当前用户或 token 已失效', {
        holder: state.holder,
      });
    }
    this.locks.set(planId, this.idleState(planId));
    console.info(`[lock] release planId=${planId} holder=${who}`);
  }

  /**
   * 写操作前置校验（K11）：
   *   未带 token → ERR_NO_LOCK(2003)
   *   token 失效 / 非持有者 → ERR_LOCK_LOST(2002)
   */
  public assertHolder(planId: string, user: string, token: string | null | undefined): void {
    const who = this.assertUser(user);
    if (!token || typeof token !== 'string') {
      throw new DomainError(ErrCode.ERR_NO_LOCK, '写操作必须先进入编辑模式（缺少 lockToken）');
    }
    const state = this.current(planId);
    if (state.status !== 'EDITING' || state.holder !== who || state.lockToken !== token) {
      throw new DomainError(ErrCode.ERR_LOCK_LOST, '编辑权已失效或已被回收，无法保存', {
        holder: state.holder,
        status: state.status,
      });
    }
  }

  /** 启动定时回收（服务端 setInterval） */
  public startSweeper(intervalMs: number = this.cfg.sweepMs): void {
    if (this.sweeper) return;
    this.sweeper = setInterval(() => this.sweep(), intervalMs);
    if (typeof this.sweeper.unref === 'function') this.sweeper.unref();
    console.info(`[lock] sweeper 已启动，间隔 ${intervalMs}ms，超时 ${this.cfg.timeoutMs}ms`);
  }

  public stopSweeper(): void {
    if (this.sweeper) {
      clearInterval(this.sweeper);
      this.sweeper = null;
    }
  }

  private sweep(): void {
    const now = Date.now();
    for (const [planId, state] of this.locks.entries()) {
      if (state.status === 'EDITING' && this.isExpired(state, now)) {
        console.info(`[lock] sweeper 回收超时锁 planId=${planId} holder=${state.holder ?? ''}`);
        this.locks.set(planId, this.idleState(planId));
      }
    }
  }

  /** 仅测试/诊断用：当前锁快照（已剔除 token） */
  public snapshot(): LockState[] {
    return [...this.locks.values()].map(publicLockState);
  }
}

/** 对外返回时剔除 lockToken（只有 acquire / heartbeat 的持有者可见） */
export function publicLockState(state: LockState): LockState {
  return { ...state, lockToken: null };
}

export const lockService = new LockService(config.lock);
