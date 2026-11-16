// 调 memory-eternal 自带 CLI（dsh-memory）来管隔离库：只放只读查询 + 受控的 restart/stop。
//
// 关键约束（写死的，不接受外部传参）：
//   restart / stop 永远带 --port 7989 --vault ~/.dsh/memory-vault-mem-purge
//   —— 它这版 CLI 的 watchdog 子进程会走 vault-pref 的 activeVault（默认指向运营库），
//   只有显式 --vault 才能保证不误连 7999。
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { readDeploy } from './deploy.mjs';

function memPort() { return readDeploy().port; }

function home() {
  return process.env.USERPROFILE || process.env.HOME || '';
}
export function cliPath() {
  return join(home(), '.dsh', 'profiles', 'desktop', 'node_modules', 'memory-eternal', 'bin', 'dsh-memory.mjs');
}
export function isolatedVault() {
  return readDeploy().vault;
}

const READ_ONLY = new Set(['status', 'ledger', 'audit-list']);

function run(args, opts = {}) {
  const timeoutMs = opts.timeoutMs || 25000;
  // CLI 的 audit/ledger 不认 --vault，只认 MEMORY_VAULT_DIR —— 必须显式给，否则读的是运营库
  const env = Object.assign({}, process.env);
  if (opts.vault) env.MEMORY_VAULT_DIR = opts.vault;
  return new Promise((resolve) => {
    const file = cliPath();
    if (!existsSync(file)) return resolve({ ok: false, error: 'cli_missing', path: file });
    execFile(process.execPath, [file, ...args], { timeout: timeoutMs, windowsHide: true, env: env, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      const out = String(stdout || '').trim();
      const errOut = String(stderr || '').trim();
      let json = null;
      try { json = JSON.parse(out); } catch { /* 非 JSON 命令 */ }
      resolve({
        ok: !err || (json && json.ok !== false),
        code: err && typeof err.code === 'number' ? err.code : 0,
        json: json,
        stdout: json ? null : out.slice(0, 8000),
        stderr: errOut.slice(0, 2000) || null,
      });
    });
  });
}

async function health() {
  try {
    const r = await fetch('http://127.0.0.1:' + memPort() + '/memory-eternal/api/health');
    const d = await r.json();
    return { reachable: true, version: d.version, vault: d.vault, db: d.db, quarantined: d.quarantined, cards: d.cards };
  } catch (e) {
    return { reachable: false, error: String((e && e.message) || e) };
  }
}

export async function memCliStatus() {
  const [st, h] = await Promise.all([run(['status', '--port', String(memPort()), '--json'], { vault: isolatedVault() }), health()]);
  const watchdogs = (st.json && st.json.watchdogs) || [];
  return {
    ok: true,
    port: memPort(),
    vault: isolatedVault(),
    cli: cliPath(),
    health: h,
    watchdogs: watchdogs.map((w) => ({ pid: w.pid, port: w.port, vault: w.vault, alive: w.alive, webPid: w.webPid, webAlive: w.webAlive, version: w.pkgVersion })),
    pkgVersion: (st.json && st.json.pkgVersion) || null,
    servedVersion: (st.json && st.json.servedVersion) || null,
  };
}

/** 重启：先用 watchdog 托管（带显式 vault），失败则回落到裸 web.js（同样带 --vault） */
export async function memCliRestart() {
  const vault = isolatedVault();
  const r = await run(['restart', '--port', String(memPort()), '--vault', vault], { timeoutMs: 40000, vault: vault });
  await new Promise((res) => setTimeout(res, 2500));
  const h = await health();
  // 自检：vault 必须落在隔离目录，否则说明误连了运营库 —— 立刻停掉 watchdog
  const wrongVault = h.reachable && String(h.vault || '').indexOf('memory-vault-mem-purge') < 0;
  if (wrongVault) {
    await run(['stop', '--port', String(memPort()), '--json'], { timeoutMs: 20000, vault: isolatedVault() });
    return {
      ok: false,
      error: 'vault_mismatch',
      detail: 'CLI 的 watchdog 起在了 ' + h.vault + '（运营库），已立即停掉；请用启动器（scripts/launch.mjs）带 --vault 起。',
      health: h,
      cli: { code: r.code, stderr: r.stderr },
    };
  }
  return { ok: r.ok && h.reachable, stdout: r.stdout, stderr: r.stderr, health: h };
}

export async function memCliStop() {
  const r = await run(['stop', '--port', String(memPort()), '--json'], 20000);
  await new Promise((res) => setTimeout(res, 1200));
  return { ok: r.ok, json: r.json, stdout: r.stdout, health: await health() };
}

export async function memCliLedger(days = 7) {
  const r = await run(['ledger', '--days', String(Math.min(Math.max(Number(days) || 7, 1), 90)), '--json'], { vault: isolatedVault() });
  return { ok: r.ok, json: r.json, stdout: r.stdout, stderr: r.stderr };
}

export async function memCliAuditList(status = 'pending') {
  const r = await run(['audit', 'list', '--status', status, '--json'], { vault: isolatedVault() });
  return { ok: r.ok, json: r.json, stdout: r.stdout, stderr: r.stderr };
}

export function readOnlyCommand(name) {
  return READ_ONLY.has(name);
}
