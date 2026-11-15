// autokill-purge web end: a small, dependency-free server that answers questions about the
// gear's knowledge in memory-eternal, and never writes a card without review.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, stat, appendFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PURGE_WEB_PORT || 8792);
const CONFIG_DIR = join(homedir(), '.autokill-purge');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
const DEFAULT_VAULT = join(homedir(), '.dsh', 'memory-vault');

const DEFAULTS = { discovery: true, port: 7999, cloud: { enabled: false, base: '' }, writeGuard: 'writable-only', minSchemaVersion: 2 };
const WRITES_LOG = join(CONFIG_DIR, 'writes.log');

// A config written by PowerShell may carry a BOM, which makes JSON.parse throw and silently
// falls back to the defaults. Strip it, then fill the defaults the release ships with.
async function readConfig() {
  try {
    const raw = (await readFile(CONFIG_FILE, 'utf8')).replace(/^\uFEFF/, '');
    const cfg = JSON.parse(raw);
    return Object.assign({}, DEFAULTS, cfg, { cloud: Object.assign({}, DEFAULTS.cloud, cfg.cloud || {}) });
  } catch {
    return Object.assign({}, DEFAULTS);
  }
}

async function resolveService(cfg) {
  const tried = [];
  const probe = async (base, source) => {
    const health = await apiHealth(base, 0);
    tried.push({ base: base, source: source, ok: health.ok });
    return health.ok ? { base: base, source: source, health: health } : null;
  };

  if (cfg.cloud && cfg.cloud.enabled && cfg.cloud.base) {
    const hit = await probe(String(cfg.cloud.base).replace(/\/+$/, ''), 'cloud');
    if (hit) return Object.assign({ tried: tried }, hit);
  }

  if (process.env.PURGE_MEMORY_URL) {
    const base = String(process.env.PURGE_MEMORY_URL).replace(/\/+$/, '');
    const hit = await probe(base, 'env:PURGE_MEMORY_URL');
    if (hit) return Object.assign({ tried: tried }, hit);
  }

  const fromConfig = cfg.base ? String(cfg.base).replace(/\/+$/, '') : 'http://127.0.0.1:' + Number(cfg.port || DEFAULTS.port);
  const configHit = await probe(fromConfig, cfg.base ? 'config.base' : 'config.port');
  if (configHit) return Object.assign({ tried: tried }, configHit);

  if (cfg.discovery) {
    const locked = await watchdogPort();
    if (locked) {
      const hit = await probe('http://127.0.0.1:' + locked, 'watchdog-lock');
      if (hit) return Object.assign({ tried: tried }, hit);
    }
  }

  const fallback = fromConfig;
  await probe(fallback, 'fallback');
  return { base: fallback, source: 'unreachable', health: { ok: false }, tried: tried };
}

// The watchdog keeps a lock file with the port it manages. It can be stale (it reports an old
// pid), so the port is only a hint until /health answers.
async function watchdogPort() {
  try {
    const raw = (await readFile(join(homedir(), '.dsh', 'memory-eternal-watchdog.json'), 'utf8')).replace(/^\uFEFF/, '');
    const data = JSON.parse(raw);
    const list = Array.isArray(data.watchdogs) ? data.watchdogs : [];
    const last = list.filter((w) => w && w.port).pop();
    return last ? Number(last.port) : null;
  } catch {
    return null;
  }
}

function guardFor(health, cfg) {
  if (!health || !health.ok) {
    return { canWrite: false, reason: '记忆服务不可达：先看状态卡，或点「启动/保活服务」' };
  }
  const h = health.data || {};
  const minSchema = Number(cfg.minSchemaVersion || DEFAULTS.minSchemaVersion);
  if (typeof h.schema_version === 'number' && h.schema_version < minSchema) {
    return { canWrite: false, reason: '库的 schema_version ' + h.schema_version + ' 低于 ' + minSchema + '：先升级 memory-eternal' };
  }
  if (h.writable === false) {
    return { canWrite: false, reason: '库当前只读（writable=false）：写入会失败，先解决锁或权限' };
  }
  return { canWrite: true, reason: '' };
}

async function logWrite(entry) {
  try {
    await mkdir(CONFIG_DIR, { recursive: true });
    await appendFile(WRITES_LOG, JSON.stringify(Object.assign({ at: new Date().toISOString() }, entry)) + '\n', 'utf8');
  } catch { /* a write log that cannot be written must never break the write itself */ }
}
async function saveConfig(patch) {
  const next = Object.assign({}, await readConfig(), patch);
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(CONFIG_FILE, JSON.stringify(next, null, 2) + '\n', 'utf8');
  return next;
}

function memoryCli() {
  if (process.env.PURGE_MEMORY_CLI) return process.env.PURGE_MEMORY_CLI;
  if (process.platform === 'win32') return 'C:/Program Files/nodejs/node_modules/memory-eternal/bin/dsh-memory.mjs';
  return 'dsh-memory';
}

