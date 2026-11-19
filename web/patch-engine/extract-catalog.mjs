// 从 vendor/core.js（本仓库内化的补丁引擎）抽出全部宿主补丁定义，落成 catalog。
//
// 用法：node web/patch-engine/extract-catalog.mjs [--probe]
//   默认：写 catalog.json
//   --probe：只打印统计与样例字段，不落盘
//
// 之所以还能抽：vendor 里就是上游 lib/core.js 及其相对 import 闭包，
// ALL_PATCHES = PATCHES + CODE_PATCHES + ENGINE_PATCHES + NEW_TOOL_PATCHES 一字不差。
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CORE = join(HERE, 'vendor', 'core.js');
const PROBE = process.argv.includes('--probe');

const sha256 = (s) => createHash('sha256').update(String(s), 'utf8').digest('hex');

const mod = await import('file:///' + CORE.replace(/\\/g, '/'));
const ALL = mod.ALL_PATCHES || [];
const GROUPS = mod.PATCH_DISPLAY_GROUPS || {};

// 原始字段全集（函数不可序列化，标记后保留键名，便于对照）
const plain = (v) => JSON.parse(JSON.stringify(v, (k, val) => (typeof val === 'function' ? '[function]' : val)));

const FIELD_KEYS = new Set();
const patches = ALL.map((p) => {
  Object.keys(p || {}).forEach((k) => FIELD_KEYS.add(k));
  const replacements = Array.isArray(p.replacements)
    ? p.replacements.map((r) => ({ pattern: String(r.pattern ?? ''), replace: String(r.replace ?? '') }))
    : [];
  const row = {
    id: p.id,
    name: p.name ?? null,
    layer: p.layer ?? null,
    layer_en: p.layer_en ?? null,
    desc: p.desc ?? null,
    file: p.file ?? null,
    rel: p.rel ?? null,
    optional: p.optional ?? null,
    surfaces: p.surfaces ?? null,
    strictFiles: p.strictFiles ?? null,
    softSettle: p.softSettle ?? null,
    forbid: p.forbid ?? null,
    patterns: p.patterns ?? null,
    skipIfMarked: p.skipIfMarked ?? null,
    markersAny: p.markersAny ?? null,
    marker: p.marker ?? null,
    markers: p.markers ?? null,
    replacements,
    // 每条补丁自身的指纹：补丁内容一改就变，用来校验抽取结果与上游一致
    digest: sha256(JSON.stringify(replacements)),
    raw: plain(p),
  };
  return row;
});

const catalog = {
  schema: 1,
  name: 'dsh-purge · 宿主补丁目录（与引擎解耦）',
  upstream: {
    package: 'dsh-purge',
    version: '1.1.71',
    core: 'web/patch-engine/vendor/core.js (vendored)',
    note: '清单来自上游 ALL_PATCHES = PATCHES + CODE_PATCHES + ENGINE_PATCHES + NEW_TOOL_PATCHES',
  },
  generated_at: new Date().toISOString(),
  count: patches.length,
  field_keys: [...FIELD_KEYS].sort(),
  digest: sha256(JSON.stringify(patches.map((p) => [p.id, p.digest]))),
  groups: GROUPS,
  patches,
};

if (PROBE) {
  console.log(JSON.stringify({
    core: CORE,
    count: catalog.count,
    digest: catalog.digest,
    field_keys: catalog.field_keys,
    sample_ids: patches.slice(0, 6).map((p) => p.id),
    sample: patches[0],
    groups: Object.keys(GROUPS),
    by_surface: patches.reduce((acc, p) => {
      const k = p.surface ?? '(none)';
      acc[k] = (acc[k] || 0) + 1;
      return acc;
    }, {}),
    replacement_stats: {
      total_pairs: patches.reduce((n, p) => n + p.replacements.length, 0),
      with_markers: patches.filter((p) => Array.isArray(p.markers) && p.markers.length).length,
      with_files: patches.filter((p) => p.files).length,
    },
  }, null, 2));
  process.exit(0);
}

writeFileSync(join(HERE, 'catalog.json'), JSON.stringify(catalog, null, 2) + '\n', 'utf8');

// 只落 catalog.json（单份数据源）。之前还生成一份 349KB 的 catalog.mjs 是重复体积，
// 已去掉：需要 ESM 的地方用 readFileSync(join(HERE,'catalog.json')) 解析即可。
console.log(`catalog.json  ${catalog.count} patches  digest=${catalog.digest}`);
console.log(`engine        ${CORE}`);
