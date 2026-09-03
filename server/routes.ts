/**
 * server/routes.ts —— 路由层（§4.3 全部 14 个端点）。
 *
 * 统一响应体 { code, data, message }（K9）；HTTP 状态码与 code 语义一致。
 * 写端点（PUT /plans/:id、POST /restore）统一流程：
 *   notes 校验(1002) → assertHolder(2002/2003) → baseVersion(3003)
 *   → 服务端权威 schedule() 校验(1001) → 先写 history 再写 plan（K14）
 */

import { Router, type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hasBlockingError, normalizePlan, schedule } from '../shared/scheduler';
import { buildWorkCalendar } from '../shared/calendar-build';
import { BUILTIN_USERS } from '../shared/roster';
import {
  DomainError,
  ErrCode,
  NOTES_MAX_LEN,
  httpStatusOf,
  isDomainError,
  type ApiResp,
  type CalendarConfigData,
  type ExportFormat,
  type HealthInfo,
  type Plan,
  type SavePlanResp,
  type ScheduleResult,
  type TodoItem,
  type TodoOp,
  type WorkCalendar,
} from '../shared/types';
import { config, scheduleOptionsFromConfig } from './config';
import { exportFileName, toCsv, toMsProjectXml } from './exporters';
import { lockService } from './lockService';
import * as calendarService from './calendarService';
import { historyRepo, planRepo, todoRepo } from './storage';
import { importMppFile, mppImportStatus } from './mppImport';

/** 全局工作日历保留资源 id（与 per-plan 锁相互独立，互不阻塞） */
const GLOBAL_CALENDAR = 'GLOBAL_CALENDAR';

/* ------------------------------ 响应包装 ------------------------------ */

function ok<T>(res: Response, data: T, message = 'ok'): void {
  const body: ApiResp<T> = { code: ErrCode.OK, data, message };
  res.status(200).json(body);
}

function fail(res: Response, code: number, message: string, data: unknown = null): void {
  const body: ApiResp<unknown> = { code, data, message };
  res.status(httpStatusOf(code)).json(body);
}

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void> | void;

function asyncHandler(fn: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const r = fn(req, res, next);
      if (r instanceof Promise) r.catch(next);
    } catch (e) {
      next(e);
    }
  };
}

/* ------------------------------ 校验辅助 ------------------------------ */

function requireNotes(raw: unknown): string {
  const notes = typeof raw === 'string' ? raw.trim() : '';
  if (notes === '') {
    throw new DomainError(ErrCode.ERR_NOTES_REQUIRED, '变更纪要（notes）为必填项');
  }
  if (notes.length > NOTES_MAX_LEN) {
    throw new DomainError(ErrCode.ERR_NOTES_REQUIRED, `变更纪要不得超过 ${NOTES_MAX_LEN} 字`);
  }
  return notes;
}

function requireEditor(raw: unknown): string {
  const editor = typeof raw === 'string' ? raw.trim() : '';
  if (editor === '') {
    throw new DomainError(ErrCode.ERR_VALIDATION, '缺少编辑者身份（editor）');
  }
  return editor;
}

function requirePlanExists(planId: string): void {
  if (!planRepo.exists(planId)) {
    throw new DomainError(ErrCode.ERR_PLAN_NOT_FOUND, `计划 ${planId} 不存在`);
  }
}

/** 由全局日历落盘（DATA_DIR/calendar.json）构建真实工作日历；单一真源，绝不走 NATURAL 兜底 */
function buildServerCalendar(): WorkCalendar {
  return buildWorkCalendar(calendarService.readCalendar());
}

/** 用给定工作日历对 plan 做服务端权威重算（K8/K18） */
function schedulePlan(plan: Plan, cal: WorkCalendar): ScheduleResult {
  const opts = scheduleOptionsFromConfig();
  return schedule(plan, {
    anchorDate: plan.calendar?.anchorDate ?? opts.anchorDate,
    defaultDuration: plan.calendar?.defaultDuration ?? opts.defaultDuration,
    calendar: cal,
  });
}

/** 服务端权威重算（K8/K18）：注入全局真实工作日历 */
function authoritativeSchedule(plan: Plan): ScheduleResult {
  return schedulePlan(plan, buildServerCalendar());
}

