/**
 * src/main.tsx —— React 挂载入口。
 *
 * MUI ThemeProvider + CssBaseline（Tailwind 已关闭 preflight，两者不冲突）。
 *
 * v1.3.1 (2026-09-10) 优雅版：light/dark 双主题切到 indigo 品牌色；
 * 字体接入 Inter（web fallback）；按钮圆角 8px；MuiButton 默认 disableElevation 已开。
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
 *
 * v1.3.1：品牌色从 blue-600 切到 indigo-600（#4f46e5），更柔和现代。
 */
function buildMuiTheme(mode: 'light' | 'dark'): Theme {
  return createTheme({
    palette: {
      mode,
      // light 模式 hex —— indigo 调色板
      ...(mode === 'light' && {
        primary: { main: '#4f46e5', contrastText: '#ffffff' },
        error: { main: '#dc2626' },
        warning: { main: '#d97706' },
        success: { main: '#10b981' },
        background: { default: '#f5f7fb', paper: '#ffffff' },
        text: { primary: '#0f172a', secondary: '#475569', disabled: '#94a3b8' },
        divider: 'rgba(15, 23, 42, 0.08)',
        action: {
          active: '#475569',
          hover: 'rgba(79, 70, 229, 0.06)',
          selected: 'rgba(79, 70, 229, 0.1)',
          disabled: 'rgba(15, 23, 42, 0.26)',
          disabledBackground: 'rgba(15, 23, 42, 0.06)',
          focus: 'rgba(79, 70, 229, 0.12)',
        },
      }),
      // dark 模式 hex —— 与 CSS 变量 [data-theme=dark] 一致
      ...(mode === 'dark' && {
        primary: { main: '#818cf8', contrastText: '#0b1020' },
        error: { main: '#f87171' },
        warning: { main: '#fbbf24' },
        success: { main: '#4ade80' },
        background: { default: '#0b1020', paper: '#1f2937' },
        text: { primary: '#e2e8f0', secondary: '#94a3b8', disabled: '#64748b' },
        divider: 'rgba(226, 232, 240, 0.08)',
        action: {
          active: '#94a3b8',
          hover: 'rgba(129, 140, 248, 0.1)',
          selected: 'rgba(129, 140, 248, 0.2)',
          disabled: 'rgba(148, 163, 184, 0.4)',
          disabledBackground: 'rgba(148, 163, 184, 0.1)',
          focus: 'rgba(129, 140, 248, 0.24)',
        },
      }),
    },
    typography: {
      fontSize: 13,
      fontFamily:
        '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", "PingFang SC", "Microsoft YaHei", Roboto, Helvetica, Arial, sans-serif',
      button: { textTransform: 'none', fontWeight: 500 },
      h1: { fontSize: '1.5rem', fontWeight: 600, letterSpacing: '-0.02em' },
      h2: { fontSize: '1.25rem', fontWeight: 600, letterSpacing: '-0.01em' },
      h3: { fontSize: '1.0625rem', fontWeight: 600 },
      h4: { fontSize: '1rem', fontWeight: 600 },
    },
    shape: {
      borderRadius: 8,
    },
    components: {
      MuiButton: { defaultProps: { size: 'small', disableElevation: true } },
      MuiIconButton: { defaultProps: { size: 'small' } },
      MuiTooltip: { defaultProps: { arrow: true, enterDelay: 300 } },
      MuiTextField: { defaultProps: { size: 'small' } },
      MuiSelect: { defaultProps: { size: 'small' } },
      MuiPaper: {
        styleOverrides: {
          rounded: { borderRadius: 12 },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: { borderRadius: 16 },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: { borderRadius: 6, fontWeight: 500 },
        },
      },
      MuiToggleButton: {
        styleOverrides: {
          root: { borderRadius: 6, textTransform: 'none', padding: '4px 10px' },
        },
      },
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