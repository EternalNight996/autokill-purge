// 私有部署的「库名 + 端口」切换：单一真源是 data/deploy.json。
//
// 一键切换做的事：
//   1) 校验 port / dbName
//   2) 停旧端口的实例（以及可能的 watchdog）
//   3) （可选）把旧 vault 的 db 复制到新 vault
//   4) 用新端口 + 新 vault 起一个 web.js（与 scripts/launch.mjs 同一条路径，带显式 --vault）
//   5) 等 health 就绪并核对 vault 真的落在新库上
//   6) 成功才写 deploy.json；失败回滚到旧配置并重启旧实例
import { spawn, execFile } from 'node:child_process';
import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ensureMemHome, memEnv } from '../scripts/mem-home.mjs';
import { resolveMemRoot } from '../lib/mem-runtime.mjs';

const DEFAULTS = { port: 17890, dbName: 'mem-purge', entryHash: '#/breach' };
const NAME_RE = /^[a-z0-9][a-z0-9-]{1,40}$/;

function home() {
  return process.env.USERPROFILE || process.env.HOME || '';
}
export function dataDir() {
  return join(home(), '.dsh', 'autokill-purge-data');
}
function deployFile() {
  return join(dataDir(), 'deploy.json');
}
function logDir() {
  return join(home(), '.dsh', 'autokill-purge-logs');
}

export function vaultFor(dbName) {
  return join(home(), '.dsh', 'memory-vault-' + dbName);
}

export function readDeploy() {
  const out = Object.assign({}, DEFAULTS);
  try {
    const raw = JSON.parse(readFileSync(deployFile(), 'utf8'));
    if (raw && Number(raw.port)) out.port = Number(raw.port);
    if (raw && NAME_RE.test(String(raw.dbName || ''))) out.dbName = String(raw.dbName);
    if (raw && raw.entryHash) out.entryHash = String(raw.entryHash);
  } catch { /* 没有就用默认 */ }
  out.vault = vaultFor(out.dbName);
  out.memoryBase = 'http://127.0.0.1:' + out.port + '/memory-eternal/api';
  out.uiBase = 'http://127.0.0.1:' + out.port;
  out.file = deployFile();
  return out;
}

function writeDeploy(port, dbName) {
  mkdirSync(dataDir(), { recursive: true });
  // 切换库/端口不该改入口：保留用户当前的 entryHash（默认破甲页，不再默认进记忆）
  let entryHash = DEFAULTS.entryHash;
  try { const cur = JSON.parse(readFileSync(deployFile(), 'utf8')); if (cur && cur.entryHash) entryHash = String(cur.entryHash); } catch { /* 首次写入用默认 */ }
  writeFileSync(deployFile(), JSON.stringify({ port: Number(port), dbName: String(dbName), entryHash: entryHash, at: new Date().toISOString() }, null, 2) + '\n', 'utf8');
}

function portOpen(port, timeoutMs = 700) {
  return new Promise((resolve) => {
    // 用 PowerShell 探活，避免额外依赖
    execFile('powershell', ['-NoProfile', '-Command', `(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue) -ne $null`], { windowsHide: true, timeout: timeoutMs + 2500 }, (e, so) => {
      resolve(String(so || '').trim().toLowerCase() === 'true');
    });
  });
}

function killPort(port) {
  return new Promise((resolve) => {
    execFile('powershell', ['-NoProfile', '-Command',
      `$c = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue; if ($c) { $c | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }; 'killed' } else { 'none' }`],
      { windowsHide: true, timeout: 12000 }, (e, so) => resolve(String(so || '').trim()));
  });
}

async function waitHealth(port, ms = 25000) {
  const started = Date.now();
  while (Date.now() - started < ms) {
    try {
      const r = await fetch('http://127.0.0.1:' + port + '/memory-eternal/api/health');
      if (r.ok) return await r.json();
    } catch { /* 还没起来 */ }
    await new Promise((res) => setTimeout(res, 500));
  }
  return null;
}

