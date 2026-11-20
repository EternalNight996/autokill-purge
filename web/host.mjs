// 宿主破甲（照搬 dsh-purge 1.1.71 的补丁引擎）+ 备份/恢复闭环。
//
// 分工（1.1.7 起）：补丁清单与补丁引擎**都在本仓库内**（web/patch-engine/），运行时零外部依赖。
//   · 清单：web/patch-engine/catalog.json（83 条，由 extract-catalog.mjs 从 vendor 引擎抽出）
//   · 引擎：web/patch-engine/vendor/core.js（上游 lib/core.js 的 12 模块相对 import 闭包，477 KB）
// 外部 dsh-purge 只在「想升级引擎」时才用：node scripts/vendor-dsh-engine.mjs --from <上游根>。
// 实测口径：把上游目录整个改名隐藏，hostStatus 仍返回 83 条 / engine=true / drift.same=true。
//
// 恢复闭环两级：
//   1. 快照（snapshot）：apply 前把「被补丁的文件当前内容」整份复制到 data/host-snapshots/<ts>/
//      → 撤销上一次 = 用最近一份快照覆盖回去。
//   2. 基线（baseline）：原件从官方 resources/app.asar 里按需精确提取（不整包解压）
//      → 恢复出厂 = 用 asar 原始内容覆盖回去，再清本仓库的状态默认值。
//
// 安全约束：这里任何写宿主的动作都只在被显式调用时发生（路由带 confirm），并且必然先备份；
// 备份失败则不写。恢复出厂不依赖 dsh-purge 的 .bak（本机实测 .bak 数为 0，靠不住）。
import { open, readFile, writeFile, mkdir, readdir, copyFile, stat, rm, rename } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE_DIR = dirname(fileURLToPath(import.meta.url));

/** 本仓库内化的引擎（web/patch-engine/vendor/core.js）：默认就走它，不依赖任何外部 dsh-purge */
const VENDORED_ENGINE = join(HERE_DIR, 'patch-engine', 'vendor');
/** DSH_PURGE_ENGINE=- 表示禁用引擎：只读清单，不落盘（自检/纯展示用） */
const ENGINE_DISABLED = process.env.DSH_PURGE_ENGINE === '-';
const DSH_PURGE_CANDIDATES = ENGINE_DISABLED ? [] : [
  process.env.DSH_PURGE_ENGINE || VENDORED_ENGINE,   // 1) 本仓库 vendor（默认）
  VENDORED_ENGINE,
  // 2) 以下仅为「有就用」的兜底，不是依赖：vendor 在就不会看它们
  'C:/Users/Administrator/AppData/Local/Programs/DeepSeek Harness/resources/plugins/dsh-purge',
  join(process.env.USERPROFILE || '', '.dsh/profiles/desktop/node_modules/dsh-purge'),
  join(process.env.USERPROFILE || '', '.dsh/profiles/web/node_modules/dsh-purge'),
];

/** 补丁清单（catalog.json）候选位置；环境变量 DSH_PATCH_CATALOG 可指定单文件 */
const CATALOG_CANDIDATES = [
  process.env.DSH_PATCH_CATALOG || '',
  join(HERE_DIR, 'patch-engine', 'catalog.json'),   // 本仓库自带
  join(HERE_DIR, '..', 'patches', 'catalog.json'),
  join(process.env.DSH_HOME || join(process.env.USERPROFILE || '', '.dsh'), 'patches', 'catalog.json'),
];
const ASAR_PATH = 'C:/Users/Administrator/AppData/Local/Programs/DeepSeek Harness/resources/app.asar';
const APP_DIR = 'C:/Users/Administrator/AppData/Local/Programs/DeepSeek Harness/resources/app';
// 控制台是 web 进程，但宿主可以是同一台机器上的桌面壳：
// 显式给引擎一个桌面壳入口，避免 officialShellMain() 因 surface!==desktop 直接返回空。
try { if (existsSync(join(APP_DIR, 'lib', 'main.js')) && !process.env.DSH_PURGE_DESKTOP_MAIN) process.env.DSH_PURGE_DESKTOP_MAIN = join(APP_DIR, 'lib', 'main.js'); } catch { /* ignore */ }

/** 引擎目录里 core.js 的位置：vendor 是平铺（<root>/core.js），上游是 <root>/lib/core.js */
function coreFileIn(root) {
  if (!root) return null;
  for (const c of [join(root, 'core.js'), join(root, 'lib', 'core.js')]) {
    if (existsSync(c)) return c;
  }
  return null;
}

let corePromise = null;
export function dshPurgeRoot() {
  for (const p of DSH_PURGE_CANDIDATES) {
    if (coreFileIn(p)) return p;
  }
  return null;
}

async function core() {
  if (corePromise) return corePromise;
  const root = dshPurgeRoot();
  const file = coreFileIn(root);
  if (!root || !file) {
    throw new Error(
      '找不到补丁引擎 core.js。补丁清单仍可用（内置 catalog），但要落盘注入需要引擎：' +
      '确认 web/patch-engine/vendor/core.js 存在（缺失就跑 node scripts/vendor-dsh-engine.mjs）'
    );
  }
  corePromise = import('file:///' + file.replace(/\\/g, '/'));
  return corePromise;
}

// ---- 独立补丁清单（catalog.json）：不依赖引擎就能拿到 83 条补丁定义 ------------
let catalogCache = null;

/** 补丁行指纹：与 patches/extract-catalog.mjs 完全同一算法，用来校验清单与引擎是否同源 */
function patchRowDigest(p) {
  const repl = Array.isArray(p.replacements)
    ? p.replacements.map((r) => ({ pattern: String(r.pattern ?? ''), replace: String(r.replace ?? '') }))
    : [];
  return cryptoHash(JSON.stringify(repl));
}

function cryptoHash(s) {
  // 同步 sha256，避免再多引依赖
  return createHash('sha256').update(String(s), 'utf8').digest('hex');
}

function catalogDigestOf(patches) {
  return cryptoHash(JSON.stringify(patches.map((p) => [p.id, patchRowDigest(p)])));
}

/** 读独立补丁清单；找不到返回 {ok:false, reason}，找到给出 83 条完整定义 */
export async function patchCatalog({ refresh = false } = {}) {
  if (catalogCache && !refresh) return catalogCache;
  const tried = [];
  for (const p of CATALOG_CANDIDATES) {
    if (!p) continue;
    tried.push(p);
    if (!existsSync(p)) continue;
    try {
      const raw = JSON.parse(await readFile(p, 'utf8'));
      if (!Array.isArray(raw.patches) || !raw.patches.length) throw new Error('catalog.patches 为空');
      catalogCache = {
        ok: true,
        path: p,
        count: raw.count || raw.patches.length,
        digest: raw.digest || catalogDigestOf(raw.patches),
        generatedAt: raw.generated_at || null,
        upstream: raw.upstream || null,
        brand: raw.brand || '梦神破甲',
        signedBy: raw.signed_by || null,
        groups: raw.groups || {},
        fieldKeys: raw.field_keys || [],
        patches: raw.patches,
      };
      return catalogCache;
    } catch (e) {
      catalogCache = { ok: false, reason: 'catalog 解析失败：' + ((e && e.message) || e), path: p, tried };
      return catalogCache;
    }
  }
  catalogCache = { ok: false, reason: '未找到独立补丁清单 catalog.json', tried };
  return catalogCache;
}

