/**
 * src/main.tsx —— React 挂载入口。
 * MUI ThemeProvider + CssBaseline（Tailwind 已关闭 preflight，两者不冲突）。
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import App from './App';
import './index.css';

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#2563eb' },
    error: { main: '#dc2626' },
    warning: { main: '#d97706' },
    background: { default: '#f8fafc' },
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

const container = document.getElementById('root');
if (!container) {
  throw new Error('未找到 #root 挂载点');
}

ReactDOM.createRoot(container).render(
  <React.StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <App />
    </ThemeProvider>
  </React.StrictMode>,
);