function spawnWeb(port, vault) {
  mkdirSync(vault, { recursive: true });
  mkdirSync(logDir(), { recursive: true });
  // 运行时优先用 autokill-purge 自己维护的副本（~/.dsh/autokill-purge/runtime/…），
  // profile 里那份只作回退 —— 这样 DSH 插件升级/重装不会把控制台的记忆服务带崩。
  const { root: memRoot, source: memSource } = resolveMemRoot();
  const web = memRoot ? join(memRoot, 'lib', 'web.js') : '';
  if (!web || !existsSync(web)) {
    throw new Error('找不到 memory-eternal 运行时：先跑 node scripts/ensure-mem-runtime.mjs（当前 source=' + memSource + '）');
  }
  const out = join(logDir(), 'memory-' + port + '.log');
  // 独立家目录 + 显式 vault：否则 memory-eternal 的看门狗会按公共偏好把实例拽回运营库
  const dbName = String(vault).split(/[\\/]/).pop().replace(/^memory-vault-/, '');
  const MEM = ensureMemHome({ port, dbName });
  const env = memEnv(vault, { MEMORY_VAULT_DIR: vault });
  const child = spawn(process.execPath, [web, '--port', String(port), '--vault', vault], {
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore'],
    windowsHide: true,
    env,
  });
  child.unref();
  return { pid: child.pid, log: out, home: MEM.home };
}

/** 把旧库的 sqlite 拷进新 vault（新 vault 里没有 db 时才拷，避免覆盖） */
function migrateDb(fromVault, toVault) {
  const files = ['memory-eternal.db', 'memory-eternal.db-wal', 'memory-eternal.db-shm'];
  mkdirSync(toVault, { recursive: true });
  const existing = readdirSync(toVault).filter((f) => /^memory-eternal\.db$/.test(f));
  if (existing.length) return { copied: 0, reason: 'new_vault_has_db' };
  let copied = 0;
  for (const f of files) {
    const src = join(fromVault, f);
    if (!existsSync(src)) continue;
    try { copyFileSync(src, join(toVault, f)); copied++; } catch { /* 跳过 */ }
  }
  return { copied: copied };
}

export async function switchDeploy({ port, dbName, migrate = false }) {
  const cur = readDeploy();
  const nextPort = Number(port) || cur.port;
  const nextDb = String(dbName || cur.dbName).trim();
  if (nextPort < 1024 || nextPort > 65535) return { ok: false, error: 'bad_port', detail: '端口要在 1024–65535' };
  if (nextPort === 8792) return { ok: false, error: 'bad_port', detail: '8792 是控制台自己的端口' };
  if (!NAME_RE.test(nextDb)) return { ok: false, error: 'bad_dbname', detail: '库名小写字母/数字/连字符，2–41 位，需字母数字开头' };
  if (nextPort === cur.port && nextDb === cur.dbName) return { ok: true, unchanged: true, deploy: cur };

  const nextVault = vaultFor(nextDb);
  const steps = [];

  // 1) 停旧
  await killPort(cur.port);
  steps.push(`停旧实例 ${cur.port}`);
  await new Promise((r) => setTimeout(r, 800));

  // 2) 迁移（可选）
  let migration = null;
  if (migrate && cur.dbName !== nextDb) {
    migration = migrateDb(cur.vault, nextVault);
    steps.push(`迁移数据：复制 ${migration.copied} 个文件${migration.reason ? '（' + migration.reason + '）' : ''}`);
  }

  // 3) 起新
  const launched = spawnWeb(nextPort, nextVault);
  steps.push(`起新实例 :${nextPort}（pid ${launched.pid}）`);
  const health = await waitHealth(nextPort);

  // 4) 核对
  const vaultOk = !!(health && String(health.vault || '').indexOf('memory-vault-' + nextDb) >= 0);
  if (!health || !vaultOk) {
    // 回滚：停新、起旧、写回旧配置
    await killPort(nextPort);
    writeDeploy(cur.port, cur.dbName);
    const back = spawnWeb(cur.port, cur.vault);
    const h2 = await waitHealth(cur.port);
    return {
      ok: false,
      error: health ? 'vault_mismatch' : 'health_timeout',
      detail: health ? '新实例 vault=' + health.vault + '，不是 ' + nextVault : '新实例 25s 没起来，看 ' + launched.log,
      rolledBack: true,
      rolledBackHealth: h2 ? { version: h2.version, vault: h2.vault } : null,
      steps: steps,
    };
  }

  writeDeploy(nextPort, nextDb);
  steps.push('写 deploy.json');
  return {
    ok: true,
    deploy: readDeploy(),
    health: { version: health.version, vault: health.vault, db: health.db, quarantined: health.quarantined, cards: health.cards },
    migration: migration,
    steps: steps,
  };
}