/** 引擎侧 ALL_PATCHES 的指纹，用于判断「清单」与「正在用的引擎」是否同源 */
export function engineCatalogDrift(enginePatches, catalog) {
  if (!catalog || !catalog.ok) return { comparable: false, reason: '无清单' };
  const list = Array.isArray(enginePatches) ? enginePatches : [];
  const engineCount = list.length;
  const engineDigest = catalogDigestOf(list);
  return {
    comparable: true,
    same: engineCount === catalog.count && engineDigest === catalog.digest,
    engineCount,
    catalogCount: catalog.count,
    engineDigest,
    catalogDigest: catalog.digest,
  };
}

// ---- asar 读取（只按需取单个文件，不整包解压） -------------------------------
let asarCache = null;
export async function asarHeader() {
  if (asarCache) return asarCache;
  if (!existsSync(ASAR_PATH)) throw new Error('找不到 app.asar：' + ASAR_PATH);
  const fh = await open(ASAR_PATH, 'r');
  try {
    const head = Buffer.alloc(16);
    await fh.read(head, 0, 16, 0);
    const headerSize = head.readUInt32LE(4);
    const jsonLen = head.readUInt32LE(12);
    const jbuf = Buffer.alloc(jsonLen);
    await fh.read(jbuf, 0, jsonLen, 16);
    asarCache = { header: JSON.parse(jbuf.toString('utf8')), dataStart: 8 + headerSize };
    return asarCache;
  } finally {
    await fh.close();
  }
}

function asarFind(header, relPath) {
  const parts = String(relPath).split('/').filter(Boolean);
  let cur = header;
  for (const p of parts) {
    if (!cur || !cur.files || !cur.files[p]) return null;
    cur = cur.files[p];
  }
  return cur && typeof cur.size === 'number' ? cur : null;
}

/** 从 app.asar 精确提取一个文件的原始内容；不存在返回 null */
export async function asarRead(relPath) {
  const { header, dataStart } = await asarHeader();
  const entry = asarFind(header, relPath);
  if (!entry) return null;
  const fh = await open(ASAR_PATH, 'r');
  try {
    const buf = Buffer.alloc(entry.size);
    if (entry.size) await fh.read(buf, 0, entry.size, dataStart + Number(entry.offset));
    if (entry.unpacked) {
      // 未打包进 asar 的文件放在 app.asar.unpacked/ 下
      const up = ASAR_PATH + '.unpacked/' + relPath;
      if (existsSync(up)) return readFile(up);
      return buf;
    }
    return buf;
  } finally {
    await fh.close();
  }
}

/**
 * 宿主被 patch 的文件清单：{ key: [绝对路径...] }。
 *
 * 必须扫**全部**宿主根（enumeratePatchAiBases），不能只信 gatherState().files：
 * 后者只覆盖「当前进程判定出的那一个宿主」，而 apply 会同时打到桌面 resources/app 与
 * npm-global/profile 副本。只备份一个根 = 另外几个根改了却没快照，撤销就成了假动作。
 */
async function hostFiles() {
  const c = await core();
  const state = await c.gatherState();
  const out = [];
  const seen = new Set();
  const push = (key, value) => {
    const abs = String(value || '').trim();
    if (!abs) return;
    const k = abs.replace(/\\/g, '/').toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ key: key, path: abs });
  };
  const bases = [];
  try {
    for (const b of c.enumeratePatchAiBases({ discover: true })) bases.push(b);
  } catch { /* 枚举失败就退回 state.files */ }
  for (const base of bases) {
    let files = null;
    try { files = c.targetFiles(base); } catch { continue; }
    for (const [key, value] of Object.entries(files || {})) {
      if (Array.isArray(value)) value.forEach((v) => push(key, v));
      else String(value || '').split(',').forEach((v) => push(key, v));
    }
  }
  for (const [key, value] of Object.entries(state.files || {})) {
    if (Array.isArray(value)) value.forEach((v) => push(key, v));
    else String(value || '').split(',').forEach((v) => push(key, v));
  }
  return { state: state, files: out, bases: bases };
}

/** 磁盘路径 → asar 内相对路径；映射不到返回 null（例如 asar 之外的用户文件） */
function toAsarRel(absPath) {
  const norm = String(absPath).replace(/\\/g, '/');
  const base = APP_DIR.replace(/\\/g, '/') + '/';
  // 1) 桌面版解包目录：resources/app/** → 原样
  if (norm.startsWith(base)) return norm.slice(base.length);
  // 2) profile 里 npm 装的副本：~/.dsh/profiles/<p>/node_modules/x → dsh/node_modules/x
  //    这两个 surface 各有一份文件，dsh-purge 会分别 patch，所以两边都要能还原。
  const m = norm.match(/\/\.dsh\/profiles\/[^/]+\/node_modules\/(.+)$/);
  if (m) return 'dsh/node_modules/' + m[1];
  // 3) npm 全局安装的 dsh：%APPDATA%/npm/node_modules/@deepseek-ai/dsh/node_modules/x
  const m3 = norm.match(/\/npm\/node_modules\/@deepseek-ai\/dsh\/node_modules\/(.+)$/);
  if (m3) return 'dsh/node_modules/' + m3[1];
  // 4) 其他安装形态：/DeepSeek Harness/resources/app/dsh/node_modules/...
  const m2 = norm.match(/\/resources\/app\/(dsh\/node_modules\/.+)$/);
  if (m2) return m2[1];
  return null;
}

/** asar 里的 dsh 版本 vs 磁盘上的 dsh 版本：不同源就不能拿 asar 原件覆盖（会把包灌成另一个版本） */
export async function asarVersion() {
  try {
    const buf = await asarRead('dsh/package.json');
    if (!buf) return null;
    return JSON.parse(buf.toString('utf8')).version || null;
  } catch { return null; }
}

async function diskDshVersion() {
  const candidates = [
    'C:/Users/Administrator/AppData/Roaming/npm/node_modules/@deepseek-ai/dsh/package.json',
    join(process.env.USERPROFILE || '', '.dsh/profiles/web/node_modules/@deepseek-ai/dsh/package.json'),
    join(process.env.USERPROFILE || '', '.dsh/profiles/desktop/node_modules/@deepseek-ai/dsh/package.json'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      try { return { version: JSON.parse(await readFile(p, 'utf8')).version || null, path: p }; } catch { /* next */ }
    }
  }
  return { version: null, path: null };
}

// ---- 状态 -------------------------------------------------------------------
/** 只有清单、没有引擎时，用它把 83 条照样列出来（状态一律 unknown，tone 走灰） */
function catalogOnlyRows(cat) {
  return (cat.patches || []).map((p) => {
    const name = p.name || p.raw?.name || ('patch-' + p.id);
    const layer = p.layer || p.raw?.layer || null;
    const layerEn = p.layer_en || p.raw?.layer_en || null;
    const tone = patchTone('unknown');
    return {
      id: p.id,
      name,
      nameZh: patchZh(name),
      layer,
      layerEn,
      status: 'unknown',
      tone: tone.tone,
      statusZh: tone.label,
      files: (p.rel || p.raw?.rel || []).join('/') || (p.file || p.raw?.file || ''),
      desc: p.desc || p.raw?.desc || '',
      replacements: (p.replacements || []).length,
    };
  });
}

