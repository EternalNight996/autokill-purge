// 回归：0.2.2 兼容锚点是否还在、是否还命中、catalog 是否与引擎同源。
// 为什么要有这条：COMPAT_0202 是手写在 vendored core.js 里的，重新 vendor 会被整份覆盖；
// 没有这条断言，锚点静默消失 → 面板全绿但宿主其实没洗（假绿）。
//
// 用法：node test/patch-compat-0202.mjs
// 退出码：0 全过；1 有失败。
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
const CORE = join(ROOT, 'web', 'patch-engine', 'vendor', 'core.js');
const CATALOG = join(ROOT, 'web', 'patch-engine', 'catalog.json');

const EXPECT_IDS = [13, 14, 17, 18, 28, 32, 35, 40, 53, 54, 60, 62, 67, 74];
const MIN_REPS = {
  13: 2, 14: 3, 17: 3, 18: 2, 28: 4, 32: 5, 35: 3, 40: 7, 53: 3, 54: 4, 60: 8, 62: 6, 67: 2, 74: 2,
};

let pass = 0;
let fail = 0;
const ok = (cond, label, extra = '') => {
  if (cond) { pass += 1; console.log('PASS  ' + label + (extra ? '  — ' + extra : '')); }
  else { fail += 1; console.log('FAIL  ' + label + (extra ? '  — ' + extra : '')); }
};

const src = readFileSync(CORE, 'utf8');
ok(src.includes('COMPAT_0202'), 'core.js 仍带 COMPAT_0202 段');
ok(src.includes('COMPAT_0202_FILES'), 'core.js 仍带 COMPAT_0202_FILES');
ok(src.includes('COMPAT_0202_MARKERS'), 'core.js 仍带 COMPAT_0202_MARKERS');

const c = await import('file:///' + CORE.replace(/\\/g, '/'));
const byId = new Map((c.ALL_PATCHES || []).map((p) => [p.id, p]));
ok(c.ALL_PATCHES.length === 83, '补丁条数 83', '当前 ' + c.ALL_PATCHES.length);

for (const id of EXPECT_IDS) {
  const p = byId.get(id);
  if (!p) { ok(false, '#' + id + ' 存在'); continue; }
  const need = MIN_REPS[id] || 1;
  ok(p.replacements.length >= need, '#' + id + ' replacements ≥ ' + need, '当前 ' + p.replacements.length);
}

// catalog 与引擎同源（按 extract-catalog 的同一算法比 digest）
const sha = (s) => createHash('sha256').update(String(s), 'utf8').digest('hex');
const rowDigest = (p) => sha(JSON.stringify((p.replacements || []).map((r) => ({ pattern: String(r.pattern ?? ''), replace: String(r.replace ?? '') }))));
if (existsSync(CATALOG)) {
  const cat = JSON.parse(readFileSync(CATALOG, 'utf8'));
  const engineDigest = sha(JSON.stringify((c.ALL_PATCHES || []).map((p) => [p.id, rowDigest(p)])));
  ok(cat.count === c.ALL_PATCHES.length, 'catalog count 与引擎一致', cat.count + ' vs ' + c.ALL_PATCHES.length);
  ok(cat.digest === engineDigest, 'catalog digest 与引擎一致', String(cat.digest).slice(0, 12) + ' vs ' + engineDigest.slice(0, 12));
} else {
  ok(false, 'catalog.json 存在');
}

// 当前宿主上这几条是否真的落到「已注入/已是最新」（打完补丁后原锚点当然不在了，
// 所以这里查状态，而不是查锚点还在不在）
const bases = c.enumeratePatchAiBases({ discover: true });
const desktop = bases.find((b) => b.includes('\\resources\\app\\'));
if (!desktop) {
  console.log('SKIP  桌面宿主不在这台机器上，跳过命中检查');
} else {
  process.env.DSH_SURFACE = 'desktop';
  const st = await c.patchStatus(desktop);
  const want = [13, 14, 17, 18, 28, 32, 35, 40, 53, 54, 60, 62, 67, 74];
  const bad = want.filter((id) => !(st[id] === 'applied' || st[id] === 'already'));
  ok(bad.length === 0, '桌面宿主上 ' + want.length + ' 条兼容补丁全部已注入', bad.length ? '未过: #' + bad.join(' #') : '全过');
}

console.log('\n===== ' + pass + ' PASS / ' + fail + ' FAIL =====');
process.exit(fail ? 1 : 0);
