import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * 项目根目录：vite 始终从项目根启动（npm run dev），因此 cwd 可靠。
 * 不使用 __dirname / import.meta.url，避免 CJS/ESM 双形态差异。
 */
const projectRoot: string = process.cwd();

/** 从 config/app.config.json 读取后端端口，避免开发代理端口写死两处。 */
function readApiPort(): number {
  const fallback = 3001;
  try {
    const file = path.resolve(projectRoot, 'config/app.config.json');
    if (!fs.existsSync(file)) return fallback;
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { port?: number };
    return typeof raw.port === 'number' && raw.port > 0 ? raw.port : fallback;
  } catch {
    return fallback;
  }
}

const apiPort: number = readApiPort();

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': path.resolve(projectRoot, 'shared'),
      '@': path.resolve(projectRoot, 'src'),
    },
  },
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      '/api': {
        target: `http://localhost:${apiPort}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
});
