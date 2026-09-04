/**
 * server/index.ts —— 服务入口。
 *
 * - express.json({limit:'20mb'})：单计划全量落盘，body 可能较大
 * - cors()：开发期前端 5173 → 后端 3001（生产同源亦无害）
 * - /api 路由 + 错误中间件
 * - 生产：静态托管 dist + SPA fallback
 * - 启动编辑锁 sweeper，并打印 DATA_DIR 绝对路径
 */

import fs from 'node:fs';
import path from 'node:path';
import cors from 'cors';
import express, { type Request, type Response } from 'express';
import { config } from './config';
import { lockService } from './lockService';
import * as calendarService from './calendarService';
import { createApiRouter, errorMiddleware } from './routes';
import { mppImportStatus } from './mppImport';
import { BUILTIN_USERS } from '../shared/roster';

function createApp(): express.Express {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '20mb' }));

  // 简易访问日志（内部工具，便于排错）
  app.use((req, _res, next) => {
    if (req.path.startsWith('/api')) {
      console.info(`[http] ${req.method} ${req.originalUrl}`);
    }
    next();
  });

  app.use('/api', createApiRouter());

  // 生产：静态托管前端构建产物
  const indexHtml = path.join(config.distDir, 'index.html');
  if (fs.existsSync(indexHtml)) {
    app.use(express.static(config.distDir));
    app.get('*', (req: Request, res: Response, next) => {
      if (req.path.startsWith('/api')) {
        next();
        return;
      }
      res.sendFile(indexHtml);
    });
  } else {
    app.get('/', (_req: Request, res: Response) => {
      res
        .status(200)
        .type('text/plain; charset=utf-8')
        .send('plan-gantt API 已启动。开发模式请访问 Vite 前端（默认 http://localhost:5173）；生产模式请先 npm run build。');
    });
  }

  app.use(errorMiddleware);
  return app;
}

function main(): void {
  const app = createApp();
  lockService.startSweeper(config.lock.sweepMs);

  // 全局工作日历种子化（首次启动落盘内置 2026 日历，幂等）
  const cal = calendarService.seedIfAbsent();
  const makeupCount = (Object.values(cal.makeup) as string[][]).reduce((n, arr) => n + arr.length, 0);
  console.info(
    `[calendar] 已种子化全局工作日历：coveredYears=${JSON.stringify(cal.coveredYears)} 补班日=${makeupCount} version=${cal.version}`,
  );

  app.listen(config.port, () => {
    console.info('──────────────────────────────────────────────');
    console.info(` plan-gantt 服务已启动  v${config.appVersion}`);
    console.info(` 端口     : ${config.port}`);
    console.info(` DATA_DIR : ${config.dataDir}`);
    console.info(` 用户名单 : ${BUILTIN_USERS.length} 人 (系统内置)`);
    console.info(` 锁参数   : timeout=${config.lock.timeoutMs}ms heartbeat=${config.lock.heartbeatMs}ms sweep=${config.lock.sweepMs}ms`);
    console.info(
      config.autoSync.enabled
        ? ` 自动同步 : 已启用 → ${config.autoSync.shareDataDir}（planNames=${config.autoSync.planNames.join(',')}，防抖 ${config.autoSync.debounceMs}ms）`
        : ' 自动同步 : 未启用',
    );
    console.info(` 静态目录 : ${fs.existsSync(path.join(config.distDir, 'index.html')) ? config.distDir : '(未构建，仅 API)'}`);
    // MPP 导入为「按需启用」能力：默认未启用（零依赖部署），此处把原因打印出来，
    // 免得用户看到导入按钮报 501 时无从下手。
    const mpp = mppImportStatus();
    console.info(
      mpp.available
        ? ` MPP 导入 : 已启用 (Java=${mpp.javaPath})`
        : ` MPP 导入 : 未启用 (${mpp.reason}) — ${mpp.hint}`,
    );
    console.info('──────────────────────────────────────────────');
  });

  const shutdown = (signal: string): void => {
    console.info(`[server] 收到 ${signal}，正在退出…`);
    lockService.stopSweeper();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main();

export { createApp };
