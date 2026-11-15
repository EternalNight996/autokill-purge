// 宿主破甲（照搬 dsh-purge 1.1.71 的补丁引擎）+ 备份/恢复闭环。
//
// 分工：破甲内容归本仓库（web/prompts/*），改宿主这件事交给本机已安装的 dsh-purge 1.1.71
// 的补丁引擎（lib/core.js 的 ALL_PATCHES / gatherState / revertAllHosts）。我们不复制它 344KB
// 的 patch 表，只驱动它 —— 效果与它原版一致，且升级它我们就跟着升级。
//
// 恢复闭环两级：
//   1. 快照（snapshot）：apply 前把「被补丁的文件当前内容」整份复制到 data/host-snapshots/<ts>/
//      → 撤销上一次 = 用最近一份快照覆盖回去。
//   2. 基线（baseline）：原件从官方 resources/app.asar 里按需精确提取（不整包解压）
//      → 恢复出厂 = 用 asar 原始内容覆盖回去，再清本仓库的状态默认值。
//
// 安全约束：这里任何写宿主的动作都只在被显式调用时发生（路由带 confirm），并且必然先备份；
// 备份失败则不写。恢复出厂不依赖 dsh-purge 的 .bak（本机实测 .bak 数为 0，靠不住）。
import { open, readFile, writeFile, mkdir, readdir, copyFile, stat, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';

const DSH_PURGE_CANDIDATES = [
  'C:/Users/Administrator/AppData/Local/Programs/DeepSeek Harness/resources/plugins/dsh-purge',
  join(process.env.USERPROFILE || '', '.dsh/profiles/desktop/node_modules/dsh-purge'),
  join(process.env.USERPROFILE || '', '.dsh/profiles/web/node_modules/dsh-purge'),
];
const ASAR_PATH = 'C:/Users/Administrator/AppData/Local/Programs/DeepSeek Harness/resources/app.asar';
const APP_DIR = 'C:/Users/Administrator/AppData/Local/Programs/DeepSeek Harness/resources/app';

let corePromise = null;
export function dshPurgeRoot() {
  for (const p of DSH_PURGE_CANDIDATES) {
    if (p && existsSync(join(p, 'lib', 'core.js'))) return p;
  }
  return null;
}

async function core() {
  if (corePromise) return corePromise;
  const root = dshPurgeRoot();
  if (!root) throw new Error('dsh-purge 未安装：找不到 lib/core.js（宿主破甲依赖它）');
  corePromise = import('file:///' + join(root, 'lib', 'core.js').replace(/\\/g, '/'));
  return corePromise;
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

/** 宿主被 patch 的文件清单：{ key: [绝对路径...] } */
async function hostFiles() {
  const c = await core();
  const state = await c.gatherState();
  const out = [];
  for (const [key, value] of Object.entries(state.files || {})) {
    for (const p of String(value).split(',')) {
      const abs = p.trim();
      if (abs) out.push({ key: key, path: abs });
    }
  }
  return { state: state, files: out };
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
export async function hostStatus(dataDir) {
  const root = dshPurgeRoot();
  if (!root) {
    return { ok: false, available: false, reason: 'dsh-purge 未安装，宿主破甲不可用', dshPurgeRoot: null };
  }
  let gather;
  try {
    gather = await hostFiles();
  } catch (e) {
    return { ok: false, available: false, reason: '读取 dsh-purge 状态失败：' + ((e && e.message) || e), dshPurgeRoot: root };
  }
  const c = await core();
  const st = gather.state;
  const patches = (c.ALL_PATCHES || []).map((p) => ({
    id: p.id,
    name: p.name,
    layer: p.layer,
    layerEn: p.layer_en,
    status: (st.patch_status && st.patch_status[p.id]) || 'unknown',
  }));
  const applied = patches.filter((p) => p.status === 'applied').length;
  const pending = patches.filter((p) => p.status === 'pending').length;
  const na = patches.filter((p) => p.status === 'na' || p.status === 'missing_file').length;
  let asarOk = false;
  try { await asarHeader(); asarOk = true; } catch { asarOk = false; }
  const snaps = dataDir ? await listSnapshots(dataDir) : [];
  return {
    ok: true,
    available: true,
    dshPurgeRoot: root,
    surface: st.surface,
    dshHome: st.dsh_home,
    overridePath: st.override_path,
    overrideStatus: st.override_status,
    shim: { cmd: st.shim_cmd, ps1: st.shim_ps1, bin: st.shim_bin },
    patches: patches,
    counts: { total: patches.length, applied: applied, pending: pending, na: na, other: patches.length - applied - pending - na },
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
export async function applyHostPatches(kind) {
  const root = dshPurgeRoot();
  if (!root) throw new Error('dsh-purge 未安装');
  const c = await core();
  if (kind === 'revert') {
    const r = await c.revertAllHosts();
    return { mode: 'revert', reverted: r.reverted || [], errors: r.errors || [] };
  }
  const r = await c.applyPatchesAllHosts(c.ALL_PATCHES, { preserveClientBundles: false, forApply: true });
  const applied = (r.report || []).filter((x) => x.status === 'applied').length;
  const already = (r.report || []).filter((x) => x.status === 'already').length;
  return { mode: 'apply', hosts: (r.hosts || []).map((h) => h.aiBase), applied: applied, already: already, restartRequired: true };
}

/** 目录是否可用（只读自检，供 readiness 用） */
export function hostFeatureAvailable() {
  return !!(dshPurgeRoot() && existsSync(ASAR_PATH));
}
