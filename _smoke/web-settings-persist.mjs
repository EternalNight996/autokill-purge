#!/usr/bin/env node
// FR-7 probe: the settings page's breakDir / pluginPath must survive a server restart.
// Starts its own web/server.mjs on a free port, backs up data/state.json, restores it at the end.
//
//   node _smoke/web-settings-persist.mjs
//
// Exit 0 = all PASS, 1 = any FAIL or harness error.

import { spawn } from 'node:child_process';
import { openSync, closeSync, mkdtempSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = join(ROOT, 'web', 'server.mjs');
const STATE = join(ROOT, 'data', 'state.json');
const PORT = Number(process.env.PROBE_PORT || 8796);
const BASE = 'http://127.0.0.1:' + PORT;

const work = mkdtempSync(join(tmpdir(), 'ap-settings-probe-'));
const backup = join(work, 'state.json.bak');
const hadState = existsSync(STATE);
if (hadState) copyFileSync(STATE, backup);

let n = 0;
let failed = 0;
function check(name, ok, detail) {
  n += 1;
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${String(n).padStart(2)}. ${name}${detail ? ' — ' + detail : ''}`);
}

async function req(path, opts) {
  const res = await fetch(BASE + path, opts);
  let body = null;
  try { body = await res.json(); } catch {}
  return { status: res.status, body };
}

function start() {
  const out = openSync(join(work, `server-${Date.now()}.out.log`), 'w');
  const err = openSync(join(work, `server-${Date.now()}.err.log`), 'w');
  const child = spawn(process.execPath, [SERVER], {
    cwd: ROOT,
    env: { ...process.env, PURGE_WEB_PORT: String(PORT) },
    stdio: ['ignore', out, err],
    windowsHide: true,
  });
  child.on('exit', () => { try { closeSync(out); } catch {} try { closeSync(err); } catch {} });
  return child;
}

async function waitPing(child) {
  for (let i = 0; i < 100; i += 1) {
    if (child.exitCode !== null) return false;
    try {
      const r = await fetch(BASE + '/api/ping');
      if (r.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

function stop(child) {
  return new Promise((res) => {
    if (child.exitCode !== null) return res();
    const t = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} res(); }, 5000);
    child.once('exit', () => { clearTimeout(t); res(); });
    try { child.kill(); } catch { clearTimeout(t); res(); }
  });
}

function restore() {
  try {
    if (hadState) copyFileSync(backup, STATE);
    else rmSync(STATE, { force: true });
  } catch {}
  try { rmSync(work, { recursive: true, force: true }); } catch {}
}

let first = null;
let second = null;
try {
  first = start();
  check('server 可达', await waitPing(first), BASE + '/api/ping');

  let r = await req('/api/agreement', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accepted: true, signer: 'settings-probe' }),
  });
  check('签署协议', r.status === 200 && r.body && r.body.ok === true, `status=${r.status}`);

  r = await req('/api/state');
  const base = r.body && r.body.state && r.body.state.settings;
  check('读取初始设置', r.status === 200 && !!base, base ? `breakDir=${base.breakDir}` : `status=${r.status}`);

  r = await req('/api/settings', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ breakDir: 'D:\\autokill-purge\\break-probe', pluginPath: 'D:\\probe\\purge.wasm' }),
  });
  const posted = r.body && r.body.settings;
  check('POST 后立即生效', r.status === 200 && posted
    && posted.breakDir === 'D:\\autokill-purge\\break-probe'
    && posted.pluginPath === 'D:\\probe\\purge.wasm', posted ? `breakDir=${posted.breakDir}` : `status=${r.status}`);

  await stop(first);
  second = start();
  const up = await waitPing(second);
  check('重启后 server 可达', up, BASE);

  r = await req('/api/state');
  const after = r.body && r.body.state && r.body.state.settings;
  check('重启后 breakDir 保留', !!after && after.breakDir === 'D:\\autokill-purge\\break-probe', after ? `breakDir=${after.breakDir}` : `status=${r.status}`);
  check('重启后 pluginPath 保留', !!after && after.pluginPath === 'D:\\probe\\purge.wasm', after ? `pluginPath=${after.pluginPath}` : `status=${r.status}`);

  r = await req('/api/settings', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pluginPath: '' }),
  });
  const cleared = r.body && r.body.settings;
  check('pluginPath 空串可清空', r.status === 200 && cleared && cleared.pluginPath === '', cleared ? `pluginPath="${cleared.pluginPath}"` : `status=${r.status}`);

  const keep = cleared ? cleared.breakDir : null;
  r = await req('/api/settings', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ breakDir: '' }),
  });
  const kept = r.body && r.body.settings;
  check('breakDir 空串不清空', r.status === 200 && !!kept && kept.breakDir === keep, kept ? `breakDir=${kept.breakDir}` : `status=${r.status}`);
} catch (e) {
  check('probe 未抛异常', false, String(e && e.message ? e.message : e));
} finally {
  if (first) await stop(first);
  if (second) await stop(second);
  restore();
}

console.log('');
console.log(`结果: ${n - failed}/${n} PASS`);
if (failed) process.exit(1);
console.log('ALL PASS');
