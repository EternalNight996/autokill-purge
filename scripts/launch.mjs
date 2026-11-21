// 启动器：桌面图标与开机自启都指向这里。
//
// 做三件事（都可重复执行，已经在跑就跳过）：
//   1) 记忆库（隔离库 mem-purge，端口取自 deploy.json，默认 7989）
//   2) 控制台 8792
//   3) 打开浏览器到控制台
//
// 用法：node scripts/launch.mjs [--no-open] [--quiet]
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, openSync, mkdirSync, readFileSync as readFileSyncSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import { ensureMemHome, memEnv } from './mem-home.mjs';
import { resolveMemRoot } from '../lib/mem-runtime.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const HOME = process.env.USERPROFILE || process.env.HOME || '';
// 端口与库名来自 data/deploy.json（设置页可一键切换），环境变量仍可覆盖
function readDeployCfg() {
  const def = { port: 7989, dbName: 'mem-purge', entryHash: '#/breach' };
  try {
    const raw = JSON.parse(readFileSyncSync(join(process.env.USERPROFILE || '', '.dsh', 'autokill-purge-data', 'deploy.json'), 'utf8'));
    if (raw && Number(raw.port)) def.port = Number(raw.port);
    if (raw && raw.dbName) def.dbName = String(raw.dbName);
    // 入口默认是破甲页；deploy.json 里显式配了才跟随（记忆页只在用户自己切过去时进）
    if (raw && raw.entryHash) def.entryHash = String(raw.entryHash);
  } catch { /* 用默认 */ }
  return def;
}
const CFG = readDeployCfg();
const MEM_PORT = Number(process.env.MEM_PURGE_PORT || CFG.port);
const WEB_PORT = Number(process.env.PURGE_WEB_PORT || 8792);
// 用控制台自维护的运行时副本（钉死版本），profile 那份只作最后回退；见 lib/mem-runtime.mjs
const MEM_RESOLVED = resolveMemRoot();
const MEM_ROOT = MEM_RESOLVED.root || '';
const MEM_VAULT = process.env.MEM_PURGE_VAULT || join(HOME, '.dsh', 'memory-vault-' + CFG.dbName);
const LOG_DIR = join(HOME, '.dsh', 'autokill-purge-logs');

const QUIET = process.argv.includes('--quiet');
const NO_OPEN = process.argv.includes('--no-open');

function say(...args) {
  if (!QUIET) console.log(...args);
}

function portOpen(port, timeoutMs = 800) {
  return new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port });
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      try { sock.destroy(); } catch { /* ignore */ }
      resolve(v);
    };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => finish(true));
    sock.once('timeout', () => finish(false));
    sock.once('error', () => finish(false));
  });
}

function detached(file, args, opts = {}) {
  mkdirSync(LOG_DIR, { recursive: true });
  const out = openSync(join(LOG_DIR, (opts.tag || 'proc') + '.log'), 'a');
  const child = spawn(file, args, {
    detached: true,
    stdio: ['ignore', out, out],
    windowsHide: true,
    cwd: opts.cwd || ROOT,
    env: opts.env || process.env,
  });
  child.unref();
  return child.pid;
}

