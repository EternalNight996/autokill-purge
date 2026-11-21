// 落地执行器：由 WMI 拉起（不在 DSH 进程树里），因此 kill 宿主不会连坐自己。
// 用法：node scripts/handoff-runner.mjs --mode=land|restart|unland [--delay=2500]
//
//   land    = 结束宿主 → app.asar 让位 → 重新拉起 → 健康检查（失败自动回滚）
//   restart = 结束宿主 → 重新拉起（不碰 asar；卸载后把桌面拉回来）
//   unland  = 结束宿主 → app.asar 放回 → 重新拉起
//
// 结束后顺手把控制台拉起来（8792 没在跑时），避免用户回来面板打不开。
import { spawn, execFile } from 'node:child_process';
import { existsSync, renameSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const RES = 'C:/Users/Administrator/AppData/Local/Programs/DeepSeek Harness/resources';
const ASAR = RES + '/app.asar';
const ASIDE = RES + '/app.asar.dshpurge-aside';
const EXE = 'C:/Users/Administrator/AppData/Local/Programs/DeepSeek Harness/DeepSeek Harness.exe';
const LOG = join(ROOT, 'data', 'logs', 'handoff-runner.log');
const OUT = join(ROOT, 'data', 'logs', 'handoff-runner.json');

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)=(.*)$/);
  return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true];
}));
const MODE = String(args.mode || 'land');
const DELAY = Number(args.delay || 2500);
const WEB_PORT = Number(args.port || 8792);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function log(m) {
  try { appendFileSync(LOG, `[${new Date().toISOString()}] [${MODE}] ${m}\n`); } catch { /* ignore */ }
}
function finish(o) {
  try { writeFileSync(OUT, JSON.stringify({ mode: MODE, ...o }, null, 2)); } catch { /* ignore */ }
  log('done ' + JSON.stringify(o));
  process.exit(0);
}
function ps(cmd) {
  return new Promise((resolve) => {
    execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', cmd], { windowsHide: true, timeout: 25000 }, (e, so) => resolve(String(so || '')));
  });
}
async function hostProcs() {
  const out = await ps("(Get-CimInstance Win32_Process -Filter \"Name='DeepSeek Harness.exe'\" | Select-Object -ExpandProperty CommandLine) -join '||'");
  const lines = out.split('||').map((s) => s.trim()).filter(Boolean);
  const low = lines.map((l) => l.toLowerCase());
  return {
    count: lines.length,
    hasAsar: low.some((l) => l.includes('app.asar')),
    hasApp: low.some((l) => l.includes('resources\\app') || l.includes('resources/app')),
    hasRenderer: lines.some((l) => l.includes('--type=renderer')),
  };
}
function portOpen(port) {
  return new Promise((resolve) => {
    const s = net.connect({ host: '127.0.0.1', port });
    let done = false;
    const fin = (v) => { if (!done) { done = true; try { s.destroy(); } catch { /* ignore */ } resolve(v); } };
    s.setTimeout(1200);
    s.once('connect', () => fin(true));
    s.once('timeout', () => fin(false));
    s.once('error', () => fin(false));
  });
}
async function ensureConsole() {
  if (await portOpen(WEB_PORT)) return 'already-running';
  try {
    const child = spawn(process.execPath, [join(ROOT, 'web', 'server.mjs')], { cwd: ROOT, detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
    return 'spawned:' + child.pid;
  } catch (e) { return 'failed:' + String((e && e.message) || e); }
}

log('armed; delay=' + DELAY + 'ms; asar=' + existsSync(ASAR) + ' aside=' + existsSync(ASIDE));
await sleep(DELAY);

try {
  log('kill host');
  await new Promise((r) => execFile('taskkill', ['/IM', 'DeepSeek Harness.exe'], () => r()));
  await sleep(2500);
  await new Promise((r) => execFile('taskkill', ['/IM', 'DeepSeek Harness.exe', '/F'], () => r()));
  let p = await hostProcs();
  for (let i = 0; i < 40 && p.count; i++) { await sleep(500); p = await hostProcs(); }
  log('killed; remaining=' + p.count);
  if (p.count) finish({ ok: false, error: 'host_still_running', remaining: p.count });

  if (MODE === 'land' && existsSync(ASAR)) {
    renameSync(ASAR, ASIDE);
    log('asar -> aside');
  } else if (MODE === 'unland' && !existsSync(ASAR) && existsSync(ASIDE)) {
    renameSync(ASIDE, ASAR);
    log('aside -> asar');
  }

  log('launch');
  spawn(EXE, [], { detached: true, stdio: 'ignore' }).unref();

  let last = { count: 0, hasAsar: false, hasApp: false, hasRenderer: false };
  let healthy = false;
  for (let i = 0; i < 35; i++) {
    await sleep(1000);
    last = await hostProcs();
    if (last.hasRenderer && (MODE === 'land' ? last.hasApp : true)) { healthy = true; break; }
    if (last.count === 0) break;
  }
  log('verify: count=' + last.count + ' renderer=' + last.hasRenderer + ' fromApp=' + last.hasApp + ' fromAsar=' + last.hasAsar);

  if (MODE === 'land' && !healthy) {
    log('rollback');
    await new Promise((r) => execFile('taskkill', ['/IM', 'DeepSeek Harness.exe', '/F'], () => r()));
    await sleep(2500);
    try { renameSync(ASIDE, ASAR); log('rollback: aside -> asar'); } catch (e) { log('rollback rename failed: ' + (e && e.message)); }
    spawn(EXE, [], { detached: true, stdio: 'ignore' }).unref();
    finish({ ok: false, error: 'launch_not_healthy', detail: last, rolledBack: true, console: await ensureConsole() });
  }

  const consoleState = await ensureConsole();
  finish({ ok: true, healthy, processes: last.count, asarExists: existsSync(ASAR), asideExists: existsSync(ASIDE), console: consoleState });
} catch (e) {
  log('fatal: ' + (e && e.message));
  finish({ ok: false, error: 'fatal', detail: String((e && e.message) || e), console: await ensureConsole() });
}