export async function hostStatus(dataDir) {
  const root = dshPurgeRoot();
  const cat = await patchCatalog();
  const catalogInfo = cat.ok
    ? { ok: true, path: cat.path, count: cat.count, digest: cat.digest, generatedAt: cat.generatedAt, upstream: cat.upstream, brand: cat.brand, signedBy: cat.signedBy }
    : { ok: false, reason: cat.reason, tried: cat.tried || [] };
  if (!root) {
    // 引擎缺席：清单仍然完整（这是「脱离引擎」的核心）——区别只是不能落盘
    if (cat.ok) {
      const rows = catalogOnlyRows(cat);
      return {
        ok: true,
        available: false,
        engineAvailable: false,
        inventoryAvailable: true,
        reason: '未找到补丁引擎目录（清单可用，注入不可用）：把 dsh-purge 源码放到 ' + DEFAULT_ENGINE_DIR + '，或设 DSH_PURGE_ENGINE',
        dshPurgeRoot: null,
        catalog: catalogInfo,
        patches: rows,
        counts: { total: rows.length, applied: 0, pending: 0, failed: 0, na: rows.length, other: 0 },
        files: [],
        baseline: { asarPath: ASAR_PATH, readable: existsSync(ASAR_PATH) },
        snapshots: dataDir ? await listSnapshots(dataDir) : [],
      };
    }
    return {
      ok: false, available: false, engineAvailable: false, inventoryAvailable: false,
      reason: '既没有补丁引擎目录，也没有独立补丁清单 catalog.json',
      dshPurgeRoot: null, catalog: catalogInfo,
      patches: [], counts: { total: 0, applied: 0, pending: 0, failed: 0, na: 0, other: 0 },
      snapshots: [],
    };
  }
  let gather;
  try {
    gather = await hostFiles();
  } catch (e) {
    return { ok: false, available: false, engineAvailable: !!root, reason: '读取补丁引擎状态失败：' + ((e && e.message) || e), dshPurgeRoot: root, catalog: catalogInfo };
  }
  const c = await core();
  const st = gather.state;
  const drift = engineCatalogDrift(c.ALL_PATCHES, cat);
  // 每个宿主根单独统计：桌面 resources/app 才是「会被加载」的那份；npm-global / profile 副本只是陪跑。
  // 以前这里只读 gatherState().patch_status（= 当前进程判定的那一个宿主），
  // 结果界面绿了一片，桌面壳读的 app.asar 却一条都没改 —— 假绿就是这么来的。
  const hosts = [];
  for (const base of gather.bases || []) {
    let statusMap = {};
    try { statusMap = (await c.patchStatus(base)) || {}; } catch { statusMap = {}; }
    const cnt = { applied: 0, pending: 0, failed: 0, na: 0 };
    for (const s of Object.values(statusMap)) {
      const t = patchTone(s).tone;
      if (t === 'ok') cnt.applied += 1;
      else if (t === 'wait') cnt.pending += 1;
      else if (t === 'fail') cnt.failed += 1;
      else cnt.na += 1;
    }
    let hostWritten = false;
    try { hostWritten = c.hostCleanMarkersPresent(base); } catch { hostWritten = false; }
    hosts.push({
      aiBase: base,
      kind: (base.indexOf('\\resources\\app\\') >= 0 || base.indexOf('/resources/app/') >= 0) ? 'desktop' : 'package',
      applied: cnt.applied,
      pending: cnt.pending,
      failed: cnt.failed,
      na: cnt.na,
      hostWritten: hostWritten,
    });
  }
  const primary = hosts.find((h) => h.kind === 'desktop') || hosts[0] || null;
  let statusMap = st.patch_status || {};
  if (primary) {
    try { statusMap = (await c.patchStatus(primary.aiBase)) || statusMap; } catch { /* 读不到就用 gatherState 的 */ }
  }
  // app.asar 还在 = 桌面壳仍从 asar 里加载 dsh，resources/app 里的补丁一条都不生效
  const desktopSealed = desktopSealedNow(c);
  const patches = (c.ALL_PATCHES || []).map((p) => {
    const tone = patchTone(statusMap[p.id] || 'unknown');
    return {
      id: p.id,
      name: p.name,
      nameZh: patchZh(p.name),
      layer: p.layer,
      layerEn: p.layer_en,
      status: (st.patch_status && st.patch_status[p.id]) || 'unknown',
      tone: tone.tone,
      statusZh: tone.label,
    };
  });
  const applied = patches.filter((p) => p.tone === 'ok').length;
  const pending = patches.filter((p) => p.tone === 'wait').length;
  const failed = patches.filter((p) => p.tone === 'fail').length;
  const na = patches.filter((p) => p.tone === 'skip').length;
  let asarOk = false;
  try { await asarHeader(); asarOk = true; } catch { asarOk = false; }
  const snaps = dataDir ? await listSnapshots(dataDir) : [];
  return {
    ok: true,
    available: true,
    engineAvailable: true,
    inventoryAvailable: cat.ok,
    dshPurgeRoot: root,
    catalog: catalogInfo,
    catalogDrift: drift,
    surface: st.surface,
    hosts: hosts,
    primaryHost: primary,
    desktopSealed: desktopSealed,
    // false = 补丁写进去了但不会被加载（asar 还没挪走）：界面必须提示「落地并重启宿主」
    effective: !desktopSealed,
    dshHome: st.dsh_home,
    overridePath: st.override_path,
    overrideStatus: st.override_status,
    shim: { cmd: st.shim_cmd, ps1: st.shim_ps1, bin: st.shim_bin },
    patches: patches,
    counts: { total: patches.length, applied: applied, pending: pending, failed: failed, na: na, other: patches.length - applied - pending - failed - na },
    files: gather.files.map((f) => ({
      key: f.key,
      path: f.path,
      exists: existsSync(f.path),
      asarRel: toAsarRel(f.path),
    })),
    baseline: { asarPath: ASAR_PATH, readable: asarOk },
    snapshots: snaps,
  };
}

/** 只读：算「磁盘当前内容」与「asar 原件」的差异，用于确认基线可用、以及有多少文件被改过 */
export async function baselineDiff() {
  const { files } = await hostFiles();
  const rows = [];
  for (const f of files) {
    const rel = toAsarRel(f.path);
    if (!f.path || !existsSync(f.path)) { rows.push({ path: f.path, state: 'missing' }); continue; }
    const disk = await readFile(f.path);
    let orig = null;
    if (rel) {
      try { orig = await asarRead(rel); } catch { orig = null; }
    }
    if (!orig) { rows.push({ path: f.path, asarRel: rel, state: rel ? 'not-in-asar' : 'outside-app' }); continue; }
    const same = Buffer.compare(disk, orig) === 0;
    rows.push({
      path: f.path, asarRel: rel, state: same ? 'identical' : 'patched',
      diskBytes: disk.length, asarBytes: orig.length,
    });
  }
  const patched = rows.filter((r) => r.state === 'patched').length;
  return { total: rows.length, patched: patched, identical: rows.filter((r) => r.state === 'identical').length, rows: rows };
}

// ---- 快照 -------------------------------------------------------------------
const SNAP_DIR = (rootData) => join(rootData, 'host-snapshots');

function stamp() {
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export async function listSnapshots(dataDir) {
  const dir = SNAP_DIR(dataDir);
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of await readdir(dir)) {
    const manifest = join(dir, name, 'manifest.json');
    if (!existsSync(manifest)) continue;
    try {
      const m = JSON.parse(await readFile(manifest, 'utf8'));
      out.push({ id: name, at: m.at, tag: m.tag, files: (m.files || []).length, bytes: m.bytes || 0 });
    } catch { /* 跳过损坏快照 */ }
  }
  return out.sort((a, b) => String(b.id).localeCompare(String(a.id)));
}

