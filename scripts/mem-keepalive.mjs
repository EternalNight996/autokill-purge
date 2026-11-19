// 隔离库保活：因为 memory-eternal 自带的 watchdog 拉 web 时「vault-pref 的 activeVault 优先于 --vault」，
// 而本机 activeVault 指向运营库 —— 用它托管 7989 会静默起在运营库上。所以这里自己保活：
//   探 http://127.0.0.1:<port>/memory-eternal/api/health → 不通就 spawn web.js --port --vault
//   每次拉起后核对 vault 必须落在 memory-vault-<dbName>，不对立刻 kill 并告警。
//
// 端口与库名读 data/deploy.json（设置页可一键切换）。
// 用法：node scripts/mem-keepalive.mjs [--interval 10000] [--once]
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureMemHome, memEnv } from './mem-home.mjs';
import { resolveMemRoot } from '../lib/mem-runtime.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]+$/, '');
const HOME = process.env.USERPROFILE || process.env.HOME || '';
const LOG_DIR = join(HOME, '.dsh', 'autokill-purge-logs');
const PID_FILE = join(HOME, '.dsh', 'autokill-purge-data', 'keepalive.pid');
// 运行时走 autokill-purge 自维护副本（profile 那份只作回退），与 DSH 插件版本解耦
const MEM_ROOT = resolveMemRoot().root || join(HOME, '.dsh', 'profiles', 'desktop', 'node_modules', 'memory-eternal');

const argv = process.argv.slice(2);
const argOf = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const ONCE = argv.includes('--once');
const INTERVAL = Number(argOf('--interval', 10000));

function readDeploy() {
  const def = { port: 7989, dbName: 'mem-purge' };
  try {
    const raw = JSON.parse(readFileSync(join(HOME, '.dsh', 'autokill-purge-data', 'deploy.json'), 'utf8'));
    if (raw && Number(raw.port)) def.port = Number(raw.port);
    if (raw && raw.dbName) def.dbName = String(raw.dbName);
  } catch { /* 用默认 */ }
  def.vault = join(HOME, '.dsh', 'memory-vault-' + def.dbName);
  return def;
}

function log(msg) {
  mkdirSync(LOG_DIR, { recursive: true });
  const line = '[' + new Date().toISOString() + '] ' + msg;
  console.log(line);
  try { writeFileSync(join(LOG_DIR, 'keepalive.log'), line + '\n', { flag: 'a' }); } catch { /* 忽略 */ }
}

async function health(port) {
  try {
    const r = await fetch('http://127.0.0.1:' + port + '/memory-eternal/api/health', { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

function spawnWeb(port, vault, dbName) {
  mkdirSync(vault, { recursive: true });
  mkdirSync(LOG_DIR, { recursive: true });
  const web = join(MEM_ROOT, 'lib', 'web.js');
  if (!existsSync(web)) throw new Error('找不到 web.js：' + web);
  const out = openSync(join(LOG_DIR, 'memory-' + port + '.log'), 'a');
  // 独立家目录（配置/偏好/看门狗注册表都在里面）+ 显式 vault，避免看门狗把实例拽回运营库
  ensureMemHome({ port, dbName });
  const child = spawn(process.execPath, [web, '--port', String(port), '--vault', vault], {
    detached: true,
    stdio: ['ignore', out, out],
    windowsHide: true,
    env: memEnv(vault),
  });
  child.unref();
  return child.pid;
}

// DSH / MengBot 的主记忆端口：任何情况下都不许碰（deploy.json 被人改成这两个也要拦住）
const PROTECTED_PORTS = new Set([7989, 7999]);

async function tick() {
  const d = readDeploy();
  if (PROTECTED_PORTS.has(Number(d.port))) {
    log('⚠ deploy.json 的端口 ' + d.port + ' 属于 DSH/MengBot 主记忆，拒绝保活，请把 port 改成独立端口');
    return;
  }
  const h = await health(d.port);
  if (h) {
    const okVault = String(h.vault || '').indexOf('memory-vault-' + d.dbName) >= 0;
    if (!okVault) {
      log('⚠ 端口 ' + d.port + ' 上跑的不是 ' + d.dbName + '（vault=' + h.vault + '），正在纠正');
      try {
        const { execFileSync } = await import('node:child_process');
        execFileSync('powershell', ['-NoProfile', '-Command',
          `$c = Get-NetTCPConnection -LocalPort ${d.port} -State Listen -ErrorAction SilentlyContinue; if ($c) { $c | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } }`],
          { windowsHide: true });
      } catch { /* 忽略 */ }
      await new Promise((r) => setTimeout(r, 900));
      const pid = spawnWeb(d.port, d.vault, d.dbName);
      log('按 ' + d.dbName + ' 重新拉起（pid ' + pid + '）');
    }
    return;
  }
  const pid = spawnWeb(d.port, d.vault, d.dbName);
  log('端口 ' + d.port + ' 不通 → 拉起 web.js（pid ' + pid + '，vault ' + d.vault + '）');
  await new Promise((r) => setTimeout(r, 2500));
  const h2 = await health(d.port);
  if (h2 && String(h2.vault || '').indexOf('memory-vault-' + d.dbName) >= 0) {
    log('拉起成功：v' + h2.version + ' · ' + String(h2.vault).split('\\').pop() + ' · quarantined ' + h2.quarantined);
  } else {
    log('⚠ 拉起后核对失败：' + (h2 ? JSON.stringify({ vault: h2.vault }) : '仍不可达'));
  }
}

function lockSelf() {
  mkdirSync(join(HOME, '.dsh', 'autokill-purge-data'), { recursive: true });
  try {
    const old = Number(readFileSync(PID_FILE, 'utf8').trim());
    if (old && old !== process.pid) {
      try { process.kill(old, 0); log('已有保活进程在跑（pid ' + old + '），本进程退出'); process.exit(0); } catch { /* 旧的已死 */ }
    }
  } catch { /* 没锁 */ }
  writeFileSync(PID_FILE, String(process.pid), 'utf8');
}

function unlock() {
  try {
    if (Number(readFileSync(PID_FILE, 'utf8').trim()) === process.pid) rmSync(PID_FILE, { force: true });
  } catch { /* 忽略 */ }
}

if (!ONCE) lockSelf();
const d0 = readDeploy();
log('保活启动：端口 ' + d0.port + ' · 库 ' + d0.dbName + ' · 间隔 ' + INTERVAL + 'ms' + (ONCE ? '（单次）' : ''));

if (ONCE) {
  await tick();
  process.exit(0);
}

await tick();
setInterval(() => { tick().catch((e) => log('tick 异常：' + (e && e.message))); }, INTERVAL);
process.on('SIGINT', () => { unlock(); process.exit(0); });
process.on('SIGTERM', () => { unlock(); process.exit(0); });
