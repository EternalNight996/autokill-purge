#!/usr/bin/env node
// autokill-purge · UX-2LAYER server-side acceptance (docs/UX-2LAYER-CONTRACT.md §1).
//
// Only the part of the 16 ACs that can be decided without a browser lives here (readiness shape,
// protocol gate, uiMode persistence + 400, response budget, settings regression). DOM cases belong to
// test/ux2layer-ui.mjs.
//
// Usage (needs a RUNNING node web/server.mjs — this script never starts one):
//   node test/ux2layer.mjs                                  # against 8792
//   $env:PURGE_WEB_BASE='http://127.0.0.1:8793'; node test/ux2layer.mjs
//
// Env: PURGE_WEB_BASE (default http://127.0.0.1:$PORT), PORT (default 8792).
// Exit code: 0 = every check passed; 1 = at least one FAIL (or the server was not reachable).
//
// Safety: it resets/restores the agreement signature and drives settings through the API only; it
// always leaves uiMode back at 'simple' and never writes data/state.json directly.

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = String(process.env.PURGE_WEB_BASE || 'http://127.0.0.1:' + Number(process.env.PORT || 8792)).replace(/\/+$/, '');
const RESULTS = join(HERE, 'ux2layer-results.txt');
const BUDGET_READINESS = 2000;
const REQ_TIMEOUT = 15000;
const MEMORY_BASE = 'http://127.0.0.1:7999/memory-eternal/api';

const lines = [];
const results = [];

function log(text = '') { lines.push(text); console.log(text); }
function check(name, ok, detail = '') {
  const pass = !!ok;
  results.push({ name, ok: pass, detail });
  log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}
function save() {
  try { writeFileSync(RESULTS, lines.join('\n') + '\n', 'utf8'); } catch (e) { console.log('WARN: 结果文件写入失败 — ' + String((e && e.message) || e)); }
}
function errText(e) {
  return String((e && e.cause && e.cause.code) || (e && e.message) || e);
}

async function api(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    signal: AbortSignal.timeout(REQ_TIMEOUT),
    headers: {
      accept: 'application/json',
      ...(opts.body ? { 'content-type': 'application/json' } : {}),
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, ok: res.ok, data, text };
}
const settingsOf = (resp) => (resp && resp.data && resp.data.state && resp.data.state.settings) || {};