// Call the package's own entry with node: no shell, so a path with spaces stays one argument,
// and stdin still reaches `capture -`.
function run(cmd, args, timeoutMs, stdin) {
  const isMjs = /\.mjs$/i.test(cmd);
  const file = isMjs ? process.execPath : cmd;
  const argv = isMjs ? [cmd, ...args] : args;
  return new Promise((resolve) => {
    const child = execFile(file, argv, { timeout: timeoutMs || 20000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, code: err && typeof err.code === 'number' ? err.code : 0, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
    if (stdin != null && child.stdin) { child.stdin.end(stdin, 'utf8'); }
  });
}
function jsonOf(text) {
  try { return JSON.parse(text); } catch { return null; }
}

async function apiHealth(base, port) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    const res = await fetch(api(base) + '/health', { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, data: await res.json() };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

async function apiLookup(base, keys) {
  try {
    const res = await fetch(api(base) + '/lookup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ keys: keys, filter: { source: 'autokill-purge' } })
    });
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, data: await res.json() };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

async function apiUpsert(base, card) {
  try {
    const res = await fetch(api(base) + '/upsert', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ card: card })
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data: data };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

async function memoryStatus(port) {
  const r = await run(memoryCli(), ['status', '--json', '--port', String(port)]);
  const parsed = jsonOf(r.stdout);
  const watchdogs = parsed && Array.isArray(parsed.watchdogs) ? parsed.watchdogs : [];
  const alive = watchdogs.filter((x) => x.alive);
  const version = watchdogs.length ? watchdogs[0].pkgVersion : (parsed ? parsed.pkgVersion : null);
  return { available: r.ok, raw: parsed, alive: alive.length > 0, version: version }
}

// Every endpoint of memory-eternal lives under this prefix (see its lib/api.js API_PREFIX).
function api(base) { return String(base).replace(/\/+$/, '') + '/memory-eternal/api'; }

async function serviceProbe(baseUrl) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch(baseUrl, { signal: ctrl.signal });
    clearTimeout(timer);
    return { reachable: res.ok, status: res.status, base: baseUrl };
  } catch (e) {
    return { reachable: false, status: 0, base: baseUrl, error: String(e && e.message || e) };
  }
}

async function pendingCount(port) {
  const r = await run(memoryCli(), ['audit', 'list', '--status', 'pending', '--json']);
  const parsed = jsonOf(r.stdout);
  if (!parsed) return { count: null, ok: false };
  const list = parsed.items || parsed.cards || parsed.pending || (Array.isArray(parsed) ? parsed : []);
  return { count: Array.isArray(list) ? list.length : null, ok: true };
}

async function vaultState(dir) {
  const db = join(dir, 'memory-eternal.db');
  try {
    const s = await stat(db);
    return { dir: dir, db: db, exists: true, bytes: s.size };
  } catch {
    return { dir: dir, db: db, exists: false, bytes: 0 };
  }
}

let rejectedCache = { at: 0, map: new Map() };

// memory-eternal 的 B1：驳回后 lookup 仍返回 pending。这里用 audit 的 rejected 列表按 path 兜底，
// 只读、10 秒缓存，CLI 不可用时静默跳过（不因兜底失败而误报）。
async function rejectedIndex() {
  if (Date.now() - rejectedCache.at < 10000) return rejectedCache.map;
  const map = new Map();
  try {
    const r = await run(memoryCli(), ['audit', 'list', '--status', 'rejected', '--json'], 20000);
    const parsed = jsonOf(String(r.stdout || '').replace(/^\uFEFF/, ''));
    const cards = parsed && Array.isArray(parsed.cards) ? parsed.cards : [];
    for (const c of cards) if (c && c.path) map.set(c.path, { reason: c.reason || '', title: c.title || '' });
  } catch { /* 兜底不可用就按接口原样显示 */ }
  rejectedCache = { at: Date.now(), map: map };
  return map;
}

async function catalogState(base) {
  const raw = await readFile(join(HERE, 'catalog.json'), 'utf8');
  const catalog = JSON.parse(raw);
  const keys = catalog.items.map((i) => i.id);
  const lookup = await apiLookup(base, keys);
  const byKey = {};
  if (lookup.ok && lookup.data && Array.isArray(lookup.data.results)) {
    for (const r of lookup.data.results) byKey[r.key] = r;
  }
  const rejected = await rejectedIndex();
  const items = catalog.items.map((item) => {
    const hit = byKey[item.id] || { state: 'missing' };
    let state = hit.state || 'missing';
    let reason = hit.reason || null;
    let stale = false;
    // 接口说 pending，但同一路径已在驳回列表里：以驳回为准，并标记「接口未同步」
    if (state === 'pending' && hit.path && rejected.has(hit.path)) {
      state = 'rejected';
      stale = true;
      reason = rejected.get(hit.path).reason || null;
    }
    return Object.assign({}, item, {
      state: state,
      present: state === 'approved',
      path: hit.path || null,
      reason: reason,
      stale: stale,
    });
  });
  return { version: catalog.version, note: catalog.note, lookupOk: lookup.ok, items: items };
}

async function uploadItem(item) {
  const text = [
    '# 装备：' + item.title,
    '',
    '- id: ' + item.id,
    '- 类型: ' + item.kind,
    '- 来源: ' + item.source,
    '- 检索词: ' + item.query,
    '',
    '由 autokill-purge web 端登记，等待人工审核。'
  ].join('\n');
  const r = await run(memoryCli(), ['capture', '-', '--source', 'autokill-purge-web'], 30000, text);
  return { ok: r.ok, stdout: r.stdout.trim().slice(0, 400), stderr: r.stderr.trim().slice(0, 400), review: 'pending' };
}

async function handleApi(req, res, url) {
  const cfg = await readConfig();
  const vaultDir = cfg.vaultDir || process.env.MEMORY_VAULT_DIR || DEFAULT_VAULT;
  const resolved = await resolveService(cfg);
  const base = resolved.base;
  const port = Number((base.match(/:(\d+)/) || [])[1] || cfg.port || DEFAULTS.port);
  const health = resolved.health;
  const guard = guardFor(health, cfg);
  const cloud = cfg.cloud;

  if (url.pathname === '/api/status') {
    const [memory, service, vault] = await Promise.all([memoryStatus(port), serviceProbe(base), vaultState(vaultDir)]);
    const h = health.ok ? health.data : {};
    return send(res, 200, { configPath: CONFIG_FILE, writesLog: WRITES_LOG, port: port, base: base, apiBase: api(base), cloud: cloud, health: health, guard: guard, discovery: { source: resolved.source, tried: resolved.tried }, memory: memory, service: service, vault: vault, pending: { count: typeof h.pending === 'number' ? h.pending : null, ok: health.ok } });
  }
  if (url.pathname === '/api/catalog') {
    return send(res, 200, Object.assign(await catalogState(base), { guard: guard }));
  }
  if (url.pathname === '/api/config' && req.method === 'POST') {
    const body = await bodyOf(req);
    const patch = {};
    if (typeof body.port === 'number' && body.port > 0) patch.port = body.port;
    if (typeof body.base === 'string') patch.base = body.base.trim();
    if (typeof body.discovery === 'boolean') patch.discovery = body.discovery;
    if (typeof body.vaultDir === 'string' && body.vaultDir.trim()) patch.vaultDir = body.vaultDir.trim();
    if (body.cloud && typeof body.cloud === 'object') patch.cloud = { enabled: !!body.cloud.enabled, base: String(body.cloud.base || '').trim() };
    const next = await saveConfig(patch);
    return send(res, 200, { saved: true, config: next });
  }
  if (url.pathname === '/api/upload' && req.method === 'POST') {
    const body = await bodyOf(req);
    const catalog = await catalogState(base);
    const item = catalog.items.find((i) => i.id === body.id);
    if (!item) return send(res, 404, { ok: false, error: 'no such item: ' + body.id });
    if (!guard.canWrite) {
      return send(res, 409, { ok: false, error: 'write_blocked', reason: guard.reason });
    }
    const card = { key: item.id, kind: item.kind, title: item.title, source: 'autokill-purge', body: item.source ? '来源：' + item.source : '' };
    const up = await apiUpsert(base, card);
    await logWrite({ action: up.data && up.data.action, key: item.id, state: up.data && up.data.state, path: up.data && up.data.path, hash: up.data && up.data.content_hash, ok: up.ok });
    return send(res, up.ok ? 200 : 502, { ok: up.ok, action: up.data && up.data.action, state: up.data && up.data.state, path: up.data && up.data.path, review: 'pending', detail: up.error || undefined });
  }
  if (url.pathname === '/api/action' && req.method === 'POST') {
    const body = await bodyOf(req);
    if (body.action === 'open') {
      const r = await run(memoryCli(), ['open'], 30000);
      return send(res, 200, { ok: r.ok, detail: (r.stdout + r.stderr).trim().slice(0, 300), open: base });
    }
    if (body.action === 'watchdog') {
      const r = await run(memoryCli(), ['watchdog', '--port', String(port), '--interval', '5000'], 25000);
      return send(res, 200, { ok: r.ok, detail: (r.stdout + r.stderr).trim().slice(0, 300) });
    }
    if (body.action === 'audit') {
      return send(res, 200, { ok: true, open: base + '/#/audit' });
    }
    return send(res, 400, { ok: false, error: 'unknown action' });
  }
  return send(res, 404, { ok: false, error: 'no such endpoint' });
}

function send(res, code, value) {
  const body = JSON.stringify(value);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}
function bodyOf(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch { resolve({}); } });
  });
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    const rel = url.pathname === '/' ? '/index.html' : url.pathname;
    const file = join(HERE, 'public', rel.replace(/\.\./g, ''));
    const data = await readFile(file);
    const ext = rel.slice(rel.lastIndexOf('.'));
    res.writeHead(200, { 'content-type': TYPES[ext] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(data);
  } catch (e) {
    if (url.pathname.startsWith('/api/')) return send(res, 500, { ok: false, error: String(e && e.message || e) });
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('not found');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('autokill-purge web: http://127.0.0.1:' + PORT);
});
