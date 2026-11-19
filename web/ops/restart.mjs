// web/ops/restart.mjs —— 优雅重启（补齐 dsh-purge 的 settle-policy + restart-desktop）
//
// 上游的重启不是"杀掉再打开"：它先把 asar 让位、再经 WScript/PowerShell 助手杀 Electron、
// 拉起后把窗口提到前台，避免宿主把退出当成 crash。这些逻辑在 vendor/restart-desktop.js 里，
// 这里直接复用（同一份上游代码），只在外面补：时机判定（settle）+ 只读预览 + 历史记录。
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const HELPER = join(HERE, '..', 'patch-engine', 'vendor', 'restart-desktop.js');

export const META = {
  id: 'restart',
  zh: '优雅重启',
  en: 'Graceful restart',
  kind: 'write',
  requires: ['desktop-exe', 'restart-helper'],
  note: '复用上游 restart-desktop.js（asar 让位 + 杀 Electron + 拉起 + 提前台），并移植 settle 时机判定。',
};

/**
 * 上游 settle-policy.js 的 applyShouldRestart 语义（外部版）：
 * 密封包（asar 还在）一律要重启——不重启就换不了包；否则补丁全绿或提示词已就位即可重启。
 */
export function applyShouldRestart({ complete = false, sealed = false, appliedCount = 0, promptReady = false } = {}) {
  if (sealed) return true;
  if (complete || promptReady) return true;
  return Number(appliedCount) > 0;
}

/** 桌面启动后要先静一会儿：Fiber._reload 还在挂 desktop-office 时动它会拿到 INACTIVE_EFFECT。 */
export const DESKTOP_SETTLE_DELAY_MS = 4000;

function helperPathOk() { return existsSync(HELPER); }

async function hostStatusFor(ctx) {
  const host = await import('../host.mjs');
  return host.hostStatus(ctx.dataDir);
}

async function hostProcs(ctx) {
  return new Promise((resolve) => {
    try {
      const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        "Get-CimInstance Win32_Process -Filter \"Name='DeepSeek Harness.exe'\" | Select-Object ProcessId,CreationDate | ConvertTo-Json -Compress"],
      { windowsHide: true });
      let out = '';
      ps.stdout.on('data', (d) => { out += String(d); });
      ps.on('close', () => {
        try {
          const v = JSON.parse(out || '[]');
          resolve(Array.isArray(v) ? v : [v]);
        } catch { resolve([]); }
      });
      ps.on('error', () => resolve([]));
    } catch { resolve([]); }
  });
}

function historyPath(ctx) { return join(ctx.dataDir, 'restart-history.json'); }

function appendHistory(ctx, row) {
  let list = [];
  try { list = JSON.parse(readFileSync(historyPath(ctx), 'utf8')); } catch { list = []; }
  if (!Array.isArray(list)) list = [];
  list.unshift(row);
  try { writeFileSync(historyPath(ctx), JSON.stringify(list.slice(0, 50), null, 2) + '\n', 'utf8'); }
  catch { /* 历史写失败不影响重启本身 */ }
}

export async function status(ctx) {
  const procs = await hostProcs(ctx);
  const helper = helperPathOk();
  let host = null;
  try { host = await hostStatusFor(ctx); } catch (e) { host = null; }
  const sealed = !!(host && host.desktopSealed);
  const counts = (host && host.counts) || {};
  const applied = Number(counts.applied || 0);
  const shouldRestart = applyShouldRestart({
    complete: !counts.failed && !counts.pending && applied > 0,
    sealed,
    appliedCount: applied,
    promptReady: false,
  });
  return {
    ok: true,
    available: helper && procs.length > 0,
    summary: helper
      ? '宿主进程 ' + procs.length + ' 个 · ' + (sealed ? 'asar 仍密封（重启会顺带落地）' : 'asar 已让位') + ' · 助手就绪'
      : '重启助手缺失：web/patch-engine/vendor/restart-desktop.js 不在',
    detail: {
      helper: HELPER,
      helperOk: helper,
      procs: procs.length,
      sealed,
      effective: !sealed,
      counts,
      shouldRestart,
      settleDelayMs: DESKTOP_SETTLE_DELAY_MS,
      last: (() => { try { return JSON.parse(readFileSync(historyPath(ctx), 'utf8'))[0] || null; } catch { return null; } })(),
    },
  };
}