/** 备份：把补丁会碰到的每个文件的当前内容整份复制下来，并记 sha256 */
export async function createSnapshot(dataDir, tag = 'manual') {
  const { files } = await hostFiles();
  const id = stamp() + '-' + String(tag).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 20);
  const dir = join(SNAP_DIR(dataDir), id);
  await mkdir(dir, { recursive: true });
  const { createHash } = await import('node:crypto');
  const manifest = { id: id, at: new Date().toISOString(), tag: tag, host: 'dsh', files: [], bytes: 0 };
  let i = 0;
  for (const f of files) {
    if (!f.path || !existsSync(f.path)) continue;
    const buf = await readFile(f.path);
    const name = String(i++).padStart(3, '0') + '-' + basename(f.path);
    await writeFile(join(dir, name), buf);
    manifest.files.push({
      key: f.key, path: f.path, blob: name, bytes: buf.length,
      sha256: createHash('sha256').update(buf).digest('hex'),
    });
    manifest.bytes += buf.length;
  }
  await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  return { id: id, files: manifest.files.length, bytes: manifest.bytes, at: manifest.at };
}

/** 撤销上一次：用指定快照（默认最近一份）覆盖回宿主 */
export async function restoreSnapshot(dataDir, id) {
  const snaps = await listSnapshots(dataDir);
  if (!snaps.length) throw new Error('还没有任何快照：先点一次「备份现在」');
  const target = id ? snaps.find((s) => s.id === id) : snaps[0];
  if (!target) throw new Error('找不到快照 ' + id);
  const dir = join(SNAP_DIR(dataDir), target.id);
  const m = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
  const done = [];
  for (const f of m.files || []) {
    if (!f.path || !f.blob) continue;
    await mkdir(dirname(f.path), { recursive: true });
    await copyFile(join(dir, f.blob), f.path);
    done.push(f.path);
  }
  return { id: target.id, restored: done.length, paths: done };
}

/** 恢复出厂：用官方 app.asar 的原件覆盖被 patch 的文件（不依赖 .bak） */
export async function factoryRestore() {
  const { files } = await hostFiles();
  const av = await asarVersion();
  const dv = await diskDshVersion();
  const sameSource = !!(av && dv.version && av === dv.version);
  const done = [];
  const skipped = [];
  for (const f of files) {
    const rel = toAsarRel(f.path);
    if (!rel || !existsSync(f.path)) { skipped.push({ path: f.path, why: rel ? 'missing' : 'outside-app' }); continue; }
    let orig = null;
    try { orig = await asarRead(rel); } catch { orig = null; }
    if (!orig) { skipped.push({ path: f.path, why: 'not-in-asar' }); continue; }
    const disk = await readFile(f.path);
    if (Buffer.compare(disk, orig) === 0) { skipped.push({ path: f.path, why: 'already-original' }); continue; }
    await writeFile(f.path, orig);
    done.push(f.path);
  }
  return {
    restored: done.length,
    skipped: skipped.length,
    paths: done,
    skippedDetail: skipped.slice(0, 50),
    source: { asarVersion: av, diskVersion: dv.version, sameSource: sameSource },
    // 版本不同源时仍按 asar 原件覆盖会让包变成另一个版本：这时应当重装对应包，而不是抄 asar。
    note: sameSource
      ? '已用官方 app.asar 原件覆盖，重启 dsh 生效'
      : 'asar 与磁盘的 dsh 版本不一致：请优先重装对应包（npm i -g @deepseek-ai/dsh@<version>），本结果仅作参考',
  };
}

/** 应用补丁：调 dsh-purge 的原版引擎（会改宿主，必须重启 dsh 生效） */
/**
 * 应用 / 还原宿主补丁。
 *
 * @param {'apply'|'revert'} kind
 * @param {{patchIds?:string[]}} [opts] patchIds 为空 = 全部补丁；给了就只应用这些
 *
 * 注意还原的边界：补丁是**文件级字节替换**，多个补丁共用一个 `.dshpurge.bak`，
 * 所以核心层只有 revertAll（按文件还原），没有「按补丁还原」。自选应用 + 整份还原是安全组合：
 * 备份点永远是第一次应用前的状态。
 */
/**
 * 在「桌面面」下跑一段逻辑。
 *
 * 控制台是裸 node 进程，引擎的 detectSurface() 会判成 "web"，于是
 * sealedAsarHandoff() 直接返回 null：既不会解开 app.asar，也不会挪走它。
 * 上游的 apply 一直跑在桌面宿主进程里，所以这段判断天然成立 —— 我们得自己把面标对。
 */
async function asDesktopSurface(fn) {
  const prev = process.env.DSH_SURFACE;
  process.env.DSH_SURFACE = 'desktop';
  try { return await fn(); } finally {
    if (prev === undefined) delete process.env.DSH_SURFACE;
    else process.env.DSH_SURFACE = prev;
  }
}

/** 密封桌面宿主（asar 还在 = 补丁不会被加载）的只读探测 */
function sealedHandoff(c) {
  try {
    return c.sealedAsarHandoff({ surface: 'desktop', discover: true }) || null;
  } catch { return null; }
}

function desktopSealedNow(c) {
  try { return !!c.desktopAsarStillSealed({ surface: 'desktop' }); } catch { return false; }
}

export async function applyHostPatches(kind, opts = {}) {
  return asDesktopSurface(() => applyHostPatchesInner(kind, opts));
}

async function applyHostPatchesInner(kind, { patchIds = [] } = {}) {
  const c = await core();
  // 与上游 apply 同口径：先把 DSH_HOME / 桌面安装目录钉住，清掉定位缓存，
  // 否则这次 apply 可能落到另一份 dsh 上（上游 lib/index.js 的 apply 也是这三步打头）。
  try { c.applyRuntimeEnv?.(); } catch { /* 非致命 */ }
  try { c.clearDesktopLocateCache?.(); } catch { /* 非致命 */ }
  if (kind === 'revert') {
    const r = await c.revertAllHosts();
    return {
      mode: 'revert',
      reverted: r.reverted || [],
      errors: r.errors || [],
      note: '还原是文件级（补丁共用 .dshpurge.bak），只能整份还原',
    };
  }
  const all = Array.isArray(c.ALL_PATCHES) ? c.ALL_PATCHES : [];
  const want = (Array.isArray(patchIds) ? patchIds : []).map((x) => String(x || '').trim()).filter(Boolean);
  const subset = want.length
    ? all.filter((p) => want.includes(String(p.id)) || want.includes(String(p.name)))
    : all;
  if (want.length && !subset.length) throw new Error('没有一个补丁匹配：' + want.join(', ') + '（可用 /api/host/status 拿 id 清单）');
  // 引擎内部的收尾（silenceCmdFlash 之类）一旦抛错，会把「已经写进去的宿主」连带丢掉。
  // 这里兜住：报错也把逐宿主复核结果带回去，绝不出现「看着失败 / 其实半写」这种哑弹。
  let r = null;
  let applyError = null;
  try {
    r = await c.applyPatchesAllHosts(subset, { preserveClientBundles: false, forApply: true });
  } catch (e) {
    applyError = String((e && e.message) || e);
    r = { hosts: [], report: [] };
  }
  // 上游 apply 在补丁之后还有一步 patchAllShims()：把 npm bin / ps1 启动壳重新指向被洗过的宿主。
  // 少了它，命令行启动的 dsh 仍会走旧入口（桌面图标每次重新解析）。
  let shim = null;
  try { shim = await c.patchAllShims(); } catch (e) { shim = { error: String((e && e.message) || e) }; }
  const applied = (r.report || []).filter((x) => x.status === 'applied').length;
  const already = (r.report || []).filter((x) => x.status === 'already').length;
  let hosts = (r.hosts || []).map((h) => h.aiBase);
  if (!hosts.length) {
    // 半途抛错时用整体枚举兜底，至少让人看见哪些宿主真的被改过
    try { hosts = c.enumeratePatchAiBases({ discover: true }); } catch { hosts = []; }
  }
  // 逐宿主复核：报告说 applied 不算数，回读一遍文件才知道到底写进去没有
  const verified = [];
  for (const base of hosts) {
    let statusMap = {};
    try { statusMap = (await c.patchStatus(base)) || {}; } catch { statusMap = {}; }
    let pending = 0;
    for (const s of Object.values(statusMap)) if (s === 'pending') pending += 1;
    let hostWritten = false;
    try { hostWritten = c.hostCleanMarkersPresent(base); } catch { hostWritten = false; }
    verified.push({ aiBase: base, pending: pending, hostWritten: hostWritten });
  }
  const desktopSealed = desktopSealedNow(c);
  return {
    mode: 'apply',
    selected: subset.length,
    total: all.length,
    ids: subset.map((p) => p.id),
    hosts: hosts,
    verified: verified,
    shim: shim,
    applied,
    already,
    applyError: applyError,
    desktopSealed: desktopSealed,
    // 这一条就是「注入了却没反应」的开关：true 时必须点「落地并重启宿主」
    pendingHandoff: desktopSealed,
    restartRequired: true,
    note: desktopSealed
      ? '补丁已写进 resources/app，但 resources/app.asar 还在：桌面壳按 app.getAppPath() 仍从 asar 里加载 dsh，重启也不会变。必须再执行「落地并重启宿主」（挪走 asar + 重启 exe）。'
      : '补丁已写进当前宿主（asar 已让位），重启 dsh 即生效。',
  };
}

