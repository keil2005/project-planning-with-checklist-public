/**
 * server/storage.ts —— 存储层。
 *
 * 落盘结构（K15：路径只来自 config.ts）：
 *   DATA_DIR/plans/<planId>/plan.json      当前最新
 *   DATA_DIR/plans/<planId>/history.json   append-only 全量快照
 *
 * 规则：
 *   - 原子写：tmp → rename（K14）
 *   - 先写 history.json 再写 plan.json（由 routes 编排）
 *   - 读取统一走 migrate() 钩子（K17）
 */

import fs from 'node:fs';
import path from 'node:path';
import { dayjs, nowTimestamp, todayISO } from '../shared/datetime';
import { makeTaskId, normalizePlan } from '../shared/scheduler';
import {
  DomainError,
  ErrCode,
  SCHEMA_VERSION,
  type HistoryFile,
  type Plan,
  type PlanMeta,
  type VersionEntry,
  type VersionMeta,
} from '../shared/types';
import { config, historyFile, planDir, planFile, plansRoot, resolveAnchorDate } from './config';

const HISTORY_WARN_BYTES = 5 * 1024 * 1024;

/* ------------------------------ 通用 IO ------------------------------ */

function atomicWriteJson(file: string, obj: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, file);
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}

/**
 * 迁移钩子（K17）。当前仅接受 schemaVersion === 1；
 * 后续版本在此做字段升级后再交给 normalizePlan。
 */
function migratePlan(raw: unknown, planId: string): Plan {
  const obj = (raw ?? {}) as Partial<Plan>;
  const sv = Number(obj.schemaVersion ?? SCHEMA_VERSION);
  if (sv !== SCHEMA_VERSION) {
    throw new DomainError(
      ErrCode.ERR_INTERNAL,
      `计划 ${planId} 的 schemaVersion=${sv} 不受支持（当前支持 ${SCHEMA_VERSION}）`,
    );
  }
  const normalized = normalizePlan({ ...(obj as Plan), planId: obj.planId ?? planId });
  return normalized;
}

function migrateHistory(raw: unknown, planId: string): HistoryFile {
  const obj = (raw ?? {}) as Partial<HistoryFile>;
  const sv = Number(obj.schemaVersion ?? SCHEMA_VERSION);
  if (sv !== SCHEMA_VERSION) {
    throw new DomainError(
      ErrCode.ERR_INTERNAL,
      `历史 ${planId} 的 schemaVersion=${sv} 不受支持（当前支持 ${SCHEMA_VERSION}）`,
    );
  }
  const versions = Array.isArray(obj.versions) ? obj.versions : [];
  return { schemaVersion: SCHEMA_VERSION, planId: obj.planId ?? planId, versions };
}

/** 计划 ID 生成规则（K6）：p-yyyyMMdd-HHmmss-xxxx */
function generatePlanId(): string {
  const stamp = dayjs().format('YYYYMMDD-HHmmss');
  const rand = Math.random().toString(16).slice(2, 6).padEnd(4, '0');
  return `p-${stamp}-${rand}`;
}

/* ------------------------------ PlanRepository ------------------------------ */