/** 把 computed 作为缓存写回 tasks（K4：仅缓存，读取后仍会重算） */
function attachComputed(plan: Plan, sched: ScheduleResult): Plan {
  return {
    ...plan,
    tasks: plan.tasks.map((t) => ({ ...t, computed: sched.computed[t.id] })),
  };
}

function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/* ------------------------------ todo 独立资源合并 ------------------------------ */

/**
 * 方案 B（todo 独立并发）：把 todos.json 的最新清单合并回 plan.tasks[].todos，再 normalizePlan。
 * normalizePlan 里的 enforceTodoOwnerConsistency 会把最新 assignee 单向并入 owner，
 * 从而让「todo.assignee 自动并入负责人」在读取路径即时生效（无需写 plan.json）。
 */
function mergeTodos(plan: Plan, byTask: Record<string, unknown>): Plan {
  const merged: Plan = {
    ...plan,
    tasks: plan.tasks.map((t) => ({ ...t, todos: Array.isArray(byTask[t.id]) ? (byTask[t.id] as TodoItem[]) : [] })),
  };
  return normalizePlan(merged);
}

/** 读取计划时统一走这里：合并最新 todo 并 enforce owner（读路径的「派生并集」） */
function readPlanFresh(planId: string): Plan {
  const plan = planRepo.readPlan(planId);
  return mergeTodos(plan, todoRepo.snapshot(planId).byTask);
}

/* ------------------------------ 路由 ------------------------------ */