/** 目录是否可用（只读自检，供 readiness 用）：注入 = 引擎在 + asar 可读 */
export function hostFeatureAvailable() {
  return !!(dshPurgeRoot() && existsSync(ASAR_PATH));
}

/** 清单是否可用（不需要引擎）：独立 catalog 存在即可 */
export async function hostInventoryAvailable() {
  const cat = await patchCatalog();
  return !!cat.ok;
}

// ---- 落地（sealed handoff）：为什么注入完还得再走一步 -----------------------
//
// 桌面壳启动 dsh 用的路径是 `path.join(app.getAppPath(), "dsh")`；官方包把整个 app 打成
// resources/app.asar，所以 getAppPath() = `<resources>\app.asar`，命令行里就能看到
// `<resources>\app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\index.js`。
// 结论：只要 app.asar 还在，旁边那份 resources/app 里的字节替换**一条都不会被加载**，
// 重启多少次都一样。必须先结束宿主 → 把 app.asar 改名让位 → 再拉起 exe。
// 上游 dsh-purge 的 apply 末尾就是 restartSealedDesktopIfNeeded() 干这件事；
// autokill-purge 的旧 apply 只有 applyPatchesAllHosts()，缺的正是这一步。

const DESKTOP_EXE_GUESS = 'C:/Users/Administrator/AppData/Local/Programs/DeepSeek Harness/DeepSeek Harness.exe';

function asidePathFor(asar) {
  return asar + '.dshpurge-aside';
}

/** 只读：现在到底是不是「补丁写了但不生效」的状态 */
export async function hostHandoffStatus() {
  const c = await core();
  return asDesktopSurface(async () => {
    const handoff = sealedHandoff(c);
    const sealed = desktopSealedNow(c);
    // 落地之后 app.asar 已经不存在，sealedHandoff() 会返回 null；
    // 但 aside 副本还在旁边（回滚要用），所以这里始终用固定路径算 aside，不再吊在 asar 是否存在上。
    const asarPath = handoff?.asar || ASAR_PATH;
    const asarExists = existsSync(asarPath);
    const aside = asidePathFor(asarPath);
    const appDir = join(dirname(asarPath), 'app');
    const asideExists = !!(aside && existsSync(aside));
    return {
      ok: true,
      sealed: sealed,                 // true = 需要落地
      effective: !sealed,             // false = 桌面壳读的是 asar，补丁不生效
      exe: handoff?.exe || (existsSync(DESKTOP_EXE_GUESS) ? DESKTOP_EXE_GUESS : null),
      asar: asarExists ? asarPath : null,
      asarPath: asarPath,             // 落地后这里指向已不存在的路径，仅作定位用
      asarExists: asarExists,
      aside: aside,
      asideExists: asideExists,       // true = 之前落地过（asar 已让位，副本可回滚）
      appDir: appDir,
      appDirPatched: !!(appDir && existsSync(join(appDir, 'dsh', 'package.json'))),
      // 这里要看的是「桌面那份」的版本，不是 npm-global 残留
      dshVersionOnDisk: await readDesktopDshVersion(appDir),
      dshVersionInAsar: await asarVersion(),
    };
  });
}

async function readDesktopDshVersion(appDir) {
  if (!appDir) return null;
  try {
    const raw = JSON.parse(await readFile(join(appDir, 'dsh', 'package.json'), 'utf8'));
    return raw.version || null;
  } catch { return null; }
}

function runDetached(cmd, args) {
  return new Promise((resolve) => {
    let done = false;
    try {
      const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true });
      child.on('error', (e) => { if (!done) { done = true; resolve({ ok: false, error: String((e && e.message) || e) }); } });
      child.on('spawn', () => { if (!done) { done = true; resolve({ ok: true, pid: child.pid }); } });
      child.unref();
    } catch (e) {
      resolve({ ok: false, error: String((e && e.message) || e) });
    }
  });
}

/**
 * 结束宿主：按映像名两段式（先温和，再强制）。
 *
 * 刻意**不用 /T**。/T 会顺着主进程把整棵子树端掉；而本函数常被「挂在宿主树里的一方」触发
 * （宿主自己的插件、PTC 派生的 watcher、控制台的子进程），/T 会把调用方一起杀。
 * 2026-11-18 18:07 那次落地就是这么自杀的：45 个同名进程连同 watcher 一起没了，
 * 日志停在 "before: asar exists=true"，asar 根本没来得及改名。
 * 只按映像名杀，watcher（node.exe）不受牵连。
 */
async function killDesktopHost(exe) {
  if (!exe) return { ok: false, error: 'no_exe' };
  const image = basename(exe);
  const soft = await runDetached('taskkill', ['/IM', image]);
  await new Promise((r) => setTimeout(r, 2000));
  const hard = await runDetached('taskkill', ['/IM', image, '/F']);
  await new Promise((r) => setTimeout(r, 1200));
  return { ok: true, soft: soft, hard: hard, image: image, tree: false };
}

/** 等 asar 的锁释放后改名让位（Electron 退出时文件句柄有几秒延迟） */
async function moveAsarAside(asar, aside, timeoutMs = 20000) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeoutMs) {
    try {
      if (!existsSync(asar)) return { ok: true, already: true };
      await rename(asar, aside);
      return { ok: true, moved: true, aside: aside };
    } catch (e) {
      lastError = String((e && e.message) || e);
      await new Promise((r) => setTimeout(r, 700));
    }
  }
  return { ok: false, error: lastError };
}

/**
 * 落地并重启桌面宿主。
 *
 * @param {{restart?:boolean}} [opts] restart=false 只让 asar 让位、不拉起来（想手动开）
 */
