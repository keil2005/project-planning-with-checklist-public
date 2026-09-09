/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  // 关闭 preflight，避免覆盖 MUI 的基线样式（见系统设计 §1.2）
  corePlugins: {
    preflight: false,
  },
  theme: {
    extend: {
      colors: {
        // 全部走 CSS 变量（指向 :root / [data-theme='dark'] 双主题 token），
        // 这样 `bg-slate-50` 这类 Tailwind 工具类会随主题切换自动重绘。
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        'surface-2': 'var(--surface-2)',
        primary: {
          DEFAULT: 'var(--primary)',
          hover: 'var(--primary-hover)',
          soft: 'var(--primary-soft)',
        },
        success: 'var(--success)',
        error: 'var(--error)',
        warn: 'var(--warn)',
        border: 'var(--border)',
        'border-strong': 'var(--border-strong)',
        text: 'var(--text)',
        'text-muted': 'var(--text-muted)',
        'text-subtle': 'var(--text-subtle)',
      },
      spacing: {
        row: '32px',
      },
    },
  },
  plugins: [],
};
