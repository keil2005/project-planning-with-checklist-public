/**
 * server/mppImport.ts —— MPP 导入映射层（需要 Java 环境，跨平台）。
 *
 *  - resolveJava()：按「环境变量 PLAN_GANTT_JAVA → 便携 JRE（本地盘）→ 系统 PATH」
 *    三级解析 java 可执行文件；全部找不到返回 null。
 *  - isMppImportAvailable()：java 可用 **且** 编译好的 MppImport.class 存在。
 *    不满足 → 路由返回 501，前端提示「本部署未启用 MPP 导入」。
 *  - mppImportStatus()：在上一项基础上给出分原因诊断（缺 Java / 缺桥接产物），
 *    让提示指向「如何启用」而不是笼统的「未启用」。
 *  - importMppFile()：调起 Java 桥接（MppImport）读取 .mpp/.mpx/.xml，拿到中间 JSON，
 *    再交给 toPlan() 映射为本工具的 Task[]。
 *
 * 零依赖部署策略：Windows 共享包默认不含 server/mpxj/ → 自动 501，行为与不含本
 * 能力时完全一致；需要导入的人跑一次 enable-mpp-import.ps1，把便携 JRE 装到
 * **本地盘**（不是共享盘），装完重启服务即启用。
 *
 * 中间 JSON 契约（由 MppImport.java 输出，单一真源）：
 *   { name, tasks: [{ uid, name, start, finish, parentUid, owner, note, progress,
 *                     predecessors: [{ uid, type, lagText }] }] }
 * 其中 finish 为 MPP 含在内的结束日（inclusive）；本工具 end 为独占结束，故 +1 天。
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { normalizePlan } from '../shared/scheduler';
import {
  DomainError,
  ErrCode,
  type DepType,
  type Duration,
  type DurationUnit,
  type Plan,
  type Task,
} from '../shared/types';
import { config } from './config';

/* ------------------------------ 路径 ------------------------------ */

// 桥接目录默认在项目内；可用 PLAN_GANTT_MPXJ_DIR 指到本地盘——共享盘上让 JVM 加载
// 37MB jar 会明显拖慢首次导入，装在本地盘可规避（enable-mpp-import 脚本可选此模式）。
const MPXJ_DIR =
  (process.env.PLAN_GANTT_MPXJ_DIR && process.env.PLAN_GANTT_MPXJ_DIR.trim() !== ''
    ? process.env.PLAN_GANTT_MPXJ_DIR.trim()
    : path.join(config.projectRoot, 'server', 'mpxj'));
const MPXJ_LIB = path.join(MPXJ_DIR, 'lib');
const MPXJ_CLASS = path.join(MPXJ_DIR, 'MppImport.class');

/* ------------------------------ 中间 JSON 类型 ------------------------------ */

interface MppPredecessor {
  uid: string;
  type: string;
  lagText: string | null;
}

interface MppTask {
  uid: string;
  name?: string | null;
  start?: string | null;
  finish?: string | null;
  parentUid?: string | null;
  owner?: string | null;
  note?: string | null;
  progress?: number | null;
  predecessors?: MppPredecessor[] | null;
}

export interface MppImportResult {
  name?: string | null;
  tasks?: MppTask[] | null;
}

/* ------------------------------ 能力检测 ------------------------------ */

let javaProbeDone = false;
let javaProbePath: string | null = null;

/**
 * 便携 JRE 的候选落点（由 enable-mpp-import 脚本安装）。
 *
 * 为何支持「本地 JRE」：Windows 共享盘部署包按「零依赖」设计，不打包
 * server/mpxj/，也不要求同事装 Java；需要 MPP 导入的人执行一次
 * enable-mpp-import.ps1，把便携 JRE 装到**本地盘**（而非共享盘）——
 * 既守住零依赖分发，又避开在共享盘上执行 .exe 的 IT 策略/性能风险。
 */