export async function finishHostHandoff({ restart = true } = {}) {
  const c = await core();
  return asDesktopSurface(async () => {
    const handoff = sealedHandoff(c);
    const asar = handoff?.asar || ASAR_PATH;
    const exe = handoff?.exe || (existsSync(DESKTOP_EXE_GUESS) ? DESKTOP_EXE_GUESS : null);
    if (!exe) {
      return { ok: false, error: 'no_desktop_install', note: '没找到桌面宿主 exe：这台机器上可能只装了 web/CLI 版 dsh，那种情况补丁本来就会直接生效，不需要落地。' };
    }
    if (!existsSync(asar)) {
      return { ok: true, needed: false, asarMoved: true, appDir: join(dirname(asar), 'app'), note: 'app.asar 已经不在了：resources/app 就是当前宿主，重启即生效。' };
    }
    // 1) 挪走 asar 前先确认 resources/app 真的有完整宿主，否则挪完就打不开了
    const appDir = join(dirname(asar), 'app');
    const pkg = join(appDir, 'dsh', 'package.json');
    if (!existsSync(pkg)) {
      return {
        ok: false,
        error: 'app_dir_incomplete',
        appDir: appDir,
        note: 'resources/app 里没有 dsh/package.json，现在挪 asar 会让桌面打不开。先点一次「一键注入」把 asar 解开再来。',
      };
    }
    // 2) 结束宿主
    const killed = await killDesktopHost(exe);
    // 3) asar 让位（保留原名 + .dshpurge-aside，可一键放回）
    let aside = asidePathFor(asar);
    if (existsSync(aside)) {
      try { await rm(aside, { force: true }); } catch { /* 上一次的残留，删不掉就换个名 */ }
    }
    if (existsSync(aside)) aside = aside + '-' + Date.now();
    const moved = await moveAsarAside(asar, aside);
    if (!moved.ok) {
      return { ok: false, error: 'asar_locked', detail: moved.error, killed: killed, note: 'app.asar 一直被占用：宿主可能还活着，等它退干净再点一次。' };
    }
    // 4) 重新拉起（此时 app.getAppPath() 回落到 resources/app）
    let launched = null;
    if (restart) {
      launched = await runDetached(exe, []);
    }
    return {
      ok: true,
      needed: true,
      asarMoved: true,
      asar: asar,
      aside: moved.aside || aside,
      appDir: appDir,
      killed: killed,
      launched: launched,
      restarting: !!(launched && launched.ok),
      note: restart
        ? 'app.asar 已让位，宿主已重新拉起：现在加载的是 resources/app/dsh，83 条补丁这次才真的生效。想回滚就把 app.asar.dshpurge-aside 改回 app.asar。'
        : 'app.asar 已让位；手动打开桌面宿主即生效。回滚：把 app.asar.dshpurge-aside 改回 app.asar。',
    };
  });
}

/** 撤销落地：把 asar 放回去（宿主下次启动就又读 asar 原件） */
export async function restoreHostAsar() {
  const asar = ASAR_PATH;
  const aside = asidePathFor(asar);
  if (!existsSync(aside)) return { ok: false, error: 'no_aside', note: '没找到 ' + aside + '，说明没走过落地（或已经放回过）。' };
  if (existsSync(asar)) return { ok: false, error: 'asar_present', note: 'app.asar 已经在了，不需要放回。' };
  try {
    await rename(aside, asar);
    return { ok: true, restored: true, asar: asar, restartRequired: true, note: 'asar 已放回：下次启动桌面宿主会重新读 asar 原件（补丁失效）。' };
  } catch (e) {
    return { ok: false, error: 'rename_failed', detail: String((e && e.message) || e) };
  }
}

// ---- 补丁中文名（原版只有英文常量名，界面上要中英并列） ----------------------
const PATCH_ZH = {
  WORKSPACE_CONTEXT_INTRO: '工作区上下文开场白',
  REPLACEMENT_WORKSPACE_CONTEXT_INTRO: '工作区上下文开场白（替换版）',
  SCOPE_INTRO: '范围说明注入',
  SYSTEM_PROMPT_PERSONA: '系统提示词人格',
  WEB_PRESET_IDENTITY_STRIP: '网页预设身份剥离',
  PRESET_UNRESTRICTED_IDENTITY_STRIP: '预设身份剥离（无限制版）',
  PRESET_SHELL_NETWORK: '预设放行 shell 网络',
  PRESET_BASH_MIRROR_LINE: '预设 bash 镜像行',
  LIANGSHEN_IDENTITY_LINE: '「梁神」身份行',
  LIANGSHEN_PHASE1_KEEP_INJECT: '「梁神」阶段一保留注入',
  APPROVAL_NEVER_SENTENCE: '审批「永不询问」话术',
  APPROVAL_NEVER_SENTENCE_BYPASS: '审批话术绕过（永不）',
  APPROVAL_ASK_SENTENCE_BYPASS: '审批话术绕过（询问）',
  APPROVAL_POLICY_DEFAULT: '审批策略默认值',
  APPROVAL_CONFIG_DEFAULT_NEVER: '审批配置默认「永不」',
  APPROVAL_AUTO_GRANT: '审批自动放行',
  SANDBOX_DENY_FILE_WRITE: '沙箱禁止写文件（解除）',
  SANDBOX_MODE_DEFAULT: '沙箱模式默认值',
  SANDBOX_CONFINE_PASSTHROUGH: '沙箱限制放行',
  SANDBOX_HINT_NEUTRAL: '沙箱提示中性化',
  ESCALATION_WIDENING_EXEMPT: '提权扩权豁免',
  ESCALATION_GRANT_UNCONDITIONAL: '提权无条件授予',
  ESCALATION_NEVER_REJECT: '提权请求永不拒绝',
  FS_FENCE_DISABLED: '文件系统围栏关闭',
  FS_OBSERVATION_INTENT_FREE: '文件观察免意图声明',
  REPEAT_TOOL_REMINDER_DISABLED: '重复工具提醒关闭',
  TOOL_RESULT_PRUNER_DISABLED: '工具结果裁剪关闭',
  BASH_TIMEOUT_RESTORE: 'bash 超时恢复',
  READ_CAPS_RAISED: '读取上限提高',
  SUBAGENT_MAXDEPTH_RAISED: '子代理层数上限提高',
  PRESET_FETCH_ENABLED: '预设启用网络抓取',
  HARNESS_IDENTITY_STRIP: '宿主身份剥离',
  MINIMAL_PERSONA_PURGE: '最小预设人格清除',
  MINIMAL_OFFICIAL_TOOLSET: '最小官方工具集',
  WEB_SURFACE_IDENTITY_NEUTRAL: '网页端身份中性化',
  WEB_SURFACE_PROHIBITION: '网页端禁止话术解除',
  TOOL_WEB_UNTRUSTED_NEUTRAL: '网页工具不可信提示中性化',
  TOOL_SHELL_DENIAL_PROMPT: 'shell 拒绝话术',
  TOOL_SHELL_DELETE_MOVE_NEUTRAL: '删除/移动话术中性化',
  TOOL_FS_ESCALATION_SCHEMA: '文件工具提权结构',
  HOOKS_CLAUDE_DENY_ALLOW: 'Claude 钩子允许清单',
  HOOKS_CODEX_DENY_ALLOW: 'Codex 钩子允许清单',
  HOOKS_STOP_STEER_NEUTRAL: '停止/转向钩子中性化',
  HOOKS_PRESTEP_REJECT_NEUTRAL: '前置拒绝钩子中性化',
  SUBAGENT_SCOPE_LOCK_NEUTRAL: '子代理范围锁中性化',
  PERSONA_TEXT_PREFIX_ALIAS: '人格文本前缀别名',
  SESSION_V0_PLUGIN_SUMMARY_ALIAS: '会话 v0 插件摘要别名',
  SESSION_REFERENCE_FRAMING_NEUTRAL: '会话引用框架中性化',
  SESSION_LOG_UPLOAD_DEFAULT_OFF: '会话日志上传默认关闭',
  SESSION_PROMPT_ALWAYS_FOLLOWUP: '提示后总是追问',
  SESSION_STEER_ALWAYS_FOLLOWUP: '转向后总是追问',
  PROMPT_VARIABLE_FALLBACK: '提示词变量兜底',
  COMPLETE_PROMPT_KEEP_INJECT: '完整提示词保留注入',
  SETTINGS_LEGACY_API: '设置旧版接口',
  OFFICIAL_DESKTOP_UPDATE_HANDOFF: '桌面更新交接',
  OFFICIAL_DESKTOP_UPDATE_ASCII: '桌面更新 ASCII 兼容',
  ANTHROPIC_OAUTH_NO_CLAUDE_IDENTITY: 'Anthropic 登录不注入 Claude 身份',
  ANTHROPIC_OAUTH_CLI_NEUTRAL: 'Anthropic 登录 CLI 中性化',
  FRESH_SESSION_FULL_ACCESS: '新会话完全访问',
  DELIVERABLE_DO_NOT: '交付物 DO_NOT 段',
  SYSTEM_PROMPT_REPLACE_HEAD: '系统提示词头部替换',
  SYSTEM_PROMPT_RENDER_GUARD: '系统提示词渲染保护',
  ASSEMBLE_BEFORE_PRESTEP: '组装前置步骤',
  AGENT_LOOP_MESSAGES_GUARD: '代理循环消息保护',
  SYSTEM_NODES_CONTENT_GUARD: '系统节点内容保护',
  MODEL_STREAM_RELEASE: '模型流释放',
  MESSAGES_SYSTEM_CURRENT: '当前消息系统位',
  REWIND_HIDE_CUT_ONLY: '回溯仅隐藏截断',
  REWIND_DROP_SENT_ON_APPEND: '回溯追加丢弃已发',
  REWIND_RESET_TODOS: '回溯重置待办',
  REWIND_SKIP_DERIVE: '回溯跳过派生',
  DEEPSEEK_SYSTEM_ROLE: 'DeepSeek 系统角色',
  OFFICIAL_AUTO_REVIEW_PASSTHROUGH: '官方自动审查放行',
  OFFICIAL_RUN_CODE_APPROVAL_NEUTRAL: '运行代码审批中性化',
  OFFICIAL_SANDBOX_POLICY_NEUTRAL: '官方沙箱策略中性化',
  OFFICIAL_TOOL_ASK_FAILOPEN: '工具询问失败放行',
  OFFICIAL_PLAN_MODE_NEUTRAL: '计划模式中性化',
  OVERLAY_RESTORE_FROM_BAK: '从备份恢复覆盖层',
  DESKTOP_HOST_CLOSE_NO_FATAL: '桌面关闭不报错',
  DESKTOP_HOST_CLOSE_CODE0_NO_FAIL: '桌面关闭退出码 0',
  DESKTOP_SHELL_PROFILE_FALLBACK: '桌面 profile 回退',
  HUNG_PROMPT_LF_NEEDLE: '注入锚点 LF 匹配',
  HUNG_PROMPT_STRICT_NEEDLE: '注入锚点严格匹配',
};

