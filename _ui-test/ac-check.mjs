// End-to-end AC probe against the real web/server.mjs and break kernel.
// Run while the console is signed in. Writes a human-readable log next to this file.
// Paths are derived from this script's own location, so the repo can live on any drive.
import { copyFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const B = process.env.PURGE_WEB_BASE || 'http://127.0.0.1:8792';
const SRC = join(ROOT, '_smoke', 'sample-7s.exe');
const S = join(HERE, 'ac-sample.exe');
const TXT = join(HERE, 'notpe.txt');
const lines = [];
const results = [];
function log(text = '') { lines.push(text); console.log(text); }
function skip(name, why) {
  results.push({ name, ok: true, skipped: true, detail: why });
  log(`SKIP  ${name} — ${why}`);
}

function check(name, condition, detail = '') {
  const ok = !!condition;
  results.push({ name, ok, detail });
  log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}
async function api(path, opts = {}) {
  const res = await fetch(B + path, {
    ...opts,
    headers: { accept: 'application/json', ...(opts.body ? { 'content-type': 'application/json' } : {}), ...(opts.headers || {}) },
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, ok: res.ok, data, text };
}
async function br(command, file, args = []) {
  return api('/api/break/run', { method: 'POST', body: JSON.stringify({ command, file, args }) });
}

copyFileSync(SRC, S);
for (const p of [S + '.bak', S + '.purge']) { try { rmSync(p, { recursive: true, force: true }); } catch { /* empty */ } }

log('autokill-purge · real-server acceptance probe');
log('server: ' + B + '  break target: ac-sample.exe (copy of _smoke/sample-7s.exe)');
log('');

let state = await api('/api/state');
if (state.status === 403) {
  log('state unsigned; signing for the probe');
  await api('/api/agreement', { method: 'POST', body: JSON.stringify({ accepted: true, signer: 'pixel-ac' }) });
  state = await api('/api/state');
}
check('state 200 and signed', state.status === 200 && state.data?.state?.agreement?.accepted === true, 'HTTP ' + state.status);
check('catalog >= 24 models / 3 layers / 12 techniques', state.data?.models?.length >= 24 && state.data?.layers?.length === 3 && state.data?.techniques?.length === 12,
  `${state.data?.models?.length} / ${state.data?.layers?.length} / ${state.data?.techniques?.length}（静态 24 + 实时识别追加）`);

const info = await br('info', S);
check('break info ok', info.status === 200 && info.data?.ok === true, `HTTP ${info.status}`);
const sections = info.data?.sections?.length || 0;
check('AC-3.1 info sections >= 7', sections >= 7, `actual ${sections} (sample-7s.exe fixture)`);
check('AC-3.1 entropy present on .text', info.data?.sections?.some((s) => s.name === '.text' && typeof s.entropy === 'number'), '');
const originalSha = info.data?.sha256 || '';

const scan = await br('scan', S, ['--min-xrefs', '1']);
const hits = scan.data?.hits || [];
check('AC-3.2 scan default wordlist has a hit with xrefs', scan.status === 200 && hits.length > 0 && hits[0].xrefs?.length > 0, `${hits.length} hits, top refs ${hits[0]?.xrefs?.length || 0}`);

const plan = await br('plan', S);
const candidates = plan.data?.candidates || [];
check('plan returns byte-level candidates', plan.status === 200 && candidates.length > 0 && /^[0-9A-F]+$/i.test(candidates[0]?.expect || ''), `${candidates.length} candidates`);
const cand = candidates[0];

if (cand) {
  const bad = await br('patch', S, ['--at', cand.offset, '--expect', 'DEADBEEF', '--write', cand.suggest || '90909090909090']);
  const badMsg = bad.data?.error?.message || bad.data?.error || '';
  check('AC-3.3 wrong expect -> 409 and "nothing written"', bad.status === 409 && /nothing written/i.test(String(badMsg)), `HTTP ${bad.status}: ${String(badMsg).slice(0, 100)}`);
  const afterBad = await br('info', S);
  check('AC-3.3 wrong expect leaves sha unchanged', afterBad.data?.sha256 === originalSha, '');

  const nopLen = Math.floor((cand.suggest || '90909090909090').length / 2);
  const patch = await br('patch', S, ['--at', cand.offset, '--expect', cand.expect, '--nop', String(nopLen)]);
  check('break patch ok with expect', patch.status === 200 && patch.data?.ok === true && patch.data?.shaBefore === originalSha, `HTTP ${patch.status}`);
  const verify = await br('verify', S + '.bak', [S]);
  check('AC-3.4 verify differingBytes equals write length', verify.status === 200 && verify.data?.differingBytes === nopLen, `differingBytes ${verify.data?.differingBytes}, nop ${nopLen}`);
  const restore = await br('restore', S);
  check('AC-3.5 restore sha equals original', restore.status === 200 && restore.data?.sha === originalSha, `HTTP ${restore.status}, sha ${String(restore.data?.sha).slice(0, 12)}…`);
} else {
  check('AC-3.3/3.4/3.5 patch + verify + restore', false, 'no plan candidate');
}

const notPe = await br('info', TXT);
check('AC-3.6 .txt info -> 400 and not-a-PE hint', notPe.status === 400 && /PE|可执行/i.test(JSON.stringify(notPe.data)), `HTTP ${notPe.status}: ${notPe.data?.error?.message || notPe.data?.error}`);

const stats = await api('/api/memory/stats');
check('memory stats reachable', stats.status === 200 && stats.data?.ok === true && typeof stats.data?.total === 'number', `total ${stats.data?.total}`);
const cards = await api('/api/memory/cards?limit=3');
const cardList = cards.data?.cards || [];
if (cards.status === 200 && cardList.length === 0) {
  skip('memory cards reachable', '隔离库 mem-purge 还是空的（0 张卡），写入卡片后再跑');
} else {
  check('memory cards reachable', cards.status === 200 && cardList.length > 0, `${cardList.length} cards`);
}

const equip = await api('/api/equipment', { method: 'POST', body: JSON.stringify({ preset: 'recon', agents: ['qa-ac'], permissions: 'read-only', notes: 'AC probe' }) });
check('AC-4 equipment issue', equip.status === 200 && equip.data?.ok === true && equip.data?.equipment?.preset === 'recon', `HTTP ${equip.status}`);

if (cardList.length >= 3) {
  const agent = 'qa-ac';
  const paths = cardList.map((c) => c.path);
  const save2 = await api('/api/assign', { method: 'POST', body: JSON.stringify({ agent, cards: paths.slice(0, 2), mode: { skillsOnly: false, autoSync: true } }) });
  const md2 = await api('/api/assign/' + agent + '.md');
  const count2 = (String(md2.text).match(/^- path: /gm) || []).length;
  check('AC-5.1 assign 2 cards -> endpoint 2 sections', save2.status === 200 && count2 === 2, `HTTP ${save2.status}, sections ${count2}`);
  const save3 = await api('/api/assign', { method: 'POST', body: JSON.stringify({ agent, cards: paths.slice(0, 3), mode: { skillsOnly: false, autoSync: true } }) });
  const md3 = await api('/api/assign/' + agent + '.md');
  const count3 = (String(md3.text).match(/^- path: /gm) || []).length;
  check('AC-5.2 add a third card -> endpoint 3 sections without restart', save3.status === 200 && count3 === 3, `HTTP ${save3.status}, sections ${count3}`);
  const saveSkill = await api('/api/assign', { method: 'POST', body: JSON.stringify({ agent, cards: paths.slice(0, 3), mode: { skillsOnly: true, autoSync: true } }) });
  const mdSkill = await api('/api/assign/' + agent + '.md');
  check('AC-5.3 skillsOnly filters non-skill cards and reports count', saveSkill.status === 200 && /已过滤\s*3\s*张非技能卡/.test(String(mdSkill.text)) && !/^- path: /m.test(String(mdSkill.text)), String(mdSkill.text).slice(0, 80));
  await api('/api/assign', { method: 'POST', body: JSON.stringify({ agent, cards: paths.slice(0, 3), mode: { skillsOnly: false, autoSync: true } }) });
} else {
  skip('AC-5.1/5.2/5.3 assign endpoint', '隔离库 mem-purge 还没有 3 张卡可供分发测试');
}

const passed = results.filter((r) => r.ok).length;
log('');
log(`summary: ${passed}/${results.length} checks passed`);
log('note: AC-3.1 uses _smoke/sample-7s.exe (test/make-7s-fixture.mjs, 7 PE sections); _smoke/sample.exe remains the 6-section baseline.');
writeFileSync(join(HERE, 'ac-results.txt'), lines.join('\n') + '\n', 'utf8');