function localJreCandidates(): string[] {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const appData = process.env.LOCALAPPDATA || '';
  const out: string[] = [];
  if (process.platform === 'win32') {
    if (appData) out.push(path.join(appData, 'plan-gantt', 'jre', 'bin', 'java.exe'));
    if (home) out.push(path.join(home, 'AppData', 'Local', 'plan-gantt', 'jre', 'bin', 'java.exe'));
  } else if (process.platform === 'darwin') {
    if (home) {
      out.push(path.join(home, 'Library', 'Application Support', 'plan-gantt', 'jre', 'bin', 'java'));
    }
  } else if (home) {
    out.push(path.join(home, '.local', 'share', 'plan-gantt', 'jre', 'bin', 'java'));
  }
  return out;
}

function probeJava(cmd: string): boolean {
  try {
    const r = spawnSync(cmd, ['-version'], {
      stdio: ['ignore', 'ignore', 'ignore'],
      windowsHide: true,
    });
    return r.status === 0;
  } catch {
    return false;
  }
}

/**
 * 解析可用的 java 可执行文件，优先级：
 *   ① 环境变量 PLAN_GANTT_JAVA（运维/排错用）
 *   ② 便携 JRE（enable-mpp-import 安装到本地盘的落点）
 *   ③ 系统 PATH 上的 java
 * 返回 null 表示没有任何可用 Java。结果缓存，避免每次导入都探测。
 */
export function resolveJava(): string | null {
  if (javaProbeDone) return javaProbePath;

  const candidates: string[] = [];
  const explicit = process.env.PLAN_GANTT_JAVA;
  if (explicit && explicit.trim() !== '') candidates.push(explicit.trim());
  candidates.push(...localJreCandidates());
  candidates.push(process.platform === 'win32' ? 'java.exe' : 'java');

  javaProbePath = candidates.find(probeJava) ?? null;
  javaProbeDone = true;
  return javaProbePath;
}

/** 仅用于测试：清掉 Java 探测缓存 */
export function resetJavaProbeCache(): void {
  javaProbeDone = false;
  javaProbePath = null;
}

/** 本部署是否启用 MPP 导入（需 java + 编译好的桥接类） */
export function isMppImportAvailable(): boolean {
  return resolveJava() !== null && fs.existsSync(MPXJ_CLASS);
}

export type MppImportStatus =
  | { available: true; javaPath: string }
  | { available: false; reason: 'no-java' | 'no-bridge'; hint: string };

/**
 * 能力门的分原因诊断，供路由给出「可一键启用」而非笼统「未启用」的提示。
 */
export function mppImportStatus(): MppImportStatus {
  const javaPath = resolveJava();
  if (!javaPath) {
    return {
      available: false,
      reason: 'no-java',
      hint:
        process.platform === 'win32'
          ? '未找到 Java。运行 enable-mpp-import.ps1 安装便携 JRE 后重启服务即可启用（只需执行一次）。'
          : '未找到 Java。运行 server/mpxj/fetch-mpxj.sh 并确保 java 在 PATH 后重启服务。',
    };
  }
  if (!fs.existsSync(MPXJ_CLASS)) {
    return {
      available: false,
      reason: 'no-bridge',
      hint: `未找到编译产物 ${MPXJ_CLASS}。运行 ${
        process.platform === 'win32' ? 'enable-mpp-import.ps1' : 'server/mpxj/fetch-mpxj.sh'
      } 编译桥接后重启服务。`,
    };
  }
  return { available: true, javaPath };
}

/* ------------------------------ 中间 JSON → 本工具 Task[] ------------------------------ */

function parseLag(lagText: string | null): { lag: Duration | null; lagSign: 1 | -1 } {
  if (!lagText) return { lag: null, lagSign: 1 };
  const m = /^\s*([+-]?)\s*(\d+)\s*([dwm])\s*$/i.exec(lagText);
  if (!m) return { lag: null, lagSign: 1 };
  const sign: 1 | -1 = m[1] === '-' ? -1 : 1;
  const unit = m[3].toLowerCase() as DurationUnit;
  return { lag: { value: Number(m[2]), unit }, lagSign: sign };
}