export function patchZh(name) {
  const key = String(name || '').toUpperCase();
  return PATCH_ZH[key] || '';
}

/** 状态归一：ok=绿 / wait=黄 / skip=灰 / fail=红 */
export function patchTone(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'applied' || s === 'already') return { tone: 'ok', label: '已注入' };
  if (s === 'pending') return { tone: 'wait', label: '待注入' };
  if (s === 'na' || s === 'skipped') return { tone: 'skip', label: '已跳过' };
  if (s === 'missing_file' || s === 'error' || s === 'failed') return { tone: 'fail', label: '失败' };
  return { tone: 'skip', label: s || '未知' };
}

/** 卸载：调它的 uninstallPurge()（已应用则先还原，再清插件文件） */
export async function uninstallHostPurge() {
  const root = dshPurgeRoot();
  if (!root) throw new Error('dsh-purge 未安装');
  const mod = await import('file:///' + join(root, 'lib', 'uninstall.js').replace(/\\/g, '/'));
  const r = await mod.uninstallPurge();
  return { ok: !!r.ok, applied: r.applied, override: r.override || null, stripped: r.stripped || [], errors: r.errors || [] };
}

// ---- 注入提示词（~/.dsh/prompt-inject.md）：原版面板的「提示词」那一栏 --------------
function overridePath() {
  return join(process.env.DSH_HOME || join(process.env.USERPROFILE || '', '.dsh'), 'prompt-inject.md');
}

/** 内置默认（照搬 dsh-purge 1.1.71 的那份，去掉 HTML 注释头） */
async function builtinPrompt() {
  const raw = await readFile(join(HERE_DIR, 'prompts', 'sauce-1171.md'), 'utf8');
  return raw.replace(/^<!--[\s\S]*?-->\s*/, '');
}

export async function readPromptFile() {
  const p = overridePath();
  const { createHash } = await import('node:crypto');
  if (!existsSync(p)) {
    return { ok: true, exists: false, path: p, text: '', bytes: 0, sha256: null, mtime: null, isBuiltin: false };
  }
  const buf = await readFile(p);
  const st = await stat(p);
  let builtin = null;
  try { builtin = await builtinPrompt(); } catch { builtin = null; }
  const text = buf.toString('utf8');
  return {
    ok: true, exists: true, path: p, text: text, bytes: buf.length,
    sha256: createHash('sha256').update(buf).digest('hex'),
    mtime: st.mtime.toISOString(),
    isBuiltin: !!(builtin && text.trim() === builtin.trim()),
    builtinBytes: builtin ? Buffer.byteLength(builtin) : null,
  };
}

/** 写提示词：先备份现有文件（改前必留），再写；text 为空时拒绝 */
export async function writePromptFile(dataDir, text) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('提示词不能为空');
  const p = overridePath();
  await mkdir(dirname(p), { recursive: true });
  const backup = await backupPromptFile(dataDir, 'pre-write');
  await writeFile(p, text, 'utf8');
  return { ok: true, path: p, bytes: Buffer.byteLength(text), backup: backup };
}

/** 恢复内置默认提示词（= 原版「恢复默认提示词」） */
export async function resetPromptFile(dataDir) {
  const builtin = await builtinPrompt();
  const backup = await backupPromptFile(dataDir, 'pre-reset');
  const p = overridePath();
  await writeFile(p, builtin, 'utf8');
  return { ok: true, path: p, bytes: Buffer.byteLength(builtin), backup: backup };
}

async function backupPromptFile(dataDir, tag) {
  const p = overridePath();
  if (!existsSync(p)) return null;
  const dir = join(dataDir, 'host-snapshots', 'prompt-' + stamp() + '-' + tag);
  await mkdir(dir, { recursive: true });
  const name = 'prompt-inject.md';
  await copyFile(p, join(dir, name));
  const buf = await readFile(p);
  const { createHash } = await import('node:crypto');
  await writeFile(join(dir, 'manifest.json'), JSON.stringify({
    kind: 'prompt', at: new Date().toISOString(), tag: tag, path: p, blob: name,
    bytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex'),
  }, null, 2) + '\n', 'utf8');
  return dir;
}

/** 本机 DSH 主目录 */
function dshHome() {
  return process.env.DSH_HOME || join(process.env.USERPROFILE || '', '.dsh');
}

