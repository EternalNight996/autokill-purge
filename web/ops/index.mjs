// web/ops/index.mjs —— 能力注册表：统一发现 / 状态 / 执行。
//
// 为什么存在：dsh-purge 的能力面散在 lib/{reapply,rewind,identity,official-update,settle-policy,skills}.js 里，
// 其中一部分原本是「宿主内插件钩子」，autokill-purge 是外部控制台，得用外部等价物补：
//   reapply      → 宿主启动探测 + 自动补齐 + 官方更新交接
//   rewind       → 会话文件级回溯改写（planRewind 纯函数移植）
//   identity     → PromptPatch 管线（可叠加片段 → 编译成 prompt-inject.md）
//   redteam-pack → 48 技能 + 5 角色落地到 ~/.dsh/skills|presets，工具面走插件托管
//   restart      → 优雅重启（复用 vendor/restart-desktop.js + settle 判定）
//
// 设计约束：模块可能暂时不存在（并行开发/裁剪安装），所以一律**动态 import + 缺省降级**，
// 少了哪个模块只影响它自己那一行，不会把整个控制台拖挂。
import { appendFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeResult } from './contract.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

export const RESOURCES_DIR = 'C:/Users/Administrator/AppData/Local/Programs/DeepSeek Harness/resources';
export const DESKTOP_EXE = 'C:/Users/Administrator/AppData/Local/Programs/DeepSeek Harness/DeepSeek Harness.exe';

/** 注册顺序 = UI 展示顺序 */
export const OPS_ORDER = ['reapply', 'restart', 'plugin-install', 'identity', 'instruction-inject', 'rewind', 'redteam-pack'];

const cache = new Map();

function dshHome() {
  return process.env.DSH_HOME || join(process.env.USERPROFILE || '', '.dsh');
}

export function makeCtx(dataDir) {
  const appDir = join(RESOURCES_DIR, 'app');
  const asarPath = join(RESOURCES_DIR, 'app.asar');
  const logFile = join(dataDir, 'ops.log');
  return {
    dataDir,
    rootDir: join(HERE, '..', '..'),   // 仓库根：plugin-install 从这里找 plugin/ 与 local-pkgs
    dshHome: dshHome(),
    resourcesDir: RESOURCES_DIR,
    appDir,
    asarPath,
    asidePath: asarPath + '.dshpurge-aside',
    desktopExe: DESKTOP_EXE,
    now: () => new Date().toISOString(),
    log(msg) {
      try { appendFileSync(logFile, '[' + new Date().toISOString() + '] ' + String(msg) + '\n'); } catch { /* 日志不影响主流程 */ }
    },
    async snapshot(tag) {
      const host = await import('../host.mjs');
      return host.createSnapshot(dataDir, 'ops-' + String(tag || 'run'));
    },
  };
}

async function load(id) {
  if (cache.has(id)) return cache.get(id);
  try {
    const mod = await import('./' + id + '.mjs');
    cache.set(id, mod);   // 只缓存成功的：并行开发时文件晚几分钟落盘，失败不能钉死
    return mod;
  } catch (e) {
    // 不写缓存：模块可能正在被写入/修好，下一次调用要能重新尝试
    return { __loadError: String((e && e.message) || e) };
  }
}

/** 只读：所有能力的 META + 可用性摘要（UI 首屏用） */
export async function listOps(dataDir) {
  const ctx = makeCtx(dataDir);
  // 并行探测：reapply(1.9s) / restart(1.3s) / rewind(0.9s) 是三个慢块，串行要 4s+，
  // 右侧栏每次刷新都吃这个延迟。Promise.all 之后按 OPS_ORDER 顺序返回，顺序仍然稳定。
  const rows = await Promise.all(OPS_ORDER.map(async (id) => {
    const mod = await load(id);
    if (!mod || mod.__loadError) {
      return { id, zh: id, en: id, kind: 'both', available: false, reason: mod && mod.__loadError ? mod.__loadError : '模块不存在', summary: '' };
    }
    let st = null;
    let reason = '';
    try {
      st = normalizeResult('status', await mod.status(ctx));
    } catch (e) {
      reason = String((e && e.message) || e);
      st = { ok: false, available: false, summary: '', detail: null };
    }
    return {
      id,
      zh: (mod.META && (mod.META.zh || mod.META.id)) || id,
      en: (mod.META && (mod.META.en || mod.META.id)) || id,
      kind: (mod.META && mod.META.kind) || 'both',
      requires: (mod.META && mod.META.requires) || [],
      note: (mod.META && mod.META.note) || '',
      available: st.available && !reason,
      reason: reason || (st.ok ? '' : '状态读取失败'),
      summary: st.summary,
      detail: st.detail,
    };
  }));
  return { ok: true, contract: 1, ctx: { dshHome: ctx.dshHome, appDir: ctx.appDir, asarPath: ctx.asarPath }, ops: rows };
}

export async function opStatus(dataDir, id) {
  const mod = await load(id);
  if (!mod || mod.__loadError) return { ok: false, available: false, error: mod && mod.__loadError ? mod.__loadError : '模块不存在' };
  const ctx = makeCtx(dataDir);
  try {
    return normalizeResult('status', await mod.status(ctx));
  } catch (e) {
    return { ok: false, available: false, error: String((e && e.message) || e) };
  }
}

export async function opRun(dataDir, id, opts = {}) {
  const mod = await load(id);
  if (!mod || mod.__loadError) return { ok: false, changed: false, error: mod && mod.__loadError ? mod.__loadError : '模块不存在' };
  if (typeof mod.run !== 'function') return { ok: false, changed: false, error: '该能力只读，没有 run()' };
  const ctx = makeCtx(dataDir);
  try {
    const r = normalizeResult('run', await mod.run(ctx, opts || {}));
    ctx.log('[run] ' + id + ' → ok=' + r.ok + ' changed=' + r.changed + ' ' + r.summary);
    return r;
  } catch (e) {
    const msg = String((e && e.message) || e);
    ctx.log('[run] ' + id + ' threw: ' + msg);
    return { ok: false, changed: false, error: msg, summary: '执行失败：' + msg };
  }
}

export async function opPlan(dataDir, id, opts = {}) {
  const mod = await load(id);
  if (!mod || typeof mod.plan !== 'function') return { ok: false, error: '该能力没有 plan()' };
  const ctx = makeCtx(dataDir);
  try {
    return { ok: true, plan: await mod.plan(ctx, opts || {}) };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}
