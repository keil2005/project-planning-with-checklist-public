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
        diagError: '#dc2626',
        diagWarn: '#d97706',
        barLeaf: '#2563eb',
        barParent: '#334155',
        barGhost: '#94a3b8',
      },
      spacing: {
        row: '32px',
      },
    },
  },
  plugins: [],
};