/**
 * 把 MppImport 的中间 JSON 映射为 { name, tasks }（Task 已带稳定 ID）。
 * 调用方负责组装 Plan、normalizePlan 与落盘。
 */
export function toPlan(result: MppImportResult): { name: string; tasks: Task[] } {
  const allTasks = Array.isArray(result.tasks) ? result.tasks : [];
  const name = typeof result.name === 'string' && result.name.trim() !== '' ? result.name.trim() : '未命名计划';

  // MPP 里插入的空白行会被 MPXJ 读成「无名 + 无日期 + 无依赖 + 无备注」的记录
  // （实测 31Jul_highlevelplanning.mpp 59 条里有 5 条），导入后会在甘特图变成空白条目。
  // 判定为空白行的直接丢弃；有名字/日期/依赖/备注任一者一律保留，避免误删真实任务。
  const isBlankRow = (t: MppTask | null | undefined): boolean => {
    if (!t) return true;
    const nm = typeof t.name === 'string' ? t.name.trim() : '';
    const hasDate =
      (typeof t.start === 'string' && t.start.trim() !== '') ||
      (typeof t.finish === 'string' && t.finish.trim() !== '');
    const hasDeps = Array.isArray(t.predecessors) && t.predecessors.length > 0;
    const hasNote = typeof t.note === 'string' && t.note.trim() !== '';
    return nm === '' && !hasDate && !hasDeps && !hasNote;
  };

  let rawTasks: MppTask[] = allTasks.filter((t): t is MppTask => !!t && !isBlankRow(t));
  // 极端兜底：若全部被判定为空白（异常文件），退回原始集合，避免导成空计划
  if (rawTasks.length === 0) {
    rawTasks = allTasks.filter((t): t is MppTask => !!t);
  }

  // 父级被过滤时，向上追溯到最近的保留祖先，避免子任务被提到根节点
  const byUid = new Map<string, MppTask>(rawTasks.map((t) => [String(t.uid), t]));
  const resolveParentUid = (t: MppTask, depth = 0): string | null => {
    if (t.parentUid == null || depth > 32) return null;
    const key = String(t.parentUid);
    if (byUid.has(key)) return key;
    const ancestor = allTasks.find((x) => x && String(x.uid) === key);
    return ancestor ? resolveParentUid(ancestor, depth + 1) : null;
  };

  // MPP uid → 本工具稳定 ID（T-0001…）；仅保留项参与编号，故被丢弃项不会留下空号
  const ourIdOf = new Map<string, string>();
  rawTasks.forEach((t, i) => {
    if (t && t.uid != null) ourIdOf.set(String(t.uid), `T-${String(i + 1).padStart(4, '0')}`);
  });

  const tasks: Task[] = rawTasks.map((t) => {
    const id = ourIdOf.get(String(t.uid)) as string;
    const start = typeof t.start === 'string' && t.start.trim() !== '' ? t.start.trim() : null;
    // MPP finish 为 inclusive（最后工作日）→ 本工具 end 也是 inclusive（v1.2.1对齐 K3 端点式），直接存
    const end =
      typeof t.finish === 'string' && t.finish.trim() !== ''
        ? t.finish.trim()
        : null;

    const deps = (Array.isArray(t.predecessors) ? t.predecessors : [])
      .map((p) => {
        const predId = p && p.uid != null ? ourIdOf.get(String(p.uid)) : undefined;
        if (!predId || predId === id) return null;
        const type = (['FS', 'SS', 'FF', 'SF'].includes(String(p?.type)) ? p.type : 'FS') as DepType;
        const { lag, lagSign } = parseLag(p?.lagText ?? null);
        const raw = `${type}${p?.lagText ?? ''}`;
        return { predecessorId: predId, type, lag, lagSign, raw };
      })
      .filter((d): d is NonNullable<typeof d> => d !== null);

    // 父级若已被过滤，向上取其最近的保留祖先；指向不存在任务的依赖由 ourIdOf 自动丢弃
    const parentUid = resolveParentUid(t);
    const parentId = parentUid ? ourIdOf.get(parentUid) ?? null : null;

    // MPP 里一个任务通常只有一个资源名；升级为数组后统一包成单人数组
    // （若 MPP 里就是 "A,B" 这种写法，normalizePeople 在 normalizePlan 阶段会再拆开）
    const owner = typeof t.owner === 'string' && t.owner.trim() !== '' ? [t.owner.trim()] : [];
    const note = typeof t.note === 'string' && t.note.trim() !== '' ? t.note.trim() : undefined;
    const progress =
      typeof t.progress === 'number' && Number.isFinite(t.progress)
        ? Math.max(0, Math.min(100, Math.round(t.progress)))
        : undefined;

    const task: Task = {
      id,
      seq: 0,
      name: typeof t.name === 'string' ? t.name : '',
      parentId: parentId && parentId !== id ? parentId : null,
      input: { start, end, duration: null },
      deps,
      collapsed: false,
      // 人员字段恒为数组（normalizePlan 会再归一化一次）
      owner,
      consultant: [],
    };
    if (note) task.note = note;
    if (progress !== undefined) task.progress = progress;
    return task;
  });

  return { name, tasks };
}