export function createApiRouter(): Router {
  const router = Router();

  /* ---------- 健康检查 ---------- */
  router.get(
    '/health',
    asyncHandler((_req, res) => {
      const info: HealthInfo = {
        ok: true,
        dataDir: config.dataDir,
        version: config.appVersion,
        lock: { ...config.lock },
      };
      ok(res, info);
    }),
  );

  /* ---------- 用户名单（系统内置单一真源，见 shared/roster.ts） ---------- */
  router.get(
    '/users',
    asyncHandler((_req, res) => {
      ok(res, [...BUILTIN_USERS]);
    }),
  );

  /* ---------- 计划列表 ---------- */
  router.get(
    '/plans',
    asyncHandler((_req, res) => {
      ok(res, planRepo.listPlans());
    }),
  );

  /* ---------- 新建计划 ---------- */
  router.post(
    '/plans',
    asyncHandler((req, res) => {
      const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
      const editor = requireEditor(req.body?.editor);
      const notes = requireNotes(req.body?.notes);
      const skeleton = planRepo.createPlan(name, editor);
      const entry = historyRepo.appendVersion(skeleton.planId, skeleton, editor, notes);
      planRepo.writePlan(entry.planSnapshot);
      ok(res, entry.planSnapshot);
    }),
  );

  /* ---------- 读取计划 ---------- */
  router.get(
    '/plans/:planId',
    asyncHandler((req, res) => {
      const planId = String(req.params.planId);
      requirePlanExists(planId);
      ok(res, readPlanFresh(planId));
    }),
  );

  /* ---------- 保存计划 ---------- */
  router.put(
    '/plans/:planId',
    asyncHandler((req, res) => {
      const planId = String(req.params.planId);
      requirePlanExists(planId);

      const editor = requireEditor(req.body?.editor);
      const notes = requireNotes(req.body?.notes);
      const lockToken = typeof req.body?.lockToken === 'string' ? req.body.lockToken : null;
      const incoming = req.body?.plan as Plan | undefined;
      if (!incoming || typeof incoming !== 'object') {
        throw new DomainError(ErrCode.ERR_VALIDATION, '缺少 plan 内容');
      }

      // 编辑锁（K11）
      lockService.assertHolder(planId, editor, lockToken);

      // 乐观并发（K13）
      const current = planRepo.readPlan(planId);
      const baseVersion = Number(req.body?.baseVersion);
      if (!Number.isFinite(baseVersion) || baseVersion !== current.version) {
        fail(
          res,
          ErrCode.ERR_STALE_VERSION,
          `已有更新版本（服务端 v${current.version}，提交基于 v${req.body?.baseVersion}），请刷新后重试`,
          { currentVersion: current.version },
        );
        return;
      }

      // todo 独立资源（方案 B）：用最新 todos.json 覆盖提交里的 todos，防止覆盖他人的并发 todo 修改；
      // 其余字段（排程/依赖/人员等）仍以提交者为准（受排他锁保护）。
      const latestByTask = todoRepo.snapshot(planId).byTask;
      const incomingWithFreshTodos: Plan = {
        ...incoming,
        tasks: incoming.tasks.map((t) => ({ ...t, todos: latestByTask[t.id] ?? [] })),
      };

      // 规整 + 保留不可变字段
      const normalized = normalizePlan({
        ...incomingWithFreshTodos,
        planId,
        schemaVersion: 1,
        createdAt: current.createdAt,
        version: current.version,
      });

      // 服务端权威重算校验
      const sched = authoritativeSchedule(normalized);
      if (hasBlockingError(sched.diagnostics)) {
        fail(res, ErrCode.ERR_VALIDATION, '存在阻断性错误，无法保存', {
          diagnostics: sched.diagnostics.filter((d) => d.level === 'error'),
        });
        return;
      }

      const withComputed = attachComputed(normalized, sched);
      // 先 history 后 plan（K14）
      const entry = historyRepo.appendVersion(planId, withComputed, editor, notes);
      planRepo.writePlan(entry.planSnapshot);

      const payload: SavePlanResp = { plan: entry.planSnapshot, version: entry.version };
      ok(res, payload);
    }),
  );

  /* ---------- 历史列表 ---------- */
  router.get(
    '/plans/:planId/history',
    asyncHandler((req, res) => {
      const planId = String(req.params.planId);
      requirePlanExists(planId);
      ok(res, historyRepo.readHistoryMeta(planId));
    }),
  );

  /* ---------- 历史单版本 ---------- */
  router.get(
    '/plans/:planId/history/:version',
    asyncHandler((req, res) => {
      const planId = String(req.params.planId);
      requirePlanExists(planId);
      const version = Number(req.params.version);
      if (!Number.isFinite(version)) {
        throw new DomainError(ErrCode.ERR_VERSION_NOT_FOUND, `非法版本号「${req.params.version}」`);
      }
      ok(res, historyRepo.readVersion(planId, version));
    }),
  );

  /* ---------- 回滚为新版本 ---------- */
  router.post(
    '/plans/:planId/restore',
    asyncHandler((req, res) => {
      const planId = String(req.params.planId);
      requirePlanExists(planId);
      const editor = requireEditor(req.body?.editor);
      const notes = requireNotes(req.body?.notes);
      const lockToken = typeof req.body?.lockToken === 'string' ? req.body.lockToken : null;
      const version = Number(req.body?.version);
      if (!Number.isFinite(version)) {
        throw new DomainError(ErrCode.ERR_VERSION_NOT_FOUND, `非法版本号「${req.body?.version}」`);
      }

      lockService.assertHolder(planId, editor, lockToken);

      const target = historyRepo.readVersion(planId, version);
      const current = planRepo.readPlan(planId);
      // todo 是独立资源，不随 plan 回滚：回滚目标快照的 todos 用最新 todos.json 覆盖。
      const latestByTask = todoRepo.snapshot(planId).byTask;
      const restored = normalizePlan({
        ...target.planSnapshot,
        tasks: target.planSnapshot.tasks.map((t) => ({ ...t, todos: latestByTask[t.id] ?? [] })),
        planId,
        schemaVersion: 1,
        createdAt: current.createdAt,
        version: current.version,
      });

      const sched = authoritativeSchedule(restored);
      const withComputed = attachComputed(restored, sched);
      const entry = historyRepo.appendVersion(planId, withComputed, editor, `[回滚自 v${version}] ${notes}`);
      planRepo.writePlan(entry.planSnapshot);

      const payload: SavePlanResp = { plan: entry.planSnapshot, version: entry.version };
      ok(res, payload);
    }),
  );

  /* ---------- 导出 ---------- */
  router.get(
    '/plans/:planId/export',
    asyncHandler((req, res) => {
      const planId = String(req.params.planId);
      requirePlanExists(planId);
      const format = (String(req.query.format ?? 'mspdi').toLowerCase() as ExportFormat) === 'csv' ? 'csv' : 'mspdi';
      const plan = readPlanFresh(planId);
      // 真实工作日历：排程与导出共用同一份（单一真源），绝不 fallback NATURAL
      const cal = buildServerCalendar();
      const sched = schedulePlan(plan, cal);
      const filename = exportFileName(plan, format);

      if (format === 'csv') {
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', contentDisposition(filename));
        res.status(200).send(toCsv(plan, sched));
        return;
      }
      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      res.setHeader('Content-Disposition', contentDisposition(filename));
      res.status(200).send(toMsProjectXml(plan, sched, cal));
    }),
  );

  /* ---------- 导入（MPP / MPX / MSPDI XML，仅本机 Java 环境） ---------- */
  router.post(
    '/plans/import',
    asyncHandler((req, res) => {
      // 未启用（无 Java / 桥接产物未编译）→ 501，提示按「缺什么」给（见 mppImportStatus）
      const importStatus = mppImportStatus();
      if (!importStatus.available) {
        fail(res, ErrCode.ERR_FEATURE_DISABLED, `本部署未启用 MPP 导入：${importStatus.hint}`);
        return;
      }

      const editor = requireEditor(req.body?.editor);
      const fileName = typeof req.body?.fileName === 'string' ? req.body.fileName.trim() : '';
      const content = typeof req.body?.content === 'string' ? req.body.content : '';
      if (!fileName) throw new DomainError(ErrCode.ERR_VALIDATION, '缺少文件名');
      if (!content) throw new DomainError(ErrCode.ERR_VALIDATION, '缺少文件内容（base64）');

      const extMatch = fileName.toLowerCase().match(/\.(mpp|mpx|xml|xer|pod)$/);
      if (!extMatch) {
        throw new DomainError(
          ErrCode.ERR_VALIDATION,
          '仅支持 Microsoft Project 格式（.mpp / .mpx / .xml / .xer / .pod）',
        );
      }

      const b64 = content.replace(/^data:[^;]*;base64,/, '');
      let buf: Buffer;
      try {
        buf = Buffer.from(b64, 'base64');
      } catch {
        throw new DomainError(ErrCode.ERR_VALIDATION, '文件内容不是合法的 base64');
      }
      if (buf.length === 0) throw new DomainError(ErrCode.ERR_VALIDATION, '文件内容为空');

      const tmp = path.join(
        os.tmpdir(),
        `pg-import-${Date.now()}-${Math.random().toString(16).slice(2)}.${extMatch[1]}`,
      );
      fs.writeFileSync(tmp, buf);
      try {
        const imported = importMppFile(tmp); // 已 normalizePlan，planId 为空
        if (!imported.tasks || imported.tasks.length === 0) {
          throw new DomainError(ErrCode.ERR_VALIDATION, '文件中未解析到任何任务');
        }
        // 落盘为新计划（v1），共享版可直接打开该原生 JSON
        const skeleton = planRepo.createPlan(imported.name, editor);
        const withPlanId: Plan = {
          ...imported,
          planId: skeleton.planId,
          calendar: skeleton.calendar,
          createdAt: skeleton.createdAt,
          updatedAt: skeleton.updatedAt,
          updatedBy: editor,
        };
        const normalized = normalizePlan(withPlanId);
        const notes =
          typeof req.body?.notes === 'string' && req.body.notes.trim() !== ''
            ? req.body.notes.trim()
            : `导入自 ${fileName}`;
        const entry = historyRepo.appendVersion(skeleton.planId, normalized, editor, notes);
        planRepo.writePlan(entry.planSnapshot);
        ok(res, entry.planSnapshot);
      } finally {
        try {
          fs.unlinkSync(tmp);
        } catch {
          /* 清理失败无妨 */
        }
      }
    }),
  );

  /* ---------- todo 独立资源（方案 B：多人并发编辑，不要求排他锁） ---------- */

  /** GET /api/plans/:planId/todos —— 全量 { revision, byTask }，供前端初始化 / 轮询 */
  router.get(
    '/plans/:planId/todos',
    asyncHandler((req, res) => {
      const planId = String(req.params.planId);
      requirePlanExists(planId);
      const data = todoRepo.snapshot(planId);
      ok(res, { revision: data.revision, byTask: data.byTask });
    }),
  );

  /** POST /api/plans/:planId/tasks/:taskId/todos —— 指令式写（add/update/delete/move） */
  router.post(
    '/plans/:planId/tasks/:taskId/todos',
    asyncHandler((req, res) => {
      const planId = String(req.params.planId);
      const taskId = String(req.params.taskId);
      requirePlanExists(planId);
      requireEditor(req.body?.user); // 仅校验身份，不校验排他锁（todo 并发资源）

      const rawOp = req.body?.op as TodoOp | undefined;
      if (!rawOp || typeof rawOp !== 'object' || !['add', 'update', 'delete', 'move'].includes(rawOp.op)) {
        throw new DomainError(ErrCode.ERR_VALIDATION, '非法 todo 指令（op）');
      }

      // 校验 taskId 真实存在（避免向不存在的任务写入孤儿 todo）
      const plan = planRepo.readPlan(planId);
      if (!plan.tasks.some((t) => t.id === taskId)) {
        throw new DomainError(ErrCode.ERR_VALIDATION, `任务 ${taskId} 不存在`);
      }

      const resp = todoRepo.applyOp(planId, taskId, rawOp);
      ok(res, resp);
    }),
  );

  /* ---------- 编辑锁 ---------- */
  router.get(
    '/locks/:planId',
    asyncHandler((req, res) => {
      ok(res, lockService.status(String(req.params.planId)));
    }),
  );

  router.post(
    '/locks/:planId/acquire',
    asyncHandler((req, res) => {
      const planId = String(req.params.planId);
      // GLOBAL_CALENDAR 是保留资源 id（非真实 plan 目录），无需 plan 存在即可加锁
      if (planId !== GLOBAL_CALENDAR) requirePlanExists(planId);
      const user = requireEditor(req.body?.user);
      ok(res, lockService.acquire(planId, user));
    }),
  );

  router.post(
    '/locks/:planId/heartbeat',
    asyncHandler((req, res) => {
      const planId = String(req.params.planId);
      const user = requireEditor(req.body?.user);
      const token = typeof req.body?.lockToken === 'string' ? req.body.lockToken : '';
      ok(res, lockService.heartbeat(planId, user, token));
    }),
  );

  router.post(
    '/locks/:planId/release',
    asyncHandler((req, res) => {
      const planId = String(req.params.planId);
      const user = requireEditor(req.body?.user);
      const token = typeof req.body?.lockToken === 'string' ? req.body.lockToken : '';
      lockService.release(planId, user, token);
      ok(res, { ok: true });
    }),
  );

  /* ---------- 全局工作日历（GLOBAL_CALENDAR，不绑定真实 plan 目录） ---------- */

  /** GET /api/calendar —— 任何人可读，无需锁 */
  router.get(
    '/calendar',
    asyncHandler((_req, res) => {
      const cfg: CalendarConfigData = calendarService.readCalendar();
      ok(res, cfg);
    }),
  );

  /** PUT /api/calendar —— 需持 GLOBAL_CALENDAR 编辑锁 */
  router.put(
    '/calendar',
    asyncHandler((req, res) => {
      const editor = requireEditor(req.body?.editor);
      const lockToken = typeof req.body?.lockToken === 'string' ? req.body.lockToken : null;

      // 编辑锁（K11）：未持锁 → 2002 / 2003（不套 requirePlanExists——GLOBAL_CALENDAR 非真实 plan）
      lockService.assertHolder(GLOBAL_CALENDAR, editor, lockToken);

      // 结构校验：ISODate 格式 / 年份 key 合法 / 数组去重；非法 → 1001(400)
      const cfg = calendarService.validateCalendarConfig(req.body?.config);

      const entry = calendarService.saveCalendar(
        cfg,
        editor,
        typeof req.body?.summary === 'string' ? req.body.summary : undefined,
      );
      ok(res, entry);
    }),
  );

  /* ---------- 404 兜底（/api 下未匹配） ---------- */
  router.use((req: Request, res: Response) => {
    fail(res, ErrCode.ERR_PLAN_NOT_FOUND, `未知接口 ${req.method} ${req.originalUrl}`);
  });

  return router;
}

/** 错误中间件：DomainError → 语义化响应；未知异常 → 5000 */
export function errorMiddleware(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (isDomainError(err)) {
    fail(res, err.code, err.message, err.data ?? null);
    return;
  }
  console.error('[routes] 未捕获异常：', err);
  const message = err instanceof Error ? err.message : String(err);
  fail(res, ErrCode.ERR_INTERNAL, `服务内部错误：${message}`);
}
