// 宿主补丁引擎（五宿主统一接口）：check / apply / revert
//
// 用法：
//   node web/patch-engine/engine.mjs dsh         check | apply | revert
//   node web/patch-engine/engine.mjs mengbot     check | apply [--ids mb-soul-rank,mb-team-memory] | revert
//   node web/patch-engine/engine.mjs autokill    check | apply | revert
//   node web/patch-engine/engine.mjs claude-code check | apply | revert   （二进制内嵌提示词，等长替换）
//   node web/patch-engine/engine.mjs codex       check | apply | revert   （同上，Rust rodata）
//   加 --json 输出机器可读结果；--dry 只算不写
//
// 落盘方式按宿主可写面区分：
//   dsh          → vendor/core.js 的 applyPatchesAllHosts（JS 源码字节替换）
//   mengbot      → resources/server/index.js 字节锚点（JS 源码）
//   autokill     → %APPDATA%\autokill\config.toml（TOML 键）
//   claude-code  → claude.exe 内嵌提示词（**等长**原地写，不重写整份 207 MB）
//   codex        → codex.exe 内嵌提示词（**等长**原地写，不重写整份 299 MB）
//
// 纪律（四条）：
//   1. 锚点必须唯一：JS/TOML 宿主里 anchor 出现 >1 次 → 整文件 abort，绝不猜；二进制宿主按 allow_multiple 决定。
//   2. 写前必备份：文本宿主 <file>.dshpurge.bak；二进制宿主 data/bin-backup/<exe>.dshpurge.bak。
//   3. 写完必读回：anchor 归零、verify_contains 出现；二进制宿主再跑一次 --version 验活。
//   4. 二进制宿主只能等长替换：replace 的 UTF-8 字节数 ≠ anchor 时直接拒绝（否则破坏内嵌索引）。
import { existsSync, readFileSync, writeFileSync, copyFileSync, readdirSync, rmSync, statSync, renameSync, mkdirSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { basename, join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const LOCAL = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local');
const ARGS = process.argv.slice(2);
const HOST = String(ARGS[0] || '').toLowerCase();
const MODE = String(ARGS[1] || 'check').toLowerCase();
const AS_JSON = ARGS.includes('--json');
const DRY = ARGS.includes('--dry');
const IDS = (() => {
  const i = ARGS.indexOf('--ids');
  return i >= 0 && ARGS[i + 1] ? ARGS[i + 1].split(',').map((s) => s.trim()).filter(Boolean) : [];
})();
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);

const ROOTS = {
  mengbot: join(LOCAL, 'Programs', 'mengbot'),
  autokill: join(LOCAL, 'Programs', 'AutoKill'),
};

/** 二进制宿主：单个 exe 内嵌提示词，只能等长原地替换 */
const BIN_HOSTS = {
  'claude-code': { catalog: 'catalog.claude-code.json' },
  codex: { catalog: 'catalog.codex.json' },
};
const BIN_BACKUP_DIR = join(HERE, '..', '..', 'data', 'bin-backup');

function out(obj) {
  if (AS_JSON) { console.log(JSON.stringify(obj, null, 2)); return; }
  console.log(JSON.stringify(obj, null, 2));
}

function catalog(host) {
  const p = join(HERE, host === 'dsh' ? 'catalog.json' : `catalog.${host}.json`);
  if (!existsSync(p)) throw new Error(`缺补丁目录 ${p}`);
  return { path: p, data: JSON.parse(readFileSync(p, 'utf8')) };
}

function writeAtomic(file, text) {
  const tmp = file + '.tmp-' + process.pid;
  writeFileSync(tmp, text, 'utf8');
  renameSync(tmp, file);
}

function countOf(text, needle) {
  if (!needle) return 0;
  let i = 0, n = 0;
  while ((i = text.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
  return n;
}

// ============================ 二进制宿主（claude-code / codex） ============================
// 只做「等长原地替换」：定位 anchor 的字节偏移 → 用同字节数的 replace 覆盖写回 → 校验 + --version 验活。
// 好处：不重写 200~300 MB 的整份文件，只改几十~几百字节；缺点：replace 必须与 anchor 等长。
const CHUNK = 8 * 1024 * 1024;
const OVERLAP = 4096;

async function binOffsets(file, needle) {
  if (!needle) return [];
  const nb = Buffer.from(needle, 'utf8');
  const st = statSync(file);
  const fh = await open(file, 'r');
  const hits = [];
  let pos = 0;
  let carry = Buffer.alloc(0);
  try {
    while (pos < st.size) {
      const len = Math.min(CHUNK, st.size - pos);
      const buf = Buffer.alloc(len);
      await fh.read(buf, 0, len, pos);
      const hay = carry.length ? Buffer.concat([carry, buf]) : buf;
      let idx = 0;
      while ((idx = hay.indexOf(nb, idx)) !== -1) {
        hits.push(pos - carry.length + idx);
        idx += nb.length;
      }
      carry = hay.slice(Math.max(0, hay.length - OVERLAP));
      pos += len;
    }
  } finally {
    await fh.close();
  }
  return hits;
}

async function binCheck(cat) {
  const file = cat.upstream.bin;
  const rows = [];
  for (const p of cat.patches) {
    if (!existsSync(file)) { rows.push({ id: p.id, name: p.name, state: 'missing_file', file }); continue; }
    const a = await binOffsets(file, p.anchor);
    const v = await binOffsets(file, p.verify_contains);
    const state = a.length === 0 && v.length > 0 ? 'applied'
      : a.length > 0 && v.length === 0 ? 'pending'
        : a.length > 0 && v.length > 0 ? 'drifted'
          : 'unmatched';
    rows.push({
      id: p.id, name: p.name, layer: p.layer, state, file,
      anchors: a.length, verified: v.length,
      equal_length: p.equal_length, allow_multiple: !!p.allow_multiple,
      at: a.slice(0, 6),
    });
  }
  return rows;
}

function binSelfTest(file) {
  return new Promise((res) => {
    execFile(file, ['--version'], { timeout: 20000, windowsHide: true }, (err, stdout, stderr) => {
      const text = String(stdout || stderr || '').trim().split(/\r?\n/)[0] || '';
      res({ ok: !err, exit: err ? (typeof err.code === 'number' ? err.code : -1) : 0, firstLine: text.slice(0, 120) });
    });
  });
}

async function binApply(cat, rows) {
  const want = IDS.length ? new Set(IDS) : null;
  const file = cat.upstream.bin;
  const results = [];
  const todo = [];
  for (const p of cat.patches) {
    if (want && !want.has(p.id)) continue;
    const row = rows.find((r) => r.id === p.id);
    if (!row) continue;
    if (row.state === 'applied') { results.push({ id: p.id, action: 'already' }); continue; }
    if (row.state === 'missing_file') { results.push({ id: p.id, action: 'skipped_missing_file', file }); continue; }
    if (row.state === 'unmatched') { results.push({ id: p.id, action: 'skipped_unmatched' }); continue; }
    if (row.state === 'drifted') { results.push({ id: p.id, action: 'aborted_drifted', hint: '先 revert 回基线再打' }); continue; }
    const aLen = Buffer.byteLength(p.anchor, 'utf8');
    const rLen = Buffer.byteLength(p.replace, 'utf8');
    if (aLen !== rLen) { results.push({ id: p.id, action: 'aborted_not_equal_length', anchorBytes: aLen, replaceBytes: rLen }); continue; }
    todo.push(p);
  }
  let backup = null;
  if (todo.length) {
    const bak = join(BIN_BACKUP_DIR, basename(file) + '.dshpurge.bak');
    if (!DRY) {
      mkdirSync(BIN_BACKUP_DIR, { recursive: true });
      const pristine = rows.filter((r) => todo.some((p) => p.id === r.id)).every((r) => r.state === 'pending');
      if (pristine || !existsSync(bak)) copyFileSync(file, bak);
      backup = bak;
    }
    const fh = await open(file, 'r+');
    try {
      for (const p of todo) {
        const nb = Buffer.from(p.replace, 'utf8');
        const offs = await binOffsets(file, p.anchor);   // 每条前重扫，避免上一条替换影响下一条
        if (!offs.length) { results.push({ id: p.id, action: 'noop' }); continue; }
        if (!p.allow_multiple && offs.length > 1) { results.push({ id: p.id, action: 'aborted_ambiguous', offsets: offs.length }); continue; }
        for (const off of offs) if (!DRY) await fh.write(nb, 0, nb.length, off);
        results.push({ id: p.id, action: DRY ? 'dry-run' : 'written', offsets: offs.length, bytes: nb.length, at: offs.slice(0, 6) });
      }
      if (!DRY) await fh.sync();
    } finally {
      await fh.close();
    }
  }
  const after = await binCheck(cat);
  const verify = after.filter((r) => todo.some((p) => p.id === r.id)).every((r) => r.state === 'applied');
  const alive = DRY ? null : await binSelfTest(file);
  return { backup, results, patches: after, verify, alive };
}

async function binRevert(cat) {
  const file = cat.upstream.bin;
  const bak = join(BIN_BACKUP_DIR, basename(file) + '.dshpurge.bak');
  if (!existsSync(bak)) return { reverted: false, reason: 'no backup', expect: bak, alive: null };
  if (!DRY) {
    copyFileSync(bak, file + '.restore-tmp');
    renameSync(file + '.restore-tmp', file);
  }
  const alive = DRY ? null : await binSelfTest(file);
  return { reverted: !DRY, from: bak, alive };
}

// ============================ MengBot（字节锚点） ============================
function mbFile(root, rel) {
  return join(root, String(rel).replace(/^resources[\\/]/, 'resources' + '\\'));
}

function mbCheck(root, cat) {
  const rows = [];
  for (const p of cat.patches) {
    const file = mbFile(root, p.file);
    if (!existsSync(file)) { rows.push({ id: p.id, name: p.name, state: 'missing_file', file }); continue; }
    const text = readFileSync(file, 'utf8');
    const anchors = countOf(text, p.anchor);
    const verified = p.verify_contains ? countOf(text, p.verify_contains) : 0;
    const state = verified > 0 && anchors === 0 ? 'applied'
      : anchors === 1 ? 'pending'
        : anchors > 1 ? 'ambiguous'
          : 'unmatched';
    rows.push({ id: p.id, name: p.name, layer: p.layer, state, file, anchors, verified, bytes: statSync(file).size });
  }
  return rows;
}

function mbApply(root, cat, rows) {
  const want = IDS.length ? new Set(IDS) : null;
  const picked = cat.patches.filter((p) => (!want || want.has(p.id)));
  const byFile = new Map();
  for (const p of picked) {
    const row = rows.find((r) => r.id === p.id);
    if (!row) continue;
    if (row.state === 'missing_file' || row.state === 'unmatched') continue;
    if (row.state === 'ambiguous') { row.action = 'aborted_ambiguous'; continue; }
    if (!byFile.has(row.file)) byFile.set(row.file, []);
    byFile.get(row.file).push({ patch: p, row });
  }
  const results = [];
  for (const [file, items] of byFile) {
    let text = readFileSync(file, 'utf8');
    const todo = items.filter((it) => it.row.state === 'pending');
    for (const it of items) {
      if (it.row.state === 'applied') { it.row.action = 'already'; }
    }
    if (!todo.length) {
      results.push({ file, action: 'noop', items: items.map((i) => ({ id: i.patch.id, action: i.row.action || 'already' })) });
      continue;
    }
    // 写前统一做唯一性复核（防止两条 patch 的锚点互相重叠）
    const bad = [];
    for (const it of todo) {
      const n = countOf(text, it.patch.anchor);
      if (n !== 1) bad.push({ id: it.patch.id, anchors: n });
    }
    if (bad.length) {
      results.push({ file, action: 'aborted', reason: 'anchor not unique before write', bad });
      continue;
    }
    const before = text;
    for (const it of todo) text = text.replace(it.patch.anchor, it.patch.replace);
    // 单一基线备份：只在「当前文件仍是未打状态」时刷新，保证 revert 永远能回到原始态，
    // 不会因为反复 apply 攒出一堆 15MB 的 .bak-<stamp>（也不会把已打状态误当基线）。
    const bak = `${file}.dshpurge.bak`;
    if (!DRY) {
      const pristine = todo.every((it) => countOf(before, it.patch.anchor) === 1);
      if (pristine) copyFileSync(file, bak);
      writeAtomic(file, text);
    }
    const after = DRY ? text : readFileSync(file, 'utf8');
    const verify = todo.map((it) => ({
      id: it.patch.id,
      anchorsLeft: countOf(after, it.patch.anchor),
      verified: it.patch.verify_contains ? countOf(after, it.patch.verify_contains) : null,
      ok: countOf(after, it.patch.anchor) === 0 && (!it.patch.verify_contains || countOf(after, it.patch.verify_contains) > 0),
    }));
    results.push({ file, action: DRY ? 'dry-run' : 'written', backup: DRY ? null : bak, bytesBefore: Buffer.byteLength(before, 'utf8'), bytesAfter: Buffer.byteLength(after, 'utf8'), verify });
  }
  return { results, cache: DRY ? null : mbClearCache() };
}

function mbClearCache() {
  const cache = join(homedir(), '.mengbot', 'cache', 'node-compile');
  if (!existsSync(cache)) return { cleared: false, reason: 'no cache dir' };
  let n = 0;
  for (const name of readdirSync(cache)) {
    try { rmSync(join(cache, name), { recursive: true, force: true }); n++; } catch { /* 占用中的跳过 */ }
  }
  return { cleared: true, entries: n };
}

function mbRevert(root, cat) {
  const files = [...new Set(cat.patches.map((p) => mbFile(root, p.file)))].filter((f) => existsSync(f));
  const done = [];
  for (const file of files) {
    const dir = dirname(file);
    const base = file.split(/[\\/]/).pop();
    const fixed = base + '.dshpurge.bak';
    const cands = readdirSync(dir).filter((n) => n === fixed || n.startsWith(base + '.dshpurge.bak-'));
    if (!cands.length) { done.push({ file, reverted: false, reason: 'no backup' }); continue; }
    // 优先固定基线；只存在历史 .bak-<stamp> 时用最新一份（兼容旧命名）
    const pick = cands.includes(fixed) ? fixed : cands.sort().pop();
    const latest = join(dir, pick);
    if (!DRY) copyFileSync(latest, file);
    done.push({ file, reverted: !DRY, from: latest });
  }
  return { done, cache: DRY ? null : mbClearCache() };
}

// ============================ AutoKill（TOML 配置层） ============================
function akConfig() {
  return join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'autokill', 'config.toml');
}

/** 极简 TOML 段落感知读写：只处理 `key = value` 单行标量 */
function tomlGet(text, dotted) {
  const parts = String(dotted).split('.');
  const key = parts.pop();
  const sect = parts.join('.');
  let cur = '';
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (m) { cur = m[1].trim(); continue; }
    if (cur !== sect) continue;
    const kv = new RegExp('^\\s*' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*=\\s*(.+?)\\s*$').exec(line);
    if (kv) return { raw: kv[1], line, section: cur };
  }
  return null;
}

function fmtToml(v) {
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return String(v);
  return JSON.stringify(String(v));
}

function tomlSet(text, dotted, value) {
  const parts = String(dotted).split('.');
  const key = parts.pop();
  const sect = parts.join('.');
  const lines = text.split(/\r?\n/);
  let cur = '';
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*\[([^\]]+)\]\s*$/.exec(lines[i]);
    if (m) { cur = m[1].trim(); continue; }
    if (cur !== sect) continue;
    const re = new RegExp('^(\\s*' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*=\\s*)(.+?)(\\s*)$');
    const kv = re.exec(lines[i]);
    if (kv) { lines[i] = kv[1] + fmtToml(value) + kv[3]; return { text: lines.join('\n'), changed: true, at: i + 1 }; }
  }
  // 段内没有该键：段尾补一行（没有该段则追加段）
  if (!sect) { lines.push(`${key} = ${fmtToml(value)}`); return { text: lines.join('\n'), changed: true, at: lines.length, appended: true }; }
  let sectIdx = -1;
  for (let i = 0; i < lines.length; i++) if (new RegExp('^\\s*\\[' + sect.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\]\\s*$').test(lines[i])) sectIdx = i;
  if (sectIdx < 0) { lines.push('', `[${sect}]`, `${key} = ${fmtToml(value)}`); return { text: lines.join('\n'), changed: true, appended: true, newSection: true }; }
  let insertAt = sectIdx + 1;
  for (let i = sectIdx + 1; i < lines.length; i++) { if (/^\s*\[/.test(lines[i])) break; if (lines[i].trim()) insertAt = i + 1; }
  lines.splice(insertAt, 0, `${key} = ${fmtToml(value)}`);
  return { text: lines.join('\n'), changed: true, appended: true, at: insertAt };
}

function akCheck(cat, text) {
  return cat.patches.map((p) => {
    if (p.kind === 'ai') return { id: p.id, name: p.name, layer: p.layer, state: 'needs_cli', note: '后端开关走 autokill-cli ai on|off，不由本引擎改' };
    const cur = tomlGet(text, p.key);
    if (!cur) return { id: p.id, name: p.name, layer: p.layer, state: 'unmatched', key: p.key };
    const norm = (s) => String(s).trim().replace(/^["']|["']$/g, '');
    const isTarget = norm(cur.raw) === norm(fmtToml(p.target));
    const isWas = norm(cur.raw) === norm(fmtToml(p.was));
    return { id: p.id, name: p.name, layer: p.layer, key: p.key, current: norm(cur.raw), want: norm(fmtToml(p.target)), state: isTarget ? 'applied' : (isWas ? 'pending' : 'drifted') };
  });
}

function akApply(cat, text, rows) {
  const want = IDS.length ? new Set(IDS) : null;
  let out = text;
  const results = [];
  for (const p of cat.patches) {
    if (want && !want.has(p.id)) continue;
    const row = rows.find((r) => r.id === p.id);
    if (!row) continue;
    if (p.kind === 'ai') { results.push({ id: p.id, action: 'skipped_needs_cli', hint: `autokill-cli ai on "${p.name_enabled}"` }); continue; }
    if (row.state === 'applied') { results.push({ id: p.id, action: 'already' }); continue; }
    if (row.state === 'unmatched') { results.push({ id: p.id, action: 'skipped_missing_key', key: p.key }); continue; }
    const r = tomlSet(out, p.key, p.target);
    if (r.changed) { out = r.text; results.push({ id: p.id, action: 'written', at: r.at, appended: !!r.appended }); }
    else results.push({ id: p.id, action: 'noop' });
  }
  return { text: out, results };
}

// ============================ 主流程 ============================
if (!ROOTS[HOST] && HOST !== 'dsh' && !BIN_HOSTS[HOST]) {
  out({ ok: false, error: 'unknown_host', usage: 'node web/patch-engine/engine.mjs <dsh|mengbot|autokill|claude-code|codex> <check|apply|revert>', hosts: [...Object.keys(ROOTS), 'dsh', ...Object.keys(BIN_HOSTS)] });
  process.exit(2);
}
if (HOST === 'dsh') {
  // 用本仓库 vendor 进来的引擎执行（不再 import 安装目录里的 dsh-purge）
  const vendorCore = join(HERE, 'vendor', 'core.js');
  if (!existsSync(vendorCore)) {
    out({ ok: false, error: 'vendor_missing', hint: '先跑 node scripts/vendor-dsh-engine.mjs 把引擎闭包拷进 web/patch-engine/vendor' });
    process.exit(2);
  }
  const core = await import('file:///' + vendorCore.replace(/\\/g, '/'));
  const all = Array.isArray(core.ALL_PATCHES) ? core.ALL_PATCHES : [];

  if (MODE === 'check') {
    const st = await core.gatherState();
    const rows = all.map((p) => ({
      id: p.id, name: p.name, layer: p.layer,
      state: (st.patch_status && st.patch_status[p.id]) || 'unknown',
    }));
    out({ ok: true, executed: true, host: HOST, mode: MODE, engine: vendorCore, catalog: join(HERE, 'catalog.json'), surface: st.surface, dshHome: st.dsh_home, patches: rows, counts: countStates(rows) });
    process.exit(0);
  }
  if (MODE === 'apply') {
    if (DRY) {
      const rows = IDS.length ? all.filter((p) => IDS.includes(String(p.id)) || IDS.includes(p.name)) : all;
      out({ ok: true, executed: false, dry: true, host: HOST, mode: MODE, wouldApply: rows.length, total: all.length, ids: rows.map((p) => p.id) });
      process.exit(0);
    }
    const want = IDS.length ? new Set(IDS) : null;
    const subset = want ? all.filter((p) => want.has(String(p.id)) || want.has(p.name)) : all;
    if (want && !subset.length) { out({ ok: false, error: 'no_patch_matched', ids: IDS }); process.exit(2); }
    const r = await core.applyPatchesAllHosts(subset, { preserveClientBundles: false, forApply: true });
    const report = r.report || [];
    out({
      ok: true, executed: true, host: HOST, mode: MODE, engine: vendorCore,
      selected: subset.length, total: all.length, ids: subset.map((p) => p.id),
      hosts: (r.hosts || []).map((h) => h.aiBase),
      applied: report.filter((x) => x.status === 'applied').length,
      already: report.filter((x) => x.status === 'already').length,
      failed: report.filter((x) => !['applied', 'already', 'na', 'skipped'].includes(x.status)).length,
      restartRequired: true,
    });
    process.exit(0);
  }
  if (MODE === 'revert') {
    const r = await core.revertAllHosts();
    out({ ok: true, executed: true, host: HOST, mode: MODE, engine: vendorCore, reverted: r.reverted || [], errors: r.errors || [], restartRequired: true });
    process.exit(0);
  }
  out({ ok: false, error: 'unknown_mode', host: HOST, mode: MODE, usage: ['check', 'apply', 'revert'] });
  process.exit(2);
}

// ============================ 二进制宿主主流程 ============================
if (BIN_HOSTS[HOST]) {
  const catFile = join(HERE, BIN_HOSTS[HOST].catalog);
  if (!existsSync(catFile)) {
    out({ ok: false, error: 'catalog_missing', path: catFile, hint: 'node web/patch-engine/build-bin-catalogs.mjs' });
    process.exit(2);
  }
  const binCat = JSON.parse(readFileSync(catFile, 'utf8'));
  const before = await binCheck(binCat);
  if (MODE === 'check') {
    out({ ok: true, host: HOST, mode: MODE, catalog: catFile, bin: binCat.upstream.bin, upstream: binCat.upstream, patches: before, counts: countStates(before) });
    process.exit(0);
  }
  if (MODE === 'apply') {
    const r = await binApply(binCat, before);
    const ok = r.verify && (!r.alive || r.alive.ok);
    out({
      ok, host: HOST, mode: MODE, dry: DRY, catalog: catFile, bin: binCat.upstream.bin,
      backup: r.backup, apply: r.results, patches: r.patches, counts: countStates(r.patches),
      alive: r.alive, equalLength: true,
      signature: '改后 Authenticode 会变 HashMismatch（原签名厂商）——可运行，但签名状态改变',
      next: '二进制每次启动重读，改完立即生效；要还原就跑 revert',
    });
    process.exit(ok ? 0 : 1);
  }
  if (MODE === 'revert') {
    const r = await binRevert(binCat);
    const after = await binCheck(binCat);
    out({ ok: r.reverted && (!r.alive || r.alive.ok), host: HOST, mode: MODE, dry: DRY, bin: binCat.upstream.bin, revert: r, patches: after, counts: countStates(after) });
    process.exit(0);
  }
  out({ ok: false, error: 'unknown_mode', host: HOST, mode: MODE, usage: ['check', 'apply', 'revert'] });
  process.exit(2);
}

const { path: catPath, data: cat } = catalog(HOST);
const root = ROOTS[HOST];

if (HOST === 'mengbot') {
  if ((MODE === 'check') || (MODE === 'apply') || (MODE === 'revert')) {
    const before = mbCheck(root, cat);
    if (MODE === 'check') {
      out({ ok: true, host: HOST, mode: MODE, catalog: catPath, root, patches: before, counts: countStates(before) });
      process.exit(0);
    }
    if (MODE === 'revert') {
      const r = mbRevert(root, cat);
      const after = mbCheck(root, cat);
      out({ ok: r.done.some((d) => d.reverted), host: HOST, mode: MODE, catalog: catPath, revert: r, patches: after, counts: countStates(after) });
      process.exit(0);
    }
    const r = mbApply(root, cat, before);
    const after = mbCheck(root, cat);
    const ok = r.results.every((x) => ['written', 'noop', 'dry-run'].includes(x.action)) && after.every((p) => p.state !== 'ambiguous');
    out({ ok, host: HOST, mode: MODE, dry: DRY, catalog: catPath, root, apply: r, patches: after, counts: countStates(after), next: '完全退出 MengBot 再启动，改过的 system prompt 才会进新会话' });
    process.exit(ok ? 0 : 1);
  }
}

if (HOST === 'autokill') {
  const cfg = akConfig();
  if (!existsSync(cfg)) { out({ ok: false, error: 'config_missing', path: cfg }); process.exit(2); }
  const text = readFileSync(cfg, 'utf8');
  const before = akCheck(cat, text);
  if (MODE === 'check') {
    out({ ok: true, host: HOST, mode: MODE, catalog: catPath, config: cfg, patches: before, counts: countStates(before) });
    process.exit(0);
  }
  if (MODE === 'apply') {
    const { text: next, results } = akApply(cat, text, before);
    let backup = null;
    if (next !== text && !DRY) {
      backup = `${cfg}.dshpurge.bak-${stamp}`;
      if (!existsSync(backup)) copyFileSync(cfg, backup);
      writeAtomic(cfg, next);
    }
    const after = akCheck(cat, readFileSync(cfg, 'utf8'));
    out({ ok: results.every((r) => r.action !== 'skipped_missing_key'), host: HOST, mode: MODE, dry: DRY, catalog: catPath, config: cfg, backup, apply: results, patches: after, counts: countStates(after), next: '桌面端在跑会覆盖内存配置：先退出 AutoKill 再应用，或应用后重启它' });
    process.exit(0);
  }
  if (MODE === 'revert') {
    // alias：revert 即「每项按 was 值写回」
    let next = text;
    const results = [];
    for (const p of cat.patches) {
      if (p.kind === 'ai') { results.push({ id: p.id, action: 'skipped_needs_cli', hint: `autokill-cli ai off "${p.name_enabled}"` }); continue; }
      const row = before.find((r) => r.id === p.id);
      if (!row || row.state === 'unmatched') { results.push({ id: p.id, action: 'skipped_missing_key' }); continue; }
      const r = tomlSet(next, p.key, p.was);
      next = r.text;
      results.push({ id: p.id, action: 'restored', to: fmtToml(p.was) });
    }
    let backup = null;
    if (next !== text && !DRY) {
      backup = `${cfg}.dshpurge.bak-${stamp}`;
      if (!existsSync(backup)) copyFileSync(cfg, backup);
      writeAtomic(cfg, next);
    }
    const after = akCheck(cat, readFileSync(cfg, 'utf8'));
    out({ ok: true, host: HOST, mode: MODE, dry: DRY, config: cfg, backup, revert: results, patches: after, counts: countStates(after) });
    process.exit(0);
  }
}

out({ ok: false, error: 'unknown_mode', host: HOST, mode: MODE, usage: ['check', 'apply', 'revert'] });
process.exit(2);

function countStates(rows) {
  const c = {};
  for (const r of rows) c[r.state] = (c[r.state] || 0) + 1;
  return c;
}