async function main() {
  log('autokill-purge · UX-2LAYER server-side acceptance (contract §1)');
  log('base: ' + BASE);
  log('');

  // ---- 1. server reachable ------------------------------------------------
  let ping = null;
  let netErr = '';
  try { ping = await api('/api/ping'); } catch (e) { netErr = errText(e); }
  const up = !!ping && ping.status === 200 && ping.data && ping.data.ok === true;
  check('1. /api/ping 可达', up, up ? 'HTTP 200 · version ' + ping.data.version : (ping ? 'HTTP ' + ping.status : '连接失败: ' + netErr));
  if (!up) {
    log('');
    log('FATAL: 服务没起（' + BASE + '）。本脚本不负责启动服务，先自己起一个再用同一个地址重跑：');
    log("  1) PowerShell 起服务（换一个空端口，别动正式实例 8792）：");
    log('       $env:PURGE_WEB_PORT=8793; node web/server.mjs');
    log('  2) 另开一个窗口，把地址对上再跑本脚本：');
    log('       $env:PURGE_WEB_BASE=\'http://127.0.0.1:8793\'; node test/ux2layer.mjs');
    log('');
    log('summary: 0/1');
    save();
    process.exitCode = 1;
    return;
  }

  // ---- 2. protocol gate: unsigned -> 403 ----------------------------------
  const st0 = await api('/api/state');
  const wasSigned = st0.status === 200 && !!(st0.data && st0.data.state && st0.data.state.agreement && st0.data.state.agreement.accepted === true);
  const originalSigner = (st0.data && st0.data.state && st0.data.state.agreement && st0.data.state.agreement.signer) || 'ux2layer';
  if (wasSigned) {
    const reset = await api('/api/agreement/reset', { method: 'POST', body: '{}' });
    log(`note: 现场已签署，先 reset 再测协议门（HTTP ${reset.status}）`);
  }
  const unsigned = await api('/api/readiness');
  check('2. 未签署 /api/readiness → 403', unsigned.status === 403,
    'HTTP ' + unsigned.status + (unsigned.status === 403 ? '' : ' · ' + JSON.stringify(unsigned.data)));

  // restore the signature (checks 3-8 need a signed console)
  const reSign = await api('/api/agreement', { method: 'POST', body: JSON.stringify({ accepted: true, signer: originalSigner }) });
  const signedOk = reSign.status === 200 && reSign.data && reSign.data.ok === true && !!(reSign.data.agreement && reSign.data.agreement.accepted === true);
  check('2b. 恢复签署（现场还原）', signedOk, 'HTTP ' + reSign.status + ' · signer=' + originalSigner);
  if (!signedOk) {
    log('');
    log('FATAL: 签不回去，后面的用例依赖已签署状态，跳过。');
    log('summary: ' + results.filter((r) => r.ok).length + '/' + results.length);
    save();
    process.exitCode = 1;
    return;
  }

  // ---- 3. readiness shape -------------------------------------------------
  const t0 = Date.now();
  const rd = await api('/api/readiness');
  const elapsed = Date.now() - t0;
  const body = (rd.data && typeof rd.data === 'object') ? rd.data : {};
  const checks = Array.isArray(body.checks) ? body.checks : [];
  const ids = ['agreement', 'catalog', 'kernel', 'memory'];
  const by = {};
  for (const c of checks) if (c && c.id) by[c.id] = c;
  const memoryDetailOk = !by.memory || (typeof by.memory.detail === 'string' && by.memory.detail.length > 0);

  check('3. 签署后 /api/readiness → 200 + ok:true', rd.status === 200 && body.ok === true, 'HTTP ' + rd.status);
  check('3a. level ∈ {green,yellow,red}', ['green', 'yellow', 'red'].indexOf(body.level) >= 0, 'level=' + body.level);
  check('3b. checks 4 项且 id 齐全', checks.length === 4 && ids.every((id) => !!by[id]),
    checks.length + ' 项: ' + checks.map((c) => c && c.id).join(','));
  const fieldsOk = checks.length === 4 && checks.every((c) => c
    && typeof c.label === 'string' && c.label.length > 0
    && typeof c.ok === 'boolean'
    && typeof c.optional === 'boolean'
    && typeof c.detail === 'string');
  check('3c. 每项都有 label/ok/optional/detail 且类型正确', fieldsOk,
    checks.map((c) => c.id + '=' + (c.ok ? 'ok' : 'fail') + (c.optional ? '(opt)' : '')).join(' '));
  const expectGreen = !!(by.catalog && by.catalog.ok && by.kernel && by.kernel.ok && by.agreement && by.agreement.ok);
  check('3d. consistency: level==green ⟺ catalog.ok && kernel.ok && agreement.ok',
    (body.level === 'green') === expectGreen,
    'level=' + body.level + ' · 三项 ' + [by.agreement && by.agreement.ok, by.catalog && by.catalog.ok, by.kernel && by.kernel.ok].join('/'));
  const actionOk = body.level === 'red'
    ? !!(body.action && body.action.label === '重新签署协议' && body.action.target === '#/sign')
    : body.level === 'green'
      ? body.action === null
      : !!(body.action && body.action.label === '去设置' && body.action.target === '#/settings');
  check('3e. action 与 level 对齐（red→重新签署协议#/sign · green→null · yellow→去设置#/settings）',
    actionOk && memoryDetailOk, 'action=' + JSON.stringify(body.action) + ' · memory.detail=' + (by.memory ? by.memory.detail : '(missing)'));
  const expectLevel = !(by.agreement && by.agreement.ok) ? 'red' : (expectGreen ? 'green' : 'yellow');
  check('3f. level 只由 agreement/catalog/kernel 决定，memory 为 optional 且不参与判级',
    body.level === expectLevel && !!by.memory && by.memory.optional === true,
    'expect=' + expectLevel + ' · actual=' + body.level + ' · memory.ok=' + (by.memory && by.memory.ok) + ' · optional=' + (by.memory && by.memory.optional));

  // ---- 4. response budget -------------------------------------------------
  check('4. /api/readiness 响应 ≤ ' + BUDGET_READINESS + 'ms', elapsed <= BUDGET_READINESS, elapsed + 'ms（含 memory 探测）');

  // ---- 5. state exposes settings.uiMode -----------------------------------
  const st = await api('/api/state');
  const uiMode0 = settingsOf(st).uiMode;
  check('5. /api/state 的 settings.uiMode 存在且 ∈ {simple,technical}', uiMode0 === 'simple' || uiMode0 === 'technical', 'uiMode=' + uiMode0);

  // ---- 6. uiMode round-trip ----------------------------------------------
  const toTech = await api('/api/settings', { method: 'POST', body: JSON.stringify({ uiMode: 'technical' }) });
  const afterTech = settingsOf(await api('/api/state')).uiMode;
  check('6a. POST settings {uiMode:technical} → 200 且回读 technical', toTech.status === 200 && afterTech === 'technical', 'HTTP ' + toTech.status + ' → ' + afterTech);

  const toSimple = await api('/api/settings', { method: 'POST', body: JSON.stringify({ uiMode: 'simple' }) });
  const afterSimple = settingsOf(await api('/api/state')).uiMode;
  check('6b. POST settings {uiMode:simple} → 200 且回读 simple（测完留在 simple）', toSimple.status === 200 && afterSimple === 'simple', 'HTTP ' + toSimple.status + ' → ' + afterSimple);

  // ---- 7. invalid uiMode rejected, nothing persisted ----------------------
  const bogus = await api('/api/settings', { method: 'POST', body: JSON.stringify({ uiMode: 'bogus' }) });
  const bogusErr = String((bogus.data && bogus.data.error) || '');
  check('7. POST settings {uiMode:bogus} → 400 且错误串含 uiMode', bogus.status === 400 && /uiMode/.test(bogusErr), 'HTTP ' + bogus.status + ' · error=' + JSON.stringify(bogusErr));
  const afterBogus = settingsOf(await api('/api/state')).uiMode;
  check('7b. 非法值不落盘（回读 uiMode 未变）', afterBogus === afterSimple, 'before=' + afterSimple + ' · after=' + afterBogus);

  // ---- 8. regression: the pre-existing settings fields still behave ------
  const before = settingsOf(await api('/api/state'));
  const setMem = await api('/api/settings', { method: 'POST', body: JSON.stringify({ memoryBase: MEMORY_BASE }) });
  const memAfter = settingsOf(await api('/api/state')).memoryBase;
  check('8a. POST settings {memoryBase} → 200 且地址被接受', setMem.status === 200 && memAfter === MEMORY_BASE, 'HTTP ' + setMem.status + ' · memoryBase=' + memAfter);

  const setBreak = await api('/api/settings', { method: 'POST', body: JSON.stringify({ breakDir: '' }) });
  const afterBreak = settingsOf(await api('/api/state'));
  const breakKept = typeof afterBreak.breakDir === 'string' && afterBreak.breakDir.length > 0;
  check('8b. POST settings {breakDir:""} → 200 且 breakDir 不被清空', setBreak.status === 200 && breakKept, 'HTTP ' + setBreak.status + ' · breakDir=' + afterBreak.breakDir);

  // put back a custom memoryBase if the probe overwrote one
  if (before.memoryBase && before.memoryBase !== MEMORY_BASE) {
    await api('/api/settings', { method: 'POST', body: JSON.stringify({ memoryBase: before.memoryBase }) });
    log('note: memoryBase 已还原为 ' + before.memoryBase);
  }
  if (afterBreak.uiMode !== 'simple') {
    await api('/api/settings', { method: 'POST', body: JSON.stringify({ uiMode: 'simple' }) });
    log('note: uiMode 已还原为 simple');
  }

  // ---- summary -----------------------------------------------------------
  const failed = results.filter((r) => !r.ok);
  log('');
  log(`summary: ${results.length - failed.length}/${results.length}`);
  if (failed.length) {
    log('FAIL 清单:');
    for (const f of failed) log('  - ' + f.name);
    process.exitCode = 1;
  } else {
    log('ALL PASS');
  }
  save();
}

main().catch((e) => {
  log('FATAL: 脚本中断 — ' + errText(e));
  log('');
  log(`summary: ${results.filter((r) => r.ok).length}/${results.length}`);
  save();
  process.exitCode = 1;
});
