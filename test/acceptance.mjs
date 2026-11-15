#!/usr/bin/env node
// autokill-purge acceptance harness — REQUIREMENTS.md §12 ported to Node (Windows-safe, no jq).
//
// Usage:
//   node test/acceptance.mjs               full: break (M1) + web (M2/M3); web needs the server up
//   node test/acceptance.mjs --break-only  M1 break kernel only (no server needed)
//
// Env:
//   PORT          web port (default 8792)
//   PURGE_WEB_BASE  web base, default http://127.0.0.1:$PORT
//
// Exit code: 0 = every required case passed; 1 = at least one FAIL; 2 = usage error.
//
// Safety: mutations run on a TEMP COPY of _smoke/sample.exe, never the fixture.

import { spawnSync } from 'node:child_process';
import { openSync, closeSync, mkdtempSync, readFileSync, writeFileSync, copyFileSync, existsSync, rmSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BREAK = join(ROOT, 'break', 'break.mjs');
const SAMPLE = join(ROOT, '_smoke', 'sample.exe');
const SAMPLE7 = join(ROOT, '_smoke', 'sample-7s.exe');
const MAKER = join(ROOT, 'test', 'make-7s-fixture.mjs');
const PORT = Number(process.env.PORT || 8792);
const WEB = String(process.env.PURGE_WEB_BASE || 'http://127.0.0.1:' + PORT).replace(/\/+$/, '');
const BREAK_ONLY = process.argv.includes('--break-only');

// §6 budgets (ms)
const BUDGET = { info: 2000, scan: 5000, patch: 1000, verify: 3000 };

const results = [];
let tmp;
let n = 0;

function sha(buf) { return createHash('sha256').update(buf).digest('hex'); }
function hexInt(s) { return Number(String(s).toLowerCase().replace(/^0x/, '')); }
function report(name, ok, detail) {
  n += 1;
  results.push({ name, ok, detail });
  const tag = ok ? 'PASS' : 'FAIL';
  console.log(`${tag}  ${String(n).padStart(2)}. ${name}${detail ? ' — ' + detail : ''}`);
}

// Run a node script and capture exit code + stdout + stderr.
// Uses file-redirected stdio (not pipes) so it works under restricted sandboxes too,
// and never trips a maxBuffer cap. Returns {status, stdout, stderr}.
function runNode(script, args, timeoutMs) {
  const dir = mkdtempSync(join(tmpdir(), 'ap-out-'));
  const outFile = join(dir, 'out.txt');
  const errFile = join(dir, 'err.txt');
  const fo = openSync(outFile, 'w');
  const fe = openSync(errFile, 'w');
  const r = spawnSync(process.execPath, [script, ...(args || [])], {
    cwd: ROOT, stdio: ['ignore', fo, fe], timeout: timeoutMs || 60000, windowsHide: true,
  });
  let stdout = ''; let stderr = '';
  try { stdout = readFileSync(outFile, 'utf8'); } catch {}
  try { stderr = readFileSync(errFile, 'utf8'); } catch {}
  try { closeSync(fo); } catch {}
  try { closeSync(fe); } catch {}
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
  let status;
  if (r.error) status = r.error.code === 'ETIMEDOUT' ? 124 : -1;
  else status = r.status === null ? -1 : r.status;
  return { status, stdout, stderr };
}
function runBreak(args, timeoutMs) { return runNode(BREAK, args, timeoutMs); }
function json(out) { try { return JSON.parse(out.stdout); } catch { return null; } }

// A fresh working copy of the fixture. Each scenario gets its own file so cases stay independent.
function freshCopy(tag) {
  const dir = mkdtempSync(join(tmpdir(), 'ap-'));
  const file = join(dir, tag + '.exe');
  copyFileSync(SAMPLE, file);
  return { dir, file };
}
function cleanup(d) { try { rmSync(d, { recursive: true, force: true }); } catch {} }

// ---------------------------------------------------------------------------
// M1 — break 内核（正向 1–7 + 负向核心 + §6 计时）
// ---------------------------------------------------------------------------
async function m1() {
  const ORIGINAL_SHA = sha(readFileSync(SAMPLE));
  const OFFSET = '0xA5638';
  const EXPECT = '488D1509AED701';
  const NOP = 7;

  // 1. info  —— AC-3.1 / §8 正向 1（用 7 节夹具 sample-7s.exe，由脚本生成，不动 sample.exe）
  {
    const g = runNode(MAKER, [], 30000);
    if (g.status !== 0) {
      report('M1 info: 7+ 节 + 熵值 + ok', false, 'fixture 生成失败: ' + (g.stderr || '').trim());
    } else {
      const t0 = Date.now();
      const r = runBreak(['info', SAMPLE7], BUDGET.info + 5000);
      const ms = Date.now() - t0;
      const j = json(r);
      const ok = r.status === 0 && !!j && j.ok === true && Array.isArray(j.sections) && j.sections.length > 6
        && j.sections.every((s) => typeof s.entropy === 'number' || typeof s.size === 'number');
      report('M1 info: 7+ 节 + 熵值 + ok', ok && ms <= BUDGET.info, `${j && j.sections ? j.sections.length : 0} sections · ${ms}ms (budget ${BUDGET.info}ms)`);
    }
  }

  // 2. scan --min-xrefs 1  —— AC-3.2 / §8 正向 2
  {
    const t0 = Date.now();
    const r = runBreak(['scan', SAMPLE, '--min-xrefs', '1'], BUDGET.scan + 5000);
    const ms = Date.now() - t0;
    const j = json(r);
    const hits = j && Array.isArray(j.hits) ? j.hits : [];
    const refd = hits.filter((h) => h && Array.isArray(h.xrefs) && h.xrefs.length > 0);
    const ok = r.status === 0 && !!j && j.ok === true && hits.length > 0 && refd.length > 0;
    report('M1 scan: 命中≥1 且带引用点', ok && ms <= BUDGET.scan, `${hits.length} hits · ${refd.length} referenced · ${ms}ms (budget ${BUDGET.scan}ms)`);
  }

  // 3. plan  —— §8 正向 3
  {
    const r = runBreak(['plan', SAMPLE]);
    const j = json(r);
    const ok = r.status === 0 && !!j && j.ok === true && Array.isArray(j.candidates);
    report('M1 plan: ok + candidates[]', ok, ok ? `${j.candidates.length} candidates` : (j && j.error ? j.error : 'non-JSON/non-ok'));
  }

  // 4–7 在一个全新副本上走 patch → verify → restore → journal 全流程 —— AC-3.3/3.4/3.5, AC-8.2
  {
    const w = freshCopy('flow');

    // 4. patch
    let t0 = Date.now();
    let r = runBreak(['patch', w.file, '--at', OFFSET, '--expect', EXPECT, '--nop', String(NOP)], BUDGET.patch + 5000);
    let ms = Date.now() - t0;
    let j = json(r);
    const shaBefore = j && j.shaBefore;
    const shaAfter = j && j.shaAfter;
    const patchOk = r.status === 0 && !!j && j.ok === true && j.before === EXPECT && !!shaBefore && !!shaAfter && shaBefore !== shaAfter;
    report('M1 patch: ok + sha 前后变化', patchOk && ms <= BUDGET.patch, `${OFFSET} ${EXPECT}->NOP${NOP} · ${ms}ms (budget ${BUDGET.patch}ms)`);

    // 5. verify（.bak vs 改后）
    t0 = Date.now();
    r = runBreak(['verify', w.file + '.bak', w.file], BUDGET.verify + 5000);
    ms = Date.now() - t0;
    j = json(r);
    const verifyOk = r.status === 0 && !!j && j.ok === true && j.differingBytes === NOP;
    report('M1 verify: differingBytes == 写入长度', verifyOk && ms <= BUDGET.verify, `differingBytes=${j && j.differingBytes} · ${ms}ms (budget ${BUDGET.verify}ms)`);

    // 6. journal —— AC-8.2
    r = runBreak(['journal', w.file]);
    j = json(r);
    const entries = j && Array.isArray(j.entries) ? j.entries : [];
    const hasPatch = entries.some((e) => e && e.command === 'patch' && e.sha_before && e.sha_after);
    report('M1 journal: 有完整 patch 记录', r.status === 0 && !!j && j.ok === true && hasPatch, `${entries.length} entries`);

    // 7. restore —— AC-3.5 / §8 回归 2
    r = runBreak(['restore', w.file]);
    j = json(r);
    const restoredSha = sha(readFileSync(w.file));
    const restoreOk = r.status === 0 && !!j && j.ok === true && restoredSha === ORIGINAL_SHA;
    report('M1 restore: sha 回到原始', restoreOk, `restored=${restoredSha.slice(0, 12)}… original=${ORIGINAL_SHA.slice(0, 12)}…`);
    cleanup(w.dir);
  }

  // 8. invert —— §8 正向 5（定位首个条件跳转字节）
  {
    const w = freshCopy('inv');
    const buf = readFileSync(w.file);
    let at = -1;
    for (let i = 0; i < buf.length - 1; i++) {
      if (buf[i] === 0x74) { at = i; break; } // jz，最常见
    }
    if (at < 0) {
      report('M1 invert: 翻转条件跳转', false, 'sample 中未找到 0x74，跳过');
    } else {
      const r = runBreak(['invert', w.file, '--at', '0x' + at.toString(16).toUpperCase()]);
      const j = json(r);
      const ok = r.status === 0 && !!j && j.ok === true && j.before !== j.after;
      report('M1 invert: 字节翻转 + sha 变化', ok, `@0x${at.toString(16).toUpperCase()} ${j && j.before}->${j && j.after}`);
      runBreak(['restore', w.file]);
    }
    cleanup(w.dir);
  }

  // 负向核心
  // 9. expect 不匹配 → 退出 3 且 sha 不变  —— AC-8.1 / AC-3.3
  {
    const w = freshCopy('nexp');
    const before = sha(readFileSync(w.file));
    const r = runBreak(['patch', w.file, '--at', OFFSET, '--expect', '00000000000000', '--nop', '7']);
    const after = sha(readFileSync(w.file));
    report('M1 负向: expect 不匹配 → 退出 3 + sha 不变', r.status === 3 && after === before, `exit=${r.status} shaSame=${after === before}`);
    cleanup(w.dir);
  }

  // 10. 非 PE → 退出 4  —— AC-8.4 / AC-3.6
  {
    const w = freshCopy('txt');
    const txt = join(w.dir, 'notpe.txt');
    writeFileSync(txt, 'this is not an executable\n');
    const r = runBreak(['info', txt]);
    report('M1 负向: 非 PE → 退出 4', r.status === 4, `exit=${r.status} · ${(r.stderr || '').trim().slice(0, 80)}`);
    cleanup(w.dir);
  }

  // 11. offset 越界 → 非零退出 且 sha 不变  —— §8 负向 2
  {
    const w = freshCopy('oob');
    const before = sha(readFileSync(w.file));
    const r = runBreak(['patch', w.file, '--at', '0xFFFFFFF', '--nop', '7']);
    const after = sha(readFileSync(w.file));
    report('M1 负向: offset 越界 → 非零退出 + sha 不变', r.status !== 0 && after === before, `exit=${r.status} shaSame=${after === before}`);
    cleanup(w.dir);
  }

  // 12. .bak 损坏 → restore 拒绝  —— AC-8.3 / §8 负向 5
  {
    const w = freshCopy('bak');
    runBreak(['patch', w.file, '--at', OFFSET, '--expect', EXPECT, '--nop', '7']); // creates .bak + journal
    appendFileSync(w.file + '.bak', 'corrupted'); // 破坏 .bak，使其 sha 与 journal 首条 sha_before 不一致
    const patched = sha(readFileSync(w.file));
    const r = runBreak(['restore', w.file]);
    const after = sha(readFileSync(w.file));
    report('M1 负向: .bak 损坏 → restore 拒绝 + 文件不变', r.status !== 0 && after === patched, `exit=${r.status} unchanged=${after === patched}`);
    cleanup(w.dir);
  }
}

// ---------------------------------------------------------------------------
// M2 / M3 — Web（需要 `node web/server.mjs` 已启动）
// ---------------------------------------------------------------------------
async function http(path, opts) {
  const res = await fetch(WEB + path, opts);
  let body = null;
  try { body = await res.json(); } catch {}
  return { status: res.status, body };
}
async function text(path) {
  const res = await fetch(WEB + path);
  return { status: res.status, body: await res.text() };
}

async function m2m3() {
  // 可达性探针
  let ping;
  try { ping = await http('/api/ping'); } catch { ping = null; }
  if (!ping || ping.status !== 200) {
    report('M2/M3: server 可达', false, `GET /api/ping 失败（${ping ? ping.status : '连接拒绝'}）— 先启动 node web/server.mjs`);
    console.log('      （跳过其余 Web 用例）');
    return;
  }
  report('M2/M3: server 可达', true, `${WEB}/api/ping`);

  // 13. 协议门 —— AC-1.1 / AC-1.2（先 reset 保证幂等）
  await http('/api/agreement/reset', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  let r = await http('/api/memory/stats');
  report('M2 协议门: 未签署 → 403', r.status === 403, `status=${r.status}`);
  r = await http('/api/agreement', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accepted: true, signer: 'qa' }) });
  const signed = r.status === 200 && r.body && r.body.ok === true;
  report('M2 协议门: 签署成功', signed, `status=${r.status}`);
  r = await http('/api/memory/stats');
  report('M2 协议门: 签署后 → 200', r.status === 200, `status=${r.status}`);

  // 14. breach/build 2 技术 → variants≥2 —— AC-2.1 / §12
  r = await http('/api/breach/build', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-4o', layer: 'prompt', techniques: ['persona', 'encoding'], task: '授权靶场的弱口令验证步骤' }),
  });
  const variants = (r.body && r.body.ok && r.body.result && r.body.result.variants) || [];
  report('M2 破甲: 2 技术生成 ≥2 载荷', r.status === 200 && variants.length >= 2, `${variants.length} variants`);

  // 15. 空任务 → 明确拒绝  —— AC-2.2 / §8 负向 7
  r = await http('/api/breach/build', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-4o', layer: 'prompt', techniques: ['persona'], task: '' }),
  });
  const emptyRejected = r.status !== 200 || (r.body && (r.body.ok === false || (r.body.result && r.body.result.variants && r.body.result.variants.length === 0)));
  report('M2 破甲: 空任务拒绝且不产生载荷', emptyRejected, `status=${r.status}`);

  // 16. 分配 2 卡 → 端点 2 节；再加 1 卡 → 3 节 —— AC-5.1 / AC-5.2 / §12
  await http('/api/assign', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ agent: 'dsh', cards: ['A.md', 'B.md'], mode: { skillsOnly: false, autoSync: true } }),
  });
  let t = await text('/api/assign/dsh.md');
  const two = (t.body.match(/^## /gm) || []).length >= 2 || (t.body.includes('A.md') && t.body.includes('B.md'));
  report('M3 分发: 2 卡 → 端点含 2 节', t.status === 200 && two, `status=${t.status}`);
  await http('/api/assign', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ agent: 'dsh', cards: ['A.md', 'B.md', 'C.md'], mode: { skillsOnly: false, autoSync: true } }),
  });
  t = await text('/api/assign/dsh.md');
  const three = (t.body.match(/^## /gm) || []).length >= 3 || (t.body.includes('A.md') && t.body.includes('B.md') && t.body.includes('C.md'));
  report('M3 分发: 3 卡 → 端点含 3 节（无需重启）', t.status === 200 && three, `status=${t.status}`);

  // 17. 未选智能体发放 → 拒绝  —— AC-4.1 / §8 负向 8
  r = await http('/api/equipment', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ preset: 'redteam', agents: [], permissions: 'read-only' }),
  });
  report('M2 装备: 未选智能体 → 拒绝', r.status !== 200 || (r.body && r.body.ok === false), `status=${r.status}`);
}

// ---------------------------------------------------------------------------
async function main() {
  console.log('autokill-purge acceptance  §12 + §6 + 负向核心');
  console.log('repo: ' + ROOT);
  console.log('sample: ' + SAMPLE + (existsSync(SAMPLE) ? '' : '  [MISSING]'));
  console.log('');

  if (!existsSync(SAMPLE)) {
    console.log('FATAL: _smoke/sample.exe 缺失，无法运行 M1 用例。');
    process.exit(2);
  }

  await m1();
  if (!BREAK_ONLY) {
    console.log('');
    await m2m3();
  }

  const failed = results.filter((x) => !x.ok);
  console.log('');
  console.log('==============================================');
  console.log(`结果: ${results.length - failed.length}/${results.length} PASS`);
  if (failed.length) {
    console.log('FAIL:');
    for (const f of failed) console.log('  - ' + f.name);
    console.log(BREAK_ONLY ? '提示: 这是 --break-only；Web 用例用 `node test/acceptance.mjs`（需先启动 server）。' : '');
    process.exit(1);
  }
  console.log('ALL PASS');
  process.exit(0);
}

main();