/** 探端口上的记忆库实际用的是哪个库（空串 = 探不到） */
async function healthVault(port) {
  try {
    const r = await fetch('http://127.0.0.1:' + port + '/memory-eternal/api/health', { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return '';
    const j = await r.json();
    return String(j.vault || '');
  } catch { return ''; }
}

/** 只杀指定端口的监听进程（端口来自 deploy.json，不会碰 7989/7999） */
function killPort(port) {
  try {
    execFileSync('powershell', ['-NoProfile', '-Command',
      `$c = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue; if ($c) { $c | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } }`],
      { windowsHide: true });
  } catch { /* 忽略 */ }
}

async function waitPort(port, ms = 20000) {
  const started = Date.now();
  while (Date.now() - started < ms) {
    if (await portOpen(port)) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

async function main() {
  // 0) 先钉死自己的记忆家目录：memory-eternal 的 config / 当前库偏好 / 看门狗注册表 / 沉淀流水
  //    全部落在 DSH_HOME 下，重定向后与 DSH / MengBot 的主记忆彻底分开（详见 scripts/mem-home.mjs）。
  //    不这么做的话，看门狗重启 web 时会读公共偏好文件，把实例拽回运营库。
  const MEM = ensureMemHome({ port: MEM_PORT, dbName: CFG.dbName });
  say(`记忆家目录 ${MEM.home} · 库 ${CFG.dbName} · 端口 ${MEM_PORT}`);

  // 1) 记忆库：端口在跑但库不对（典型是看门狗把实例拽回了运营库）就按 deploy.json 纠正
  const memVaultTag = 'memory-vault-' + CFG.dbName;
  let needSpawn = true;
  if (await portOpen(MEM_PORT)) {
    const v = await healthVault(MEM_PORT);
    if (v && v.indexOf(memVaultTag) >= 0) {
      say(`记忆库 ${MEM_PORT} 已在运行（${CFG.dbName}）`);
      needSpawn = false;
    } else {
      say(`⚠ 端口 ${MEM_PORT} 上跑的是 ${v || '未知库'}，不是 ${CFG.dbName} → 重起纠正`);
      killPort(MEM_PORT);
      await new Promise((r) => setTimeout(r, 900));
    }
  }
  if (needSpawn) {
    if (!MEM_ROOT || !existsSync(join(MEM_ROOT, 'lib', 'web.js'))) {
      console.error('找不到 memory-eternal 运行时：自维护副本与 profile 回退都不可用（先跑 node scripts/ensure-mem-runtime.mjs）');
      process.exit(2);
    }
    say(`运行时 ${MEM_RESOLVED.source} · ${MEM_RESOLVED.version} · ${MEM_ROOT}`);
    mkdirSync(MEM.vault, { recursive: true });
    const pid = detached(process.execPath, [join(MEM_ROOT, 'lib', 'web.js'), '--port', String(MEM_PORT), '--vault', MEM.vault], { tag: 'memory', env: memEnv(MEM.vault) });
    say(`记忆库 ${MEM_PORT} 启动中（pid ${pid}）`);
    const ok = await waitPort(MEM_PORT);
    if (ok) {
      const v = await healthVault(MEM_PORT);
      say(v && v.indexOf(memVaultTag) >= 0
        ? `记忆库 ${MEM_PORT} 就绪（${CFG.dbName}）`
        : `⚠ 记忆库 ${MEM_PORT} 起来了但库是 ${v || '未知'}（期望 ${CFG.dbName}）`);
    } else {
      say(`记忆库 ${MEM_PORT} 没起来，看 ${join(LOG_DIR, 'memory.log')}`);
    }
  }

  // 2) 控制台
  if (await portOpen(WEB_PORT)) {
    say(`控制台 ${WEB_PORT} 已在运行`);
  } else {
    // 控制台**不继承**独立 DSH_HOME：它要操作的是宿主 DSH（83 补丁 / 规则 / 技能 / prompt 都在宿主家目录）。
    // 记忆库子进程的隔离由 web/deploy.mjs 里的 memEnv() 显式注入，不依赖这里。
    const pid = detached(process.execPath, [join(ROOT, 'web', 'server.mjs')], { tag: 'web', cwd: ROOT });
    say(`控制台 ${WEB_PORT} 启动中（pid ${pid}）`);
    const ok = await waitPort(WEB_PORT);
    say(ok ? `控制台 ${WEB_PORT} 就绪` : `控制台 ${WEB_PORT} 没起来，看 ${join(LOG_DIR, 'web.log')}`);
  }

  // 3) 打开浏览器
  // 私有部署固定入口：直接进记忆库
  const ENTRY = process.env.PURGE_ENTRY || `http://127.0.0.1:${WEB_PORT}/${CFG.entryHash}`;
  const url = ENTRY;
  if (!NO_OPEN) {
    try {
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
      say(`已在浏览器打开 ${url}`);
    } catch {
      say(`打不开浏览器，手动访问 ${url}`);
    }
  }
}

main().catch((e) => {
  console.error('启动失败：' + (e && e.message ? e.message : e));
  process.exit(1);
});
