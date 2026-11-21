#!/usr/bin/env node
// test/ops-reapply.mjs —— web/ops/reapply.mjs 的自检（零依赖，只读 + dryRun）。
//
// 用法：node test/ops-reapply.mjs
// 退出码：0 = 全绿；1 = 至少一个 FAIL。
//
// 安全边界（这台机器的 DSH 正在跑，杀了就断线）：
//   · 只调 status() / plan() / run({dryRun:true}) —— 都不落盘、不起进程、不杀进程；
//   · 唯一允许的写入是 run({stampOnly:true}) 落 data/reapply-stamp.json（data/ 已在 .gitignore 里），
//     它不碰宿主文件，用它是为了能真测「幂等」而不是纸上谈兵；
//   · 每次都对比 git status 与宿主关键文件的 mtime，任何宿主改动都会被抓成 FAIL。
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const DATA_DIR = join(ROOT, 'data');
const OPS = await import('file:///' + join(OPS_DIR(), 'reapply.mjs').replace(/\\/g, '/'));
const INDEX = await import('file:///' + join(OPS_DIR(), 'index.mjs').replace(/\\/g, '/'));

function OPS_DIR() { return join(ROOT, 'web', 'ops'); }

const results = [];
function check(name, ok, detail = '') {
  const pass = !!ok;
  results.push({ name, ok: pass, detail });
  console.log((pass ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  — ' + detail : ''));
}
function section(title) { console.log('\n--- ' + title + ' ---'); }
function errText(e) { return String((e && e.message) || e); }

const ctx = INDEX.makeCtx(DATA_DIR);

// ---- 只读快照：用来断言「没落盘」 ------------------------------------------------
const HOST_FILES = [
  'C:/Users/Administrator/AppData/Local/Programs/DeepSeek Harness/resources/app.asar',
  'C:/Users/Administrator/AppData/Local/Programs/DeepSeek Harness/resources/app.asar.dshpurge-aside',
  'C:/Users/Administrator/AppData/Local/Programs/DeepSeek Harness/resources/app/dsh/package.json',
  'C:/Users/Administrator/AppData/Local/Programs/DeepSeek Harness/resources/app/dsh/node_modules/@deepseek-ai/dsh-system-prompt/lib/index.js',
];

async function sig(file) {
  try {
    const s = await stat(file);
    return s.size + '@' + Math.round(s.mtimeMs);
  } catch { return 'missing'; }
}
async function dirSig(dir) {
  try {
    const names = (await readdir(dir)).sort();
    const rows = [];
    for (const name of names) rows.push(name + ':' + await sig(join(dir, name)));
    return rows.join('|');
  } catch { return 'missing'; }
}
/** 只覆盖宿主（不含 data）：用来证明「这一步没碰宿主文件」。 */
async function hostSig() {
  const rows = [];
  for (const f of HOST_FILES) rows.push(f + '=' + await sig(f));
  rows.push('resources=' + await dirSig('C:/Users/Administrator/AppData/Local/Programs/DeepSeek Harness/resources'));
  return rows.join('\n');
}
/** 只盯本模块自己的产物（data/reapply*）：data/ 是并行共享目录，整目录比对会把别人的写入算成自己的。 */
async function ourSig() {
  let names = [];
  try { names = (await readdir(DATA_DIR)).filter((n) => n.startsWith('reapply')).sort(); } catch { names = []; }
  const rows = ['stamp=' + await sig(join(DATA_DIR, 'reapply-stamp.json'))];
  for (const n of names) rows.push(n + '=' + await sig(join(DATA_DIR, n)));
  return rows.join('|');
}
/** 判定「有没有落盘」的口径：宿主文件 + 本模块产物，两者任一变化都算动过。 */
async function guardSig() {
  return (await hostSig()) + '\n' + (await ourSig());
}
async function worldSig(extraFiles = []) {
  const files = [...HOST_FILES, ...extraFiles];
  const rows = [];
  for (const f of files) rows.push(f + '=' + await sig(f));
  rows.push('data=' + await dirSig(DATA_DIR));
  rows.push('resources=' + await dirSig('C:/Users/Administrator/AppData/Local/Programs/DeepSeek Harness/resources'));
  return rows.join('\n');
}
function gitSig() {
  const r = spawnSync('git', ['-C', ROOT.replace(/\\/g, '/'), 'status', '--porcelain=v1'], { encoding: 'utf8' });
  if (r.status !== 0) return 'git-unavailable';
  return String(r.stdout || '');
}

// ================================ 1. META =======================================
section('META');
check('META.id === reapply', OPS.META && OPS.META.id === 'reapply', String(OPS.META && OPS.META.id));
check('META.zh / en 非空', !!(OPS.META.zh && OPS.META.en));
check('META.kind 合法', ['read', 'write', 'both'].includes(OPS.META.kind), String(OPS.META.kind));
check('META.requires 是数组', Array.isArray(OPS.META.requires), JSON.stringify(OPS.META.requires));
check('导出 status/run/plan 三个函数',
  typeof OPS.status === 'function' && typeof OPS.run === 'function' && typeof OPS.plan === 'function');

// ============================ 2. settle 判定移植 =================================
section('settle 判定（上游 settle-policy.js 语义）');
check('settleDelayMs(desktop) === 4000', OPS.settleDelayMs('desktop') === 4000, String(OPS.settleDelayMs('desktop')));
check('settleDelayMs(console) === 0', OPS.settleDelayMs('console') === 0);
check('settleDelayMs(web) === 0', OPS.settleDelayMs('web') === 0);
check('settleMayRestart: 桌面面一律 false', OPS.settleMayRestart({ surface: 'desktop', sealed: false }) === false);
check('settleMayRestart: 密封包 false', OPS.settleMayRestart({ surface: 'console', sealed: true }) === false);
check('settleMayRestart: 控制台 + 非密封 true', OPS.settleMayRestart({ surface: 'console', sealed: false }) === true);
check('settleMayReapply: 桌面 + 密封 false', OPS.settleMayReapply({ surface: 'desktop', sealed: true }) === false);
check('settleMayReapply: 控制台 + 密封 true', OPS.settleMayReapply({ surface: 'console', sealed: true }) === true);
check('applyShouldRestart: 密封 → true', OPS.applyShouldRestart({ sealed: true }) === true);
check('applyShouldRestart: complete → true', OPS.applyShouldRestart({ complete: true }) === true);
check('applyShouldRestart: promptReady → true', OPS.applyShouldRestart({ promptReady: true }) === true);
check('applyShouldRestart: appliedCount>0 → true', OPS.applyShouldRestart({ appliedCount: 3 }) === true);
check('applyShouldRestart: 全 false → false', OPS.applyShouldRestart({ complete: false, sealed: false, appliedCount: 0, promptReady: false }) === false);

// ===================== 3. official-update / stamp 纯函数 ==========================
section('official-update / stamp 移植');
const wshExpected = '"' + ['843d', '5730'].map((hex) => String.fromCharCode(92) + 'u' + hex).join('') + '"';
check('wshLiteral 把中文转成 ASCII 转义（\\uXXXX）', OPS.wshLiteral('落地') === wshExpected && OPS.isWshAscii(wshExpected), OPS.wshLiteral('落地'));
check('isWshAscii 认 ASCII', OPS.isWshAscii('C:\\a\\b.js') === true);
check('isWshAscii 拒中文', OPS.isWshAscii('落地') === false);
check('upgradeMarkerPath 只认官方 exe',
  OPS.upgradeMarkerPath('C:/x/DeepSeek Harness.exe') === 'C:/x/resources/dsh-purge-reapply-asar'
  && OPS.upgradeMarkerPath('C:/x/other.exe') === '');
check('isApplyPlaceholder 认 apply:1.1.71', OPS.isApplyPlaceholder('apply:1.1.71') === true && OPS.isApplyPlaceholder('abc') === false);
check('stampMatches: 版本不同 → false', OPS.stampMatches({ appVersion: '1', appliedRev: 'cat:a@1' }, '2', 'cat:a@1') === false);
check('stampMatches: 空 rev → false', OPS.stampMatches({ appVersion: '1', appliedRev: '' }, '1', 'cat:a@1') === false);
check('stampMatches: 版本+rev 对齐 → true', OPS.stampMatches({ appVersion: '1', appliedRev: 'cat:a@1' }, '1', 'cat:a@1') === true);
check('stampMatches: 清单换代（rev 变）→ false', OPS.stampMatches({ appVersion: '1', appliedRev: 'cat:a@1' }, '1', 'cat:b@1') === false);
check('sameIdentity: 同 size 同 mtime → true', OPS.sameIdentity({ size: 10, mtimeMs: 1000 }, { size: 10, mtimeMs: 1000 }) === true);
check('sameIdentity: 容差内抖动仍算同一份', OPS.sameIdentity({ size: 10, mtimeMs: 1000 }, { size: 10, mtimeMs: 1500 }) === true);
check('sameIdentity: size 变 → false', OPS.sameIdentity({ size: 11, mtimeMs: 1000 }, { size: 10, mtimeMs: 1000 }) === false);

// ============================ 4. decide 合成用例 =================================
section('decide（三个布尔的判定组合）');
const baseFacts = { appVersion: '9.9.9', archiveVersion: '9.9.9', asarPresent: true, appDirComplete: true, unpackedMatches: true, pending: 0, stamp: null, stampAligned: false };
const closed = OPS.decide(baseFacts);
check('密封 + 目录完整 + 已对齐：needsHandoff/needsRepack/shouldRestart 全 true',
  closed.needsHandoff === true && closed.needsRepack === false && closed.shouldRestart === true);
check('密封但不一致：needsRepack true',
  OPS.decide({ ...baseFacts, unpackedMatches: false }).needsRepack === true
  && OPS.decide({ ...baseFacts, appDirComplete: false }).needsRepack === true);
const landed = OPS.decide({ ...baseFacts, asarPresent: false });
check('已落地（asar 不在）：needsHandoff/needsRepack/shouldRestart 全 false',
  landed.needsHandoff === false && landed.needsRepack === false && landed.shouldRestart === false);
check('逐补丁 pending → needsReapply + shouldReapply',
  OPS.decide({ ...baseFacts, asarPresent: false, pending: 4 }).needsReapply === true
  && OPS.decide({ ...baseFacts, asarPresent: false, pending: 4 }).shouldReapply === true);
check('官方升级（版本漂移）→ needsReapply', OPS.decide({ ...baseFacts, appVersion: '1', archiveVersion: '2' }).needsReapply === true
  && OPS.decide({ ...baseFacts, appVersion: '1', archiveVersion: '2' }).versionDrift === true);
check('官方升级标记 → needsReapply', OPS.decide({ ...baseFacts, upgradeMarker: true }).needsReapply === true);
check('戳记版本过期 → needsReapply', OPS.decide({ ...baseFacts, stampStale: true }).needsReapply === true);
check('归档与目录都没了 → blocked', OPS.decide({ asarPresent: false, appDirComplete: false }).blocked === true);
check('needsStamp: 没有戳 → true；对齐了 → false',
  OPS.decide({ ...baseFacts, stamp: null }).needsStamp === true
  && OPS.decide({ ...baseFacts, stamp: { appliedRev: 'x' }, stampAligned: true }).needsStamp === false);

// ============================== 5. buildSteps ====================================
section('buildSteps');
const stepsSealed = OPS.buildSteps(baseFacts, closed, { auto: false });
check('密封包的计划一定含 handoff 且默认 runnable=false',
  stepsSealed.some((s) => s.id === 'handoff')
  && stepsSealed.find((s) => s.id === 'handoff').runnable === false);
const stepsRepack = OPS.buildSteps({ ...baseFacts, unpackedMatches: false }, OPS.decide({ ...baseFacts, unpackedMatches: false }), { auto: false });
check('归档身份不符时计划里先 extract 再 reapply/handoff',
  stepsRepack[0].id === 'extract' && stepsRepack.find((s) => s.id === 'extract').runnable === false
  && stepsRepack.some((s) => s.id === 'handoff'));
const stepsAuto = OPS.buildSteps(baseFacts, closed, { auto: true });
check('auto=true 时 extract/handoff 变为 runnable', stepsAuto.find((s) => s.id === 'handoff').runnable === true);

check('解包后必须重算 apply（旧宿主 0 pending 也不能跳过）',
  OPS.needsApplyAfterExtract({ needsReapply: false }, { extracted: true }) === true
  && OPS.needsApplyAfterExtract({ needsReapply: false }, null) === false
  && OPS.needsApplyAfterExtract({ needsReapply: true }, null) === true);
const stepsNoop = OPS.buildSteps({ asarPresent: false, appDirComplete: true }, OPS.decide({ asarPresent: false, appDirComplete: true, stamp: { appliedRev: 'x' }, stampAligned: true }));
check('无事可做时给 noop 一步', stepsNoop.length === 1 && stepsNoop[0].id === 'noop');

// 前置：本用例验证的是「已落地」形态（asar 让位、resources/app 存在、pending=0）。
// 密封态（asar 在位、未解包）下这些断言不成立，明确跳过而不是崩在 ENOENT。
const HOST_APP_PKG = process.env.DSH_HOST_APP_PKG || 'C:/Users/Administrator/AppData/Local/Programs/DeepSeek Harness/resources/app/dsh/package.json';
if (!existsSync(HOST_APP_PKG)) {
  console.log('SKIP  宿主当前是密封态（resources/app 未解包）—— 本用例只验证已落地形态');
  console.log('summary: 0 PASS / 0 FAIL / 1 SKIP');
  process.exit(0);
}

// ====================== 6. status：真机只读、结论正确 =============================
section('status（真机）');
const t0 = Date.now();
const st1 = await OPS.status(ctx);
const statusMs = Date.now() - t0;
check('status.ok', st1.ok === true, JSON.stringify(st1.detail && st1.detail.error));
check('status.available === true（真机必须可用）', st1.available === true, String(st1.available));
check('status.summary 是人类可读中文', typeof st1.summary === 'string' && st1.summary.indexOf('宿主 v') === 0, st1.summary);
check('needsHandoff === false（本机已落地：app.asar 已让位）', st1.detail.needsHandoff === false);
check('三个布尔都是布尔', typeof st1.detail.needsReapply === 'boolean'
  && typeof st1.detail.needsRepack === 'boolean' && typeof st1.detail.needsHandoff === 'boolean');
check('shouldRestart / shouldReapply 是布尔', typeof st1.detail.shouldRestart === 'boolean' && typeof st1.detail.shouldReapply === 'boolean');
check('pending 计数与引擎一致（逐补丁）',
  st1.detail.facts.total === 83 && st1.detail.facts.pending === 0, 'total=' + st1.detail.facts.total + ' pending=' + st1.detail.facts.pending);
const diskVersion = JSON.parse(await readFile(HOST_APP_PKG, 'utf8')).version;
check('appVersion 来自 resources/app/dsh/package.json', st1.detail.facts.appVersion === diskVersion, st1.detail.facts.appVersion + ' vs ' + diskVersion);
check('archiveVersion 从让位副本读出（asar 已让位）',
  st1.detail.facts.archiveVersion === diskVersion && /dshpurge-aside$/.test(String(st1.detail.facts.archiveSource)),
  String(st1.detail.facts.archiveVersion) + ' @ ' + String(st1.detail.facts.archiveSource));
check('解包记录对得上（没有记录时不算错）',
  st1.detail.unpackedStamp == null ? true : st1.detail.facts.unpackedMatches === true,
  JSON.stringify(st1.detail.unpackedStamp));
check('版本一致 → versionDrift false', st1.detail.versionDrift === false);
check('settle 块含 desktopDelayMs=4000 / delayMs=0',
  st1.detail.settle.desktopDelayMs === 4000 && st1.detail.settle.delayMs === 0 && st1.detail.settle.surface === 'console');
check('status 耗时在预算内（<5000ms）', statusMs < 5000, statusMs + 'ms');

// status 只读：连调两次，宿主 + data 目录 + git 工作区都不许变
const sigBefore = await guardSig();
const gitBefore = gitSig();
await OPS.status(ctx);
await OPS.status(ctx);
const sigAfter = await guardSig();
check('status 只读：宿主文件与本模块产物 mtime 不变', sigBefore === sigAfter, sigBefore === sigAfter ? '' : '前后不一致');
check('status 只读：git 工作区不变', gitBefore === gitSig());

// ============================== 7. plan（只读） ==================================
section('plan');
const plan = await OPS.plan(ctx, {});
check('plan 返回数组', Array.isArray(plan) && plan.length > 0, 'steps=' + (Array.isArray(plan) ? plan.length : 'n/a'));
check('plan 每步都有 id/zh', plan.every((s) => typeof s.id === 'string' && typeof s.zh === 'string'));
check('已落地机器上没有 handoff 步骤', !plan.some((s) => s.id === 'handoff'), plan.map((s) => s.id).join(','));
check('plan 与 status 结论一致（无需重放时没有 reapply 步骤）',
  st1.detail.needsReapply === true ? plan.some((s) => s.id === 'reapply') : !plan.some((s) => s.id === 'reapply'));

// ============================ 8. run(dryRun)：不落盘 =============================
section('run({dryRun:true})');
const dryBefore = await guardSig();
const dryGitBefore = gitSig();
const stampSigBeforeDry = await sig(join(DATA_DIR, 'reapply-stamp.json'));
const stampExistsBeforeDry = stampSigBeforeDry !== 'missing';
const dry = await OPS.run(ctx, { dryRun: true });
check('dryRun ok=true / changed=false', dry.ok === true && dry.changed === false, String(dry.error || ''));
check('dryRun 标记在 detail 里', dry.detail.dryRun === true);
check('dryRun 不执行任何步骤（performed 为空）', Array.isArray(dry.detail.performed) && dry.detail.performed.length === 0);
check('dryRun 给出了 needs 结论', dry.detail.needs && typeof dry.detail.needs.needsReapply === 'boolean');
const dryAuto = await OPS.run(ctx, { dryRun: true, auto: true });
check('dryRun+auto 也不落地', dryAuto.ok === true && dryAuto.changed === false && dryAuto.detail.performed.length === 0);
check('dryRun+auto 摘要里没有 asar 让位字样', String(dryAuto.summary).indexOf('已让位') === -1, dryAuto.summary);
const dryAfter = await guardSig();
check('dryRun 全程不落盘：宿主与本模块产物都没动', dryBefore === dryAfter, dryBefore === dryAfter ? '' : '前后不一致');
check('dryRun 不动 git 工作区', dryGitBefore === gitSig());
check('dryRun 不会凭空写出戳记或改变它',
  (await sig(join(DATA_DIR, 'reapply-stamp.json'))) === (stampExistsBeforeDry ? stampSigBeforeDry : 'missing'));

// ===================== 9. run({stampOnly:true})：幂等（只写 data） ================
section('run({stampOnly:true}) 幂等');
const hostBefore = await hostSig();
const stampPath = join(DATA_DIR, 'reapply-stamp.json');
const s1 = await OPS.run(ctx, { stampOnly: true });
check('stampOnly 第一次 ok', s1.ok === true, String(s1.error || ''));
check('stampOnly 不改宿主文件', hostBefore === await hostSig());
check('戳记文件已落 data/reapply-stamp.json', existsSync(stampPath));
const stamp1 = existsSync(stampPath) ? await readFile(stampPath, 'utf8') : '';
const parsed1 = stamp1 ? JSON.parse(stamp1) : {};
check('戳记含 appliedRev / appVersion / asarIdentity / at',
  typeof parsed1.appliedRev === 'string' && parsed1.appliedRev.startsWith('cat:')
  && typeof parsed1.appVersion === 'string' && parsed1.appVersion === st1.detail.facts.appVersion
  && parsed1.asarIdentity && Number.isFinite(Number(parsed1.asarIdentity.size))
  && typeof parsed1.at === 'string' && !Number.isNaN(Date.parse(parsed1.at)),
  JSON.stringify({ appliedRev: parsed1.appliedRev, appVersion: parsed1.appVersion, at: parsed1.at }));
const s2 = await OPS.run(ctx, { stampOnly: true });
check('stampOnly 第二次 changed=false（幂等）', s2.ok === true && s2.changed === false, 'changed=' + s2.changed + ' summary=' + s2.summary);
check('第二次连 at 都没重写（文件字节相同）', (await readFile(stampPath, 'utf8')) === stamp1);
check('打戳后 status 认为戳记已对齐', (await OPS.status(ctx)).detail.stampAligned === true);
check('打戳后仍然 needsHandoff=false / needsReapply=false',
  (await OPS.status(ctx)).detail.needsHandoff === false && (await OPS.status(ctx)).detail.needsReapply === false);

// ============================ 10. 注册表接线自检 =================================
section('注册表接线（web/ops/index.mjs）');
const listed = await INDEX.listOps(DATA_DIR);
const row = (listed.ops || []).find((o) => o.id === 'reapply');
check('listOps 里 reapply 一行可用', !!row && row.available === true, row ? String(row.reason || row.summary) : 'missing');
check('listOps 带上了中文名与 summary', !!row && !!row.zh && !!row.summary, row ? row.zh : '');
const viaStatus = await INDEX.opStatus(DATA_DIR, 'reapply');
check('opStatus 归一化后 available=true', viaStatus.ok === true && viaStatus.available === true);
const viaPlan = await INDEX.opPlan(DATA_DIR, 'reapply');
check('opPlan 透传 plan 数组', viaPlan.ok === true && Array.isArray(viaPlan.plan));

// =============================== 收尾统计 =======================================
const failed = results.filter((r) => !r.ok);
console.log('\n===== ' + (results.length - failed.length) + ' PASS / ' + failed.length + ' FAIL（共 ' + results.length + ' 项）=====');
if (failed.length) {
  for (const f of failed) console.log('FAILED: ' + f.name + (f.detail ? '  — ' + f.detail : ''));
  process.exitCode = 1;
} else {
  console.log('全绿：reapply 的 status / plan / run(dryRun) / 戳记幂等 与 settle 移植都符合契约。');
}