export class PlanRepository {
  /** 扫描 DATA_DIR/plans/*​/plan.json（§2.7：不额外维护索引） */
  public listPlans(): PlanMeta[] {
    const root = plansRoot();
    if (!fs.existsSync(root)) return [];
    const metas: PlanMeta[] = [];
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const file = planFile(entry.name);
      if (!fs.existsSync(file)) continue;
      try {
        const raw = readJson<Partial<Plan>>(file);
        metas.push({
          planId: raw.planId ?? entry.name,
          name: raw.name ?? '未命名计划',
          version: Number(raw.version ?? 0),
          updatedAt: raw.updatedAt ?? '',
          updatedBy: raw.updatedBy ?? '',
          taskCount: Array.isArray(raw.tasks) ? raw.tasks.length : 0,
        });
      } catch (e) {
        console.warn(`[storage] 跳过损坏的计划 ${entry.name}：${String(e)}`);
      }
    }
    metas.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
    return metas;
  }

  public exists(planId: string): boolean {
    return fs.existsSync(planFile(planId));
  }

  public readPlan(planId: string): Plan {
    const file = planFile(planId);
    if (!fs.existsSync(file)) {
      throw new DomainError(ErrCode.ERR_PLAN_NOT_FOUND, `计划 ${planId} 不存在`);
    }
    return migratePlan(readJson<unknown>(file), planId);
  }

  /** 创建骨架计划（version=0，由 routes 追加首个版本后写盘） */
  public createPlan(name: string, editor: string): Plan {
    const planId = generatePlanId();
    fs.mkdirSync(planDir(planId), { recursive: true });
    const ts = nowTimestamp();
    const plan: Plan = {
      schemaVersion: SCHEMA_VERSION,
      planId,
      name: name.trim() === '' ? '未命名计划' : name.trim(),
      version: 0,
      createdAt: ts,
      updatedAt: ts,
      updatedBy: editor,
      nextTaskSeq: 1,
      calendar: {
        mode: 'NATURAL',
        holidays: [],
        anchorDate: resolveAnchorDate() || todayISO(),
        defaultDuration: config.schedule.defaultDuration,
      },
      tasks: [],
    };
    return plan;
  }

  public writePlan(plan: Plan): void {
    atomicWriteJson(planFile(plan.planId), plan);
  }

  /** 下一个任务 ID（K6，与前端共用同一生成规则） */
  public nextTaskId(plan: Plan): string {
    return makeTaskId(plan.nextTaskSeq);
  }
}

/* ------------------------------ HistoryRepository ------------------------------ */

export class HistoryRepository {
  private readHistory(planId: string): HistoryFile {
    const file = historyFile(planId);
    if (!fs.existsSync(file)) {
      return { schemaVersion: SCHEMA_VERSION, planId, versions: [] };
    }
    return migrateHistory(readJson<unknown>(file), planId);
  }

  /** 版本元信息（倒序，不含快照） */
  public readHistoryMeta(planId: string): VersionMeta[] {
    const history = this.readHistory(planId);
    return history.versions
      .map<VersionMeta>((v) => ({
        version: v.version,
        timestamp: v.timestamp,
        editor: v.editor,
        notes: v.notes,
      }))
      .sort((a, b) => b.version - a.version);
  }

  public readVersion(planId: string, version: number): VersionEntry {
    const history = this.readHistory(planId);
    const entry = history.versions.find((v) => v.version === version);
    if (!entry) {
      throw new DomainError(ErrCode.ERR_VERSION_NOT_FOUND, `计划 ${planId} 不存在版本 v${version}`);
    }
    return { ...entry, planSnapshot: normalizePlan(entry.planSnapshot) };
  }

  private nextVersion(history: HistoryFile): number {
    return history.versions.reduce((acc, v) => Math.max(acc, Number(v.version) || 0), 0) + 1;
  }

  /**
   * 追加版本（append-only，K13）。版本号服务端生成；
   * 返回的 planSnapshot 即应写入 plan.json 的内容。
   */
  public appendVersion(planId: string, plan: Plan, editor: string, notes: string): VersionEntry {
    const history = this.readHistory(planId);
    const version = this.nextVersion(history);
    const timestamp = nowTimestamp();
    const snapshot: Plan = {
      ...plan,
      schemaVersion: SCHEMA_VERSION,
      planId,
      version,
      updatedAt: timestamp,
      updatedBy: editor,
    };
    const entry: VersionEntry = { version, timestamp, editor, notes, planSnapshot: snapshot };
    history.versions.push(entry);
    history.schemaVersion = SCHEMA_VERSION;
    history.planId = planId;

    const payload = `${JSON.stringify(history, null, 2)}\n`;
    if (Buffer.byteLength(payload, 'utf8') > HISTORY_WARN_BYTES) {
      console.warn(
        `[storage] history.json 已超过 ${HISTORY_WARN_BYTES} 字节（planId=${planId}），建议启用快照外置扩展位`,
      );
    }
    atomicWriteJson(historyFile(planId), history);
    return entry;
  }
}

export const planRepo = new PlanRepository();
export const historyRepo = new HistoryRepository();
