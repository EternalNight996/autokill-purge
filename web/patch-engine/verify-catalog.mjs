// 校验独立补丁清单与引擎是否同源。
//
// 用法：node patches/verify-catalog.mjs [--json]
//   退出码 0 = 一致；1 = 有差异（会逐条列出）；2 = 环境问题（缺文件/解析失败）
//
// 校验三件事：
//   1. catalog.json 自身完整（条数、digest 与逐条 replacements 指纹）
//   2. catalog.mjs 与 catalog.json 数据一致（ESM 产物没被手改）
//   3. 与 lib/core.js 的 ALL_PATCHES 逐条一致（清单没跟引擎脱节）
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CORE = join(HERE, 'vendor', 'core.js');
const JSON_PATH = join(HERE, 'catalog.json');
const ESM_PATH = join(HERE, 'catalog.mjs');
const AS_JSON = process.argv.includes('--json');

const sha = (s) => createHash('sha256').update(String(s), 'utf8').digest('hex');
const rowDigest = (p) =>
  sha(JSON.stringify((p.replacements || []).map((r) => ({ pattern: String(r.pattern ?? ''), replace: String(r.replace ?? '') }))));
const catalogDigest = (rows) => sha(JSON.stringify(rows.map((p) => [p.id, rowDigest(p)])));

const problems = [];
const facts = {};

function bail(msg) {
  console.error(msg);
  process.exit(2);
}

if (!existsSync(JSON_PATH)) bail('缺 catalog.json：先跑 node patches/extract-catalog.mjs');
const cat = JSON.parse(readFileSync(JSON_PATH, 'utf8'));
facts.count = cat.count;
facts.digest = cat.digest;

// 1. 自身完整
const recomputed = catalogDigest(cat.patches);
if (recomputed !== cat.digest) {
  problems.push({ kind: 'self', detail: `catalog.digest 不符：文件里 ${cat.digest}，重算 ${recomputed}` });
}
if (cat.count !== cat.patches.length) {
  problems.push({ kind: 'self', detail: `count=${cat.count} 与 patches.length=${cat.patches.length} 不一致` });
}
const ids = cat.patches.map((p) => p.id);
if (new Set(ids).size !== ids.length) problems.push({ kind: 'self', detail: '存在重复 id' });

// 2. ESM 产物一致（可选：本仓库只落 catalog.json，catalog.mjs 存在时才校验）
if (existsSync(ESM_PATH)) {
  const esm = await import('file:///' + ESM_PATH.replace(/\\/g, '/'));
  const esmRows = esm.ALL_PATCHES || [];
  if (esmRows.length !== cat.patches.length) {
    problems.push({ kind: 'esm', detail: `catalog.mjs 条数 ${esmRows.length} ≠ catalog.json ${cat.patches.length}` });
  } else if (catalogDigest(esmRows) !== cat.digest) {
    problems.push({ kind: 'esm', detail: 'catalog.mjs 数据与 catalog.json 不一致（被手改过？重新生成）' });
  }
}

// 3. 与引擎一致
if (!existsSync(CORE)) {
  problems.push({ kind: 'engine', detail: '缺 lib/core.js，跳过引擎比对' });
} else {
  const mod = await import('file:///' + CORE.replace(/\\/g, '/'));
  const live = mod.ALL_PATCHES || [];
  facts.engineCount = live.length;
  facts.engineDigest = catalogDigest(live);
  if (live.length !== cat.patches.length) {
    problems.push({ kind: 'engine', detail: `引擎 ${live.length} 条 ≠ 清单 ${cat.patches.length} 条` });
  }
  const byId = new Map(cat.patches.map((p) => [String(p.id), p]));
  for (const p of live) {
    const row = byId.get(String(p.id));
    if (!row) { problems.push({ kind: 'engine', detail: `引擎有 id=${p.id}（${p.name}）但清单里没有` }); continue; }
    if (rowDigest(p) !== row.digest) {
      problems.push({ kind: 'engine', detail: `id=${p.id}（${p.name}）replacements 不一致：引擎 ${rowDigest(p).slice(0, 12)} vs 清单 ${String(row.digest).slice(0, 12)}` });
    }
  }
  const liveIds = new Set(live.map((p) => String(p.id)));
  for (const row of cat.patches) {
    if (!liveIds.has(String(row.id))) problems.push({ kind: 'engine', detail: `清单有 id=${row.id}（${row.name}）但引擎里没有` });
  }
}

// 补充统计
facts.by_layer = cat.patches.reduce((acc, p) => {
  const k = p.layer || '(none)';
  acc[k] = (acc[k] || 0) + 1;
  return acc;
}, {});
facts.replacement_pairs = cat.patches.reduce((n, p) => n + (p.replacements || []).length, 0);
facts.problems = problems.length;

if (AS_JSON) {
  console.log(JSON.stringify({ ok: problems.length === 0, facts, problems }, null, 2));
} else {
  console.log('catalog   ' + JSON_PATH);
  console.log('engine    ' + CORE);
  console.log(`count     ${facts.count} 条 · replacements ${facts.replacement_pairs} 对`);
  console.log('digest    ' + facts.digest);
  console.log('layers    ' + Object.entries(facts.by_layer).map(([k, v]) => `${k}:${v}`).join('  '));
  if (problems.length === 0) {
    console.log('结果      ✅ 清单与引擎逐条一致');
  } else {
    console.log(`结果      ❌ ${problems.length} 处差异`);
    for (const p of problems) console.log(`  [${p.kind}] ${p.detail}`);
  }
}
process.exit(problems.length === 0 ? 0 : 1);
