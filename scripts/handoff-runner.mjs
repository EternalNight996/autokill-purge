// 落地执行器：由 WMI 拉起（不在 DSH 进程树里），因此 kill 宿主不会连坐自己。
// 用法：node scripts/handoff-runner.mjs --mode=land|restart|unland|uninstall [--delay=2500]
//
//   land      = 结束宿主 → app.asar 让位 → 重新拉起 → 健康检查（失败自动回滚）
//   restart   = 结束宿主 → 重新拉起（不碰 asar）
//   unland    = 结束宿主 → app.asar 放回 → 重新拉起
//   uninstall = 结束宿主 → 放回 asar → 按原件还原 → 清解包残留 → 重新拉起（一键卸载整段）
//
// 每一步都写 data/logs/handoff-progress.json，前端轮询它显示进度条。
import { spawn, execFile } from 'node:child_process';
import { existsSync, renameSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import net from 'node:net';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const RES = 'C:/Users/Administrator/AppData/Local/Programs/DeepSeek Harness/resources';
const ASAR = RES + '/app.asar';
const ASIDE = RES + '/app.asar.dshpurge-aside';
const EXE = 'C:/Users/Administrator/AppData/Local/Programs/DeepSeek Harness/DeepSeek Harness.exe';
const LOG = join(ROOT, 'data', 'logs', 'handoff-runner.log');
const OUT = join(ROOT, 'data', 'logs', 'handoff-runner.json');
const PROG = join(ROOT, 'data', 'logs', 'handoff-progress.json');

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
/** 进度：前端每 400ms 读一次，percent 只增不减 */
let lastPercent = 0;
function progress(step, percent, note) {
  lastPercent = Math.max(lastPercent, percent);
  const payload = { mode: MODE, step, percent: lastPercent, note: note || '', at: Date.now(), done: false };
  try { writeFileSync(PROG, JSON.stringify(payload, null, 2)); } catch { /* ignore */ }
  log(`[${percent}%] ${step} ${note || ''}`);
}
function finish(o) {
  try { writeFileSync(PROG, JSON.stringify({ mode: MODE, step: o.ok ? 'done' : 'failed', percent: 100, note: o.error || '完成', at: Date.now(), done: true, result: o }, null, 2)); } catch { /* ignore */ }
  try { writeFileSync(OUT, JSON.stringify({ mode: MODE, ...o }, null, 2)); } catch { /* ignore */ }
  log('done ' + JSON.stringify(o));
  process.exit(0);
}
function ps(cmd) {
  return new Promise((resolve) => {
    execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', cmd], { windowsHide: true, timeout: 30000 }, (e, so) => resolve(String(so || '')));
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

progress('armed', 1, '约 ' + Math.round(DELAY / 1000) + ' 秒后开始');
await sleep(DELAY);

try {
  progress('kill-host', 10, '结束宿主');
  await new Promise((r) => execFile('taskkill', ['/IM', 'DeepSeek Harness.exe'], () => r()));
  await sleep(2500);
  await new Promise((r) => execFile('taskkill', ['/IM', 'DeepSeek Harness.exe', '/F'], () => r()));
  let p = await hostProcs();
  for (let i = 0; i < 40 && p.count; i++) { await sleep(500); p = await hostProcs(); }
  if (p.count) finish({ ok: false, error: 'host_still_running', remaining: p.count });
  progress('host-stopped', 25, '宿主已退出');

  if (MODE === 'land' && existsSync(ASAR)) {
    renameSync(ASAR, ASIDE);
    progress('asar-aside', 40, 'app.asar 已让位');
  } else if ((MODE === 'unland' || MODE === 'uninstall') && !existsSync(ASAR) && existsSync(ASIDE)) {
    renameSync(ASIDE, ASAR);
    progress('asar-back', 40, 'app.asar 已放回');
  }

  if (MODE === 'uninstall') {
    progress('restore-files', 50, '按 asar 原件还原宿主文件');
    const web = await import(pathToFileURL(join(ROOT, 'web', 'host.mjs')).href);
    let restored = null;
    try {
      restored = await web.factoryRestore();
      progress('restore-files', 65, `已还原 ${restored && restored.restored || 0} 个文件`);
    } catch (e) {
      log('factoryRestore failed: ' + (e && e.message));
      progress('restore-files', 65, '还原失败：' + (e && e.message));
    }
    progress('clean-leftovers', 75, '清理解包残留 / 开机自启');
    let cleaned = null;
    try {
      cleaned = await web.cleanPurgeLeftovers();
      progress('clean-leftovers', 85, `已清 ${cleaned && cleaned.freedMB || 0} MB`);
    } catch (e) {
      log('cleanPurgeLeftovers failed: ' + (e && e.message));
    }
    progress('restore', 90, '还原完成');
  } else {
    progress('mode', 50, MODE === 'land' ? '已让位，准备重启' : '准备重启');
  }

  progress('launch', 92, '重新拉起宿主');
  spawn(EXE, [], { detached: true, stdio: 'ignore' }).unref();

  let last = { count: 0, hasAsar: false, hasApp: false, hasRenderer: false };
  let healthy = false;
  for (let i = 0; i < 35; i++) {
    await sleep(1000);
    last = await hostProcs();
    if (last.hasRenderer && (MODE === 'land' ? last.hasApp : true)) { healthy = true; break; }
    if (last.count === 0) break;
  }
  log('verify: count=' + last.count + ' renderer=' + last.hasRenderer + ' fromApp=' + last.hasApp);

  if (MODE === 'land' && !healthy) {
    progress('rollback', 95, '健康检查失败，回滚');
    await new Promise((r) => execFile('taskkill', ['/IM', 'DeepSeek Harness.exe', '/F'], () => r()));
    await sleep(2500);
    try { renameSync(ASIDE, ASAR); } catch (e) { log('rollback rename failed: ' + (e && e.message)); }
    spawn(EXE, [], { detached: true, stdio: 'ignore' }).unref();
    finish({ ok: false, error: 'launch_not_healthy', detail: last, rolledBack: true, console: await ensureConsole() });
  }

  const consoleState = await ensureConsole();
  progress('done', 100, '宿主已拉起，控制台已就绪');
  finish({ ok: true, healthy, processes: last.count, asarExists: existsSync(ASAR), asideExists: existsSync(ASIDE), console: consoleState });
} catch (e) {
  log('fatal: ' + (e && e.message));
  progress('fatal', 100, String((e && e.message) || e));
  finish({ ok: false, error: 'fatal', detail: String((e && e.message) || e), console: await ensureConsole() });
}