export async function plan(ctx, opts = {}) {
  const st = await status(ctx);
  const d = st.detail || {};
  const mode = opts.mode === 'hard' ? 'hard' : 'graceful';
  const steps = [];
  if (mode === 'graceful' && d.helperOk) {
    steps.push('等待宿主进入可重启状态（settle ' + DESKTOP_SETTLE_DELAY_MS + 'ms）');
    steps.push('由 restart-desktop.js 结束 Electron（含窗口/托盘清理）');
    if (d.sealed) steps.push('释放 app.asar → app.asar.dshpurge-aside（补丁才会被加载）');
    steps.push('拉起 DeepSeek Harness.exe 并把窗口提到前台');
  } else {
    if (d.sealed) steps.push('kill 宿主 → 改名 app.asar → 重新拉起（host.finishHostHandoff）');
    else steps.push('kill 宿主 → 重新拉起（无 asar 需要释放）');
  }
  return { mode, steps, sealed: d.sealed, shouldRestart: d.shouldRestart };
}

export async function run(ctx, opts = {}) {
  const dryRun = opts.dryRun === true;
  const mode = opts.mode === 'hard' ? 'hard' : 'graceful';
  const st = await status(ctx);
  const d = st.detail || {};
  if (!d.helperOk && mode === 'graceful') {
    return { ok: false, changed: false, summary: '重启助手缺失，无法优雅重启', error: 'helper_missing' };
  }
  const delay = Number(opts.delayMs ?? DESKTOP_SETTLE_DELAY_MS);
  const planObj = await plan(ctx, { mode });
  if (dryRun) {
    return { ok: true, changed: false, summary: '预览：将按 ' + mode + ' 重启（未执行）', detail: { plan: planObj, delayMs: delay } };
  }
  // 落盘前的快照：重启本身不改文件，但它会把"当前补丁状态"固化下来，留一份便于事后对账
  try { await ctx.snapshot('restart'); } catch { /* 快照失败不阻断重启 */ }

  if (mode === 'hard') {
    const host = await import('../host.mjs');
    const r = await host.finishHostHandoff({ restart: true });
    appendHistory(ctx, { at: ctx.now(), mode, sealed: d.sealed, result: r.ok ? 'ok' : 'fail' });
    return {
      ok: !!r.ok,
      changed: !!r.ok,
      summary: r.ok ? '已硬重启（kill + 拉起）' : '硬重启失败：' + (r.note || r.error || ''),
      detail: r,
      error: r.ok ? null : (r.error || 'hard_restart_failed'),
    };
  }

  if (delay > 0) await new Promise((r) => setTimeout(r, delay));

  const info = {
    killApp: true,
    respawn: true,
    execPath: d && d.procs ? ctx.desktopExe : ctx.desktopExe,
    asar: existsSync(ctx.asarPath) ? ctx.asarPath : null,
    cleanup: [],
  };
  const env = Object.assign({}, process.env, { DSH_PURGE_RESTART: JSON.stringify(info) });
  delete env.DSH_PERMISSION_MODE;
  return await new Promise((resolve) => {
    let settled = false;
    const done = (ok, extra) => {
      if (settled) return;
      settled = true;
      appendHistory(ctx, { at: ctx.now(), mode, sealed: d.sealed, result: ok ? 'spawned' : 'spawn_failed' });
      resolve(Object.assign({
        ok,
        changed: ok,
        summary: ok ? '已交给重启助手：宿主会退出并由助手重新拉起' : '重启助手启动失败',
        detail: Object.assign({ helper: HELPER, info }, extra || {}),
      }, ok ? {} : { error: 'helper_spawn_failed' }));
    };
    try {
      const child = spawn(process.execPath, [HELPER], { detached: true, stdio: 'ignore', windowsHide: true, env });
      child.on('error', (e) => done(false, { message: String((e && e.message) || e) }));
      child.on('spawn', () => done(true, { pid: child.pid }));
      child.unref();
    } catch (e) {
      done(false, { message: String((e && e.message) || e) });
    }
  });
}