/* ------------------------------ 文件 → Plan ------------------------------ */

/**
 * 读取一个 MPP/MPX/MSPDI 文件并映射为 Plan（尚未落盘）。
 * 未启用时抛出 ERR_FEATURE_DISABLED，由路由转换为 501。
 */
export function importMppFile(filePath: string): Plan {
  if (!isMppImportAvailable()) {
    throw new DomainError(
      ErrCode.ERR_FEATURE_DISABLED,
      '本部署未启用 MPP 导入（需在本机 Java 环境运行 fetch-mpxj.sh）',
    );
  }

  // 注意：必须写成 lib/* 才能把目录下所有 jar 纳入 classpath（仅目录名不会加载 jar）。
  // classpath 分隔符用 path.delimiter（Windows=; Unix=:），路径含空格由 spawn 自行加引号。
  const classPath = `${MPXJ_DIR}${path.delimiter}${MPXJ_LIB}${path.sep}*`;
  const res = spawnSync(resolveJava() ?? 'java', ['-cp', classPath, 'MppImport', filePath], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });

  if (res.error) {
    throw new DomainError(ErrCode.ERR_INTERNAL, `调用 MPP 桥接失败：${res.error.message}`);
  }
  if (res.status !== 0) {
    const msg = (res.stderr || '').trim() || '未知错误';
    throw new DomainError(ErrCode.ERR_INTERNAL, `MPP 解析失败：${msg}`);
  }

  let parsed: MppImportResult;
  try {
    parsed = JSON.parse((res.stdout || '').trim() || '{}') as MppImportResult;
  } catch (e) {
    throw new DomainError(ErrCode.ERR_INTERNAL, `MPP 桥接输出非法 JSON：${String(e)}`);
  }

  const { name, tasks } = toPlan(parsed);
  const plan: Plan = {
    schemaVersion: 1,
    planId: '',
    name,
    version: 0,
    createdAt: '',
    updatedAt: '',
    updatedBy: '',
    nextTaskSeq: tasks.length + 1,
    calendar: {
      mode: 'NATURAL',
      skipHolidays: false,
      anchorDate: config.schedule.anchorDate === 'TODAY' ? '' : config.schedule.anchorDate,
      defaultDuration: config.schedule.defaultDuration,
    },
    tasks,
  };
  return normalizePlan(plan);
}
