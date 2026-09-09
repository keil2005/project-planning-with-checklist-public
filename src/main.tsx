/**
 * src/main.tsx —— React 挂载入口。
 *
 * MUI ThemeProvider + CssBaseline（Tailwind 已关闭 preflight，两者不冲突）。
 *
 * v1.2.1 (2026-09-08)：light/dark 双主题。MUI palette 跟随 useThemeMode() 切换；
 * CSS 变量在 :root / [data-theme='dark'] 下定义（见 src/index.css）。
 * <html data-theme> 由 src/theme.ts 设置，本文件仅读取 resolved 决定 palette.mode。
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider, createTheme, type Theme } from '@mui/material/styles';
import App from './App';
import './index.css';
import { useThemeMode } from './theme';

/**
 * light / dark 两套 MUI palette，**全部真实 hex**（绝不传 var() 字符串）：
 *   - MUI 内部在 Button/ToggleButton/Chip 等组件里会调
 *     `alpha(theme.palette.primary.main, ...)` → `decomposeColor()`，
 *     `var(--xxx)` 会让它抛 `Unsupported color`，整个根 render 崩、白屏。
 *   - 用 `palette.mode = 'light' | 'dark'` 切换，让 MUI 内置 dark palette
 *     接管 Button / Chip / Menu 等组件视觉；我们自定义的甘特/表格继续读
 *     CSS 变量（[data-theme=dark]）。
 *   - 注：MUI v5.18 的 createTheme 暂不支持 cssVariables:true（GA 在 v6），
 *     所以不再使用该 flag。
 */
function buildMuiTheme(mode: 'light' | 'dark'): Theme {
  return createTheme({
    palette: {
      mode,
      // light 模式 hex
      ...(mode === 'light' && {
        primary: { main: '#2563eb', contrastText: '#ffffff' },
        error: { main: '#dc2626' },
        warning: { main: '#d97706' },
        success: { main: '#16a34a' },
        background: { default: '#ffffff', paper: '#ffffff' },
        text: { primary: '#0f172a', secondary: '#475569', disabled: '#94a3b8' },
        divider: '#e2e8f0',
        action: {
          active: '#475569',
          hover: 'rgba(15, 23, 42, 0.04)',
          selected: 'rgba(37, 99, 235, 0.08)',
          disabled: 'rgba(15, 23, 42, 0.26)',
          disabledBackground: 'rgba(15, 23, 42, 0.12)',
          focus: 'rgba(37, 99, 235, 0.12)',
        },
      }),
      // dark 模式 hex（与 CSS 变量 [data-theme=dark] 一致）
      ...(mode === 'dark' && {
        primary: { main: '#60a5fa', contrastText: '#0f172a' },
        error: { main: '#f87171' },
        warning: { main: '#fbbf24' },
        success: { main: '#4ade80' },
        background: { default: '#0f172a', paper: '#1e293b' },
        text: { primary: '#e2e8f0', secondary: '#94a3b8', disabled: '#64748b' },
        divider: '#334155',
        action: {
          active: '#94a3b8',
          hover: 'rgba(226, 232, 240, 0.08)',
          selected: 'rgba(96, 165, 250, 0.18)',
          disabled: 'rgba(148, 163, 184, 0.4)',
          disabledBackground: 'rgba(148, 163, 184, 0.16)',
          focus: 'rgba(96, 165, 250, 0.2)',
        },
      }),
    },
    typography: {
      fontSize: 13,
      fontFamily:
        '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", Roboto, Helvetica, Arial, sans-serif',
      button: { textTransform: 'none' },
    },
    components: {
      MuiButton: { defaultProps: { size: 'small', disableElevation: true } },
      MuiIconButton: { defaultProps: { size: 'small' } },
      MuiTooltip: { defaultProps: { arrow: true, enterDelay: 300 } },
      MuiTextField: { defaultProps: { size: 'small' } },
      MuiSelect: { defaultProps: { size: 'small' } },
    },
  });
}

function Root(): JSX.Element {
  const { resolved } = useThemeMode();
  const theme = React.useMemo(() => buildMuiTheme(resolved), [resolved]);

  const container = document.getElementById('root');
  if (!container) throw new Error('未找到 #root 挂载点');

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <App />
    </ThemeProvider>
  );
}

const container = document.getElementById('root');
if (!container) {
  throw new Error('未找到 #root 挂载点');
}

ReactDOM.createRoot(container).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
