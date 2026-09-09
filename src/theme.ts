/**
 * src/theme.ts —— 主题模式（light / dark / system）状态管理（2026-09-08 引入）
 *
 * 设计取舍：
 *   - 独立于主 store（避免污染 plan / 协同状态）
 *   - 持久化到 localStorage `pg.theme`，值 'light' | 'dark' | 'system'，非法值兜底 'system'
 *   - 'system' 跟随 OS `prefers-color-scheme`，并通过 matchMedia 监听系统切换
 *   - 通过在 <html data-theme="..."> 上写 attribute 控制 CSS 变量激活
 */

import { useEffect, useState } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';

export type ResolvedTheme = 'light' | 'dark';

const LS_KEY = 'pg.theme';
const HTML_ATTR = 'data-theme';

function readLS(): ThemeMode {
  if (typeof window === 'undefined') return 'system';
  try {
    const v = window.localStorage.getItem(LS_KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
    return 'system';
  } catch {
    return 'system';
  }
}

function writeLS(mode: ThemeMode): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LS_KEY, mode);
  } catch {
    /* 隐私模式静默忽略 */
  }
}

function osPrefersDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** 把当前 mode + 系统偏好 解析成实际生效主题（仅 light / dark），并写 <html data-theme> */
function applyToDOM(mode: ThemeMode): ResolvedTheme {
  const resolved: ResolvedTheme =
    mode === 'system' ? (osPrefersDark() ? 'dark' : 'light') : mode;
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute(HTML_ATTR, resolved);
  }
  return resolved;
}

/* ---- 微 store（避免引入 zustand 顶层开销，这里只需 1 个订阅者） ---- */

type Listener = (mode: ThemeMode, resolved: ResolvedTheme) => void;

class ThemeStore {
  private mode: ThemeMode = readLS();
  private resolved: ResolvedTheme = applyToDOM(this.mode);
  private listeners = new Set<Listener>();
  private mq: MediaQueryList | null = null;
  private mqHandler: ((e: MediaQueryListEvent) => void) | null = null;

  constructor() {
    if (typeof window === 'undefined') return;
    // system 模式：监听 OS 切换（matchMedia 在 jsdom 等环境可能缺失，防御性跳过）
    if (typeof window.matchMedia !== 'function') return;
    this.mq = window.matchMedia('(prefers-color-scheme: dark)');
    this.mqHandler = (): void => {
      if (this.mode === 'system') {
        this.resolved = applyToDOM('system');
        this.emit();
      }
    };
    if (this.mq.addEventListener) {
      this.mq.addEventListener('change', this.mqHandler);
    } else if (this.mq.addListener) {
      // Safari < 14 fallback（WorkBuddy 当前最低 macOS 12，可省；这里保兼容）
      this.mq.addListener(this.mqHandler);
    }
  }

  getMode(): ThemeMode {
    return this.mode;
  }

  getResolved(): ResolvedTheme {
    return this.resolved;
  }

  setMode(next: ThemeMode): void {
    if (next !== 'light' && next !== 'dark' && next !== 'system') return;
    if (next === this.mode) return;
    this.mode = next;
    writeLS(next);
    this.resolved = applyToDOM(next);
    this.emit();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this.mode, this.resolved);
  }
}

/* 全局单例（懒初始化：避免 SSR / 静态预渲染阶段运行） */
let _store: ThemeStore | null = null;
function getStore(): ThemeStore {
  if (!_store) _store = new ThemeStore();
  return _store;
}

/* ---- React hook ---- */

export interface UseThemeModeResult {
  mode: ThemeMode;
  resolved: ResolvedTheme;
  setMode: (m: ThemeMode) => void;
  cycle: () => void;
}

/** 在 React 组件里订阅主题状态。返回 mode（用户选择）、resolved（实际生效）、setMode/cycle */
export function useThemeMode(): UseThemeModeResult {
  const s = getStore();
  const [state, setState] = useState<{ mode: ThemeMode; resolved: ResolvedTheme }>({
    mode: s.getMode(),
    resolved: s.getResolved(),
  });

  useEffect(() => {
    const unsub = s.subscribe((mode, resolved) => setState({ mode, resolved }));
    return unsub;
  }, [s]);

  return {
    mode: state.mode,
    resolved: state.resolved,
    setMode: (m: ThemeMode) => s.setMode(m),
    cycle: () => {
      const cur = s.getMode();
      const next: ThemeMode = cur === 'light' ? 'dark' : cur === 'dark' ? 'system' : 'light';
      s.setMode(next);
    },
  };
}