/** 原版面板其他几栏的现状：规则集 / 技能 / 工具库 / 出口白名单 */
export async function hostInventory() {
  const dsh = dshHome();
  const out = { dshHome: dsh, rules: null, skills: null, redteam: null, netScope: null, prompt: null };
  const rulesDir = join(dsh, 'rules');
  if (existsSync(rulesDir)) {
    const files = await readdir(rulesDir).catch(() => []);
    out.rules = { path: rulesDir, files: files.length, names: files.slice(0, 50) };
  }
  const skillsDir = join(dsh, 'skills');
  if (existsSync(skillsDir)) {
    const names = [];
    const walk = async (d, prefix) => {
      const entries = await readdir(d, { withFileTypes: true }).catch(() => []);
      for (const e of entries) {
        if (e.name.startsWith('.')) continue;
        const full = join(d, e.name);
        if (e.isDirectory()) await walk(full, prefix + e.name + '/');
        else if (/\.md$/i.test(e.name)) names.push(prefix + e.name);
      }
    };
    await walk(skillsDir, '');
    out.skills = { path: skillsDir, files: names.length, names: names.slice(0, 80) };
  }
  const rtDir = join(dsh, 'redteam');
  if (existsSync(rtDir)) {
    const top = await readdir(rtDir).catch(() => []);
    let files = 0;
    const countDir = async (d, depth) => {
      if (depth > 2) return;
      const entries = await readdir(d, { withFileTypes: true }).catch(() => []);
      for (const e of entries) {
        if (e.isDirectory()) await countDir(join(d, e.name), depth + 1);
        else files++;
      }
    };
    await countDir(rtDir, 0);
    out.redteam = { path: rtDir, top: top, files: files };
  }
  const ns = join(dsh, 'net-scope-allow.txt');
  if (existsSync(ns)) {
    const text = await readFile(ns, 'utf8').catch(() => '');
    out.netScope = { path: ns, lines: text.split(/\r?\n/).filter((l) => l.trim()).length };
  }
  return out;
}

// ---- 规则集 / 出口白名单 / 技能：原版面板的另外三栏（可读写） ---------------------
const SAFE_NAME = /^[\w\u4e00-\u9fa5][\w\u4e00-\u9fa5.\- ]{0,80}$/;

function safeName(name, suffix = '') {
  const n = String(name || '').trim();
  if (!SAFE_NAME.test(n)) throw new Error('名字不合法（只允许中英文、数字、下划线、点、连字符、空格）');
  return suffix && !n.toLowerCase().endsWith(suffix) ? n + suffix : n;
}

async function backupFile(dataDir, kind, srcPath) {
  if (!existsSync(srcPath)) return null;
  const dir = join(dataDir, 'host-snapshots', kind + '-' + stamp());
  await mkdir(dir, { recursive: true });
  const blob = basename(srcPath);
  await copyFile(srcPath, join(dir, blob));
  const { createHash } = await import('node:crypto');
  const buf = await readFile(srcPath);
  await writeFile(join(dir, 'manifest.json'), JSON.stringify({
    kind: kind, at: new Date().toISOString(), path: srcPath, blob: blob,
    bytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex'),
  }, null, 2) + '\n', 'utf8');
  return dir;
}

/** 规则集：~/.dsh/rules/*.md（原版「编辑提示词和多套规则」的规则那半） */
export async function listRules() {
  const dir = join(dshHome(), 'rules');
  const exists = existsSync(dir);
  const out = [];
  if (exists) {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (!e.isFile() || !/\.md$/i.test(e.name)) continue;
      const st = await stat(join(dir, e.name)).catch(() => null);
      out.push({ name: e.name, bytes: st ? st.size : 0, mtime: st ? st.mtime.toISOString() : null });
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return { ok: true, dir: dir, exists: exists, files: out };
}

export async function readRule(name) {
  const file = join(dshHome(), 'rules', safeName(name, '.md'));
  if (!existsSync(file)) return { ok: false, error: 'not_found', name: name, text: '' };
  const st = await stat(file);
  return { ok: true, name: basename(file), path: file, text: await readFile(file, 'utf8'), bytes: st.size, mtime: st.mtime.toISOString() };
}

export async function writeRule(dataDir, name, text) {
  if (typeof text !== 'string') throw new Error('正文必须是字符串');
  const dir = join(dshHome(), 'rules');
  await mkdir(dir, { recursive: true });
  const file = join(dir, safeName(name, '.md'));
  const backup = await backupFile(dataDir, 'rule', file);
  await writeFile(file, text, 'utf8');
  return { ok: true, path: file, name: basename(file), bytes: Buffer.byteLength(text), backup: backup };
}

export async function deleteRule(dataDir, name) {
  const file = join(dshHome(), 'rules', safeName(name, '.md'));
  if (!existsSync(file)) throw new Error('规则不存在：' + name);
  const backup = await backupFile(dataDir, 'rule', file);
  await rm(file, { force: true });
  return { ok: true, deleted: basename(file), backup: backup };
}

/** 出口白名单：~/.dsh/net-scope-allow.txt（原版「自己的服务器」那栏） */
export async function readNetScope() {
  const file = join(dshHome(), 'net-scope-allow.txt');
  const exists = existsSync(file);
  const text = exists ? await readFile(file, 'utf8') : '';
  return { ok: true, path: file, exists: exists, text: text, lines: text.split(/\r?\n/).filter((l) => l.trim()).length };
}

export async function writeNetScope(dataDir, text) {
  const file = join(dshHome(), 'net-scope-allow.txt');
  const backup = await backupFile(dataDir, 'net-scope', file);
  await writeFile(file, String(text || ''), 'utf8');
  return { ok: true, path: file, bytes: Buffer.byteLength(String(text || '')), backup: backup };
}

/** 技能：~/.dsh/skills/<name>/SKILL.md */
export async function listSkills() {
  const dir = join(dshHome(), 'skills');
  const exists = existsSync(dir);
  const out = [];
  if (exists) {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue;
      const md = join(dir, e.name, 'SKILL.md');
      if (!existsSync(md)) continue;
      const st = await stat(md).catch(() => null);
      out.push({ name: e.name, bytes: st ? st.size : 0, mtime: st ? st.mtime.toISOString() : null });
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return { ok: true, dir: dir, exists: exists, skills: out };
}

export async function readSkill(name) {
  const n = safeName(name);
  const file = join(dshHome(), 'skills', n, 'SKILL.md');
  if (!existsSync(file)) return { ok: false, error: 'not_found', name: n, text: '' };
  const st = await stat(file);
  return { ok: true, name: n, path: file, text: await readFile(file, 'utf8'), bytes: st.size, mtime: st.mtime.toISOString() };
}

export async function writeSkill(dataDir, name, text) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('技能正文不能为空');
  const n = safeName(name);
  const dir = join(dshHome(), 'skills', n);
  await mkdir(dir, { recursive: true });
  const file = join(dir, 'SKILL.md');
  const backup = await backupFile(dataDir, 'skill', file);
  await writeFile(file, text, 'utf8');
  return { ok: true, path: file, name: n, bytes: Buffer.byteLength(text), backup: backup };
}

export async function deleteSkill(dataDir, name) {
  const n = safeName(name);
  const dir = join(dshHome(), 'skills', n);
  if (!existsSync(dir)) throw new Error('技能不存在：' + name);
  const backup = await backupFile(dataDir, 'skill', join(dir, 'SKILL.md'));
  await rm(dir, { recursive: true, force: true });
  return { ok: true, deleted: n, backup: backup };
}
