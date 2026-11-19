// web/summary.mjs —— 「注入了什么」的一屏聚合（只读 · 按宿主取数）
//
// 为什么单独做：状态散在 hostStatus（DSH 补丁/宿主）、catalog（分层）、listOps（6 个宿主内能力）、
// plugin-install（插件与 bundles）、redteam-pack（技能/角色/工具）、mbStatus（MengBot）、
// akPatchStatus（AutoKill 配置层）里。右侧栏一屏看全，只打这一个接口。
//
// 宿主是唯一维度：`?host=dsh|mengbot|autokill`，返回同一套骨架（host / patches / plugins /
// capabilities），每段都带 applicable —— 不适用的段给 note 说明为什么，而不是留空或编数。
import os from 'node:os';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { hostStatus, patchCatalog } from './host.mjs';
import { listOps } from './ops/index.mjs';
import { mbStatus, mbListBots } from './mengbot.mjs';
import { decodeSession, listSessionFiles } from './ops/rewind.mjs';

export const SUMMARY_HOSTS = ['dsh', 'mengbot', 'autokill'];
const HOST_NAME = { dsh: 'DSH', mengbot: 'MengBot', autokill: 'AutoKill' };

function localIPv4() {
  try {
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const n of nets[name] || []) {
        if (!n || n.internal) continue;
        if (n.family === 'IPv4' || n.family === 4) return n.address;
      }
    }
  } catch { /* ignore */ }
  return null;
}

function layerOf(p) {
  const raw = p.layer || p.raw?.layer || '未分层';
  return String(raw || '未分层');
}

function rows(list) {
  return (list || []).filter((x) => x && x.v !== undefined && x.v !== null).map((x) => ({ k: x.k, v: String(x.v), mono: x.mono !== false }));
}

const INJECT_MARK = '<project_instructions>';
/**
 * 「注入生效」探针：prompt-inject.md 在盘上 ≠ 模型真的收到。
 * 读最近 N 个会话的 system/message，看 <project_instructions> 是否真的下发；
 * token 按 0.288 tokens/字符（本模板实测口径，见 docs/注入token消耗分析.md）估算。
 */
function injectionProbe(dshHome, opts = {}) {
  const limit = Number(opts.limit) || 4;
  const maxBytes = Number(opts.maxBytes) || 24 * 1024 * 1024;
  const home = String(dshHome || '');
  const file = home ? join(home, 'prompt-inject.md') : '';
  let fileInfo = null;
  let estTokens = null;
  if (file) {
    try {
      const st = statSync(file);
      if (st.isFile()) {
        fileInfo = { path: file, bytes: st.size, mtimeMs: st.mtimeMs };
        const raw = readFileSync(file, 'utf8');
        const crs = raw.split('\r').length - 1;
        estTokens = Math.round((raw.length - crs) * 0.288);
      }
    } catch { fileInfo = null; }
  }
  const found = [];
  if (home) {
    let rowsList = [];
    try { rowsList = listSessionFiles(join(home, 'sessions')); } catch { rowsList = []; }
    // 按"会话创建时间"判定，而不是文件 mtime：老会话被续写时 mtime 会插到最前，
    // 那会让「最新会话有没有注入」在同一个宿主上反复跳（实测 16:55 触发过一次）。
    for (const row of rowsList) {
      if (found.length >= 12) break;
      if (row.sizeBytes > maxBytes) continue;
      let text = '';
      try { text = decodeSession(readFileSync(row.path)).text; } catch { continue; }
      const lines = text.split(String.fromCharCode(10));
      let createdAt = row.mtimeMs;
      try { const head = JSON.parse(lines[0] || '{}'); if (head && head.createdAt) createdAt = Number(head.createdAt); } catch { /* 用 mtime */ }
      const line = lines.find((l) => l.includes(String.fromCharCode(34) + "system/message" + String.fromCharCode(34)));
      if (!line) continue;
      let hasInjection = false;
      let sysChars = 0;
      try {
        const m = JSON.parse(line);
        const content = (m.data && m.data.message && m.data.message.content) || [];
        const t = (Array.isArray(content) ? content : []).map((x) => (typeof x === 'string' ? x : (x && x.text) || '')).join('');
        sysChars = t.length;
        hasInjection = t.includes(INJECT_MARK);
      } catch { continue; }
      found.push({ id: row.id, project: row.project, at: createdAt, sysChars, hasInjection });
    }
  }
  found.sort((a, b) => b.at - a.at);
  const checked = found.slice(0, limit);
  const latest = checked[0] || null;
  const withInjection = checked.filter((x) => x.hasInjection).length;
  return {
    ready: !!fileInfo,
    effective: !!(fileInfo && latest && latest.hasInjection),
    latestHasInjection: !!(latest && latest.hasInjection),
    file: fileInfo,
    checked: checked.length,
    withInjection,
    sessions: checked,
    estTokensPerRequest: estTokens,
    note: '按最近 ' + limit + ' 个会话的 system/message 判定；token 为估算（0.288 tokens/字符）',
  };
}
function baseOut(hostId) {
  return {
    ok: true,
    at: new Date().toISOString(),
    hostId,
    hostName: HOST_NAME[hostId] || hostId,
    device: {
      hostname: os.hostname(),
      ip: localIPv4(),
      platform: process.platform + ' ' + os.release(),
      node: process.version,
      pid: process.pid,
    },
    host: { id: hostId, name: HOST_NAME[hostId] || hostId, installed: false, rows: [] },
    patches: { applicable: false, note: '' },
    plugins: { applicable: false, note: '' },
    capabilities: { applicable: false, note: '', total: 0, available: 0, items: [] },
    errors: [],
  };
}

/** 六项宿主内能力只对 DSH 生效；其它宿主原样列出但标成不可用，避免"看着像能点" */
async function opsSection(dataDir, applicable) {
  // 非 DSH 宿主不跑 listOps：那 6 项的状态探测（profile / 会话 / 技能）只对 DSH 有意义，
  // 跑一遍既慢又会因为缺 dataDir 报错；这里直接给"不适用"的结论。
  if (!applicable) {
    return {
      applicable: false,
      total: 0,
      available: 0,
      items: [],
      note: '这 6 项是宿主内能力（reapply / restart / plugin-install / identity / rewind / redteam-pack），只对 DSH 生效',
    };
  }
  const ops = await listOps(dataDir);
  return opsSectionFrom(ops, applicable);
}

function opsSectionFrom(ops, applicable) {
  const items = (ops.ops || []).map((o) => ({
    id: o.id,
    zh: o.zh,
    available: applicable && !!o.available,
    forHost: 'dsh',
    summary: o.summary || '',
  }));
  return {
    applicable,
    total: items.length,
    available: applicable ? items.filter((x) => x.available).length : 0,
    items,
    note: applicable ? '' : '这 6 项是宿主内能力（DQSH profile / 会话 / 技能），只对 DSH 生效',
  };
}

// ------------------------------------------------------------------ DSH
async function dshPayload(out, dataDir) {
  // hostStatus（读 83 条补丁 + 文件存在性）、listOps（6 项能力 status）、catalog 互不依赖 → 并行
  const [st, ops, catalogRaw] = await Promise.all([
    hostStatus(dataDir),
    listOps(dataDir),
    patchCatalog().catch(() => null),
  ]);
  const counts = st.counts || {};
  let dshVersion = null;
  try {
    const asarPath = (st.baseline && st.baseline.asarPath) || 'C:/Users/Administrator/AppData/Local/Programs/DeepSeek Harness/resources/app.asar';
    const resDir = join(asarPath, '..');
    dshVersion = JSON.parse(readFileSync(join(resDir, 'app', 'dsh', 'package.json'), 'utf8')).version || null;
  } catch { dshVersion = null; }

  out.host = {
    id: 'dsh',
    name: 'DSH',
    installed: true,
    version: dshVersion,
    running: null,
    rows: rows([
      { k: '主机', v: os.hostname() },
      { k: 'IP', v: localIPv4() || '无外网卡' },
      { k: 'DSH', v: dshVersion || '-' },
      { k: '载入自', v: st.desktopSealed ? 'app.asar（未生效）' : 'resources/app（生效）' },
      { k: '宿主根', v: (st.primaryHost && st.primaryHost.aiBase) || '—' },
    ]),
    surface: st.surface,
    dshHome: st.dshHome,
    desktopSealed: !!st.desktopSealed,
    effective: !!st.effective,
    baseline: st.baseline || null,
    hosts: (st.hosts || []).map((h) => ({ aiBase: h.aiBase, kind: h.kind, applied: h.applied, pending: h.pending, failed: h.failed, na: h.na, hostWritten: h.hostWritten })),
    primaryHost: st.primaryHost ? { aiBase: st.primaryHost.aiBase, kind: st.primaryHost.kind } : null,
    files: (st.files || []).length,
  };

  out.injection = injectionProbe(st.dshHome || join(os.homedir(), '.dsh'));

  const catalog = catalogRaw;
  const byLayer = {};
  const byLayerApplied = {};
  for (const p of (st.patches || [])) {
    const l = layerOf(p);
    byLayer[l] = (byLayer[l] || 0) + 1;
    if (p.tone === 'ok') byLayerApplied[l] = (byLayerApplied[l] || 0) + 1;
  }
  out.patches = {
    applicable: true,
    name: '宿主补丁',
    unit: '条',
    total: counts.total || 0,
    applied: counts.applied || 0,
    pending: counts.pending || 0,
    failed: counts.failed || 0,
    na: counts.na || 0,
    byLayer,
    byLayerApplied,
    catalog: catalog && catalog.ok ? { count: catalog.count, digest: String(catalog.digest || '').slice(0, 12), upstream: catalog.upstream || null } : null,
    notable: (st.patches || [])
      .filter((p) => p.tone === 'fail' || p.tone === 'wait')
      .slice(0, 6)
      .map((p) => ({ id: p.id, name: p.name, nameZh: p.nameZh, status: p.status, tone: p.tone })),
  };

  const byId = {};
  for (const o of (ops.ops || [])) byId[o.id] = o;
  const pi = byId['plugin-install'];
  const rt = byId['redteam-pack'];
  const idn = byId['identity'];
  const d = (pi && pi.detail) || {};
  out.plugins = {
    applicable: true,
    bundles: d.bundles || [],
    bundleCount: (d.bundles || []).length,
    skipped: d.skipped || [],
    profile: d.profile || null,
    installed: (d.plugins || []).map((p) => ({ name: p.name, version: p.installed, inBundles: p.inBundles, spec: p.spec ? String(p.spec).split(/[\\/]/).pop() : null })),
    redteam: rt ? { summary: rt.summary, detail: rt.detail || null } : null,
    identity: idn ? { summary: idn.summary, detail: idn.detail || null } : null,
  };
  out.capabilities = opsSectionFrom(ops, true);
  out.ok = true;
}

// ------------------------------------------------------------------ MengBot
function mengbotVersion() {
  const roots = [
    join(process.env.LOCALAPPDATA || '', 'Programs', 'mengbot', 'resources', 'app'),
    join(process.env.LOCALAPPDATA || '', 'Programs', 'mengbot'),
  ];
  for (const r of roots) {
    try {
      const j = JSON.parse(readFileSync(join(r, 'package.json'), 'utf8'));
      if (j && j.version) return j.version;
    } catch { /* 下一个候选 */ }
  }
  return null;
}

async function mengbotPayload(out) {
  const st = await mbStatus();
  let bots = [];
  try { const r = mbListBots(); bots = (r && r.bots) || []; } catch { bots = []; }
  const injected = bots.filter((b) => (b.soulBytes || 0) > 0);
  const soulChars = injected.reduce((n, b) => n + (b.soulChars || 0), 0);
  const app = st.app || {};
  out.host = {
    id: 'mengbot',
    name: 'MengBot',
    installed: !!st.ok,
    version: app.version || app.appVersion || mengbotVersion(),
    running: !!st.processRunning,
    rows: rows([
      { k: '主机', v: os.hostname() },
      { k: 'IP', v: localIPv4() || '无外网卡' },
      { k: 'MengBot', v: app.version || app.appVersion || mengbotVersion() || '未标注' },
      { k: '进程', v: st.processRunning ? '运行中' + (st.processPid ? ' · pid ' + st.processPid : '') : '未运行' },
      { k: '端口', v: String(st.port || '-') },
      { k: 'bots.json', v: st.botsFile || '—' },
    ]),
    reachable: !!st.reachable,
    port: st.port,
    dataDir: st.dataDir,
    botsFile: st.botsFile,
    botsCount: st.botsCount || bots.length,
  };
  out.patches = {
    applicable: false,
    name: 'bot SOUL 注入',
    unit: '个 bot',
    note: 'MengBot 没有字节补丁层：破甲只有一条路 —— 把模板写进 bot 的 SOUL（bots.json 的 soul 字段），重启 MengBot 生效',
    total: bots.length,
    applied: injected.length,
    stats: rows([
      { k: 'bot 总数', v: String(bots.length), mono: false },
      { k: '已注入 SOUL', v: String(injected.length), mono: false },
      { k: 'SOUL 字符', v: String(soulChars), mono: false },
      { k: '快照数', v: String(bots.reduce((n, b) => n + (b.snapshotCount || 0), 0)), mono: false },
    ]),
  };
  out.plugins = {
    applicable: false,
    note: 'MengBot 没有 profile bundles；装备走 gear 注入（bots.json 的 gear 字段）',
    bundleCount: 0,
    bundles: [],
    installed: [],
    stats: rows([
      { k: '已装备 bot', v: String(bots.filter((b) => Object.keys(b.gear || {}).length).length), mono: false },
      { k: 'SOUL 漂移', v: String(bots.filter((b) => b.soulDrift).length), mono: false },
    ]),
  };
  out.capabilities = await opsSection(null, false);
  out.ok = st.ok !== false;
  if (!st.ok) out.errors.push('mengbot: bots.json 读不到（' + (st.botsFile || '未知路径') + '）');
}

// ------------------------------------------------------------------ AutoKill
async function autokillPayload(out, provider) {
  const s = (provider && await provider()) || {};
  const items = s.items || [];
  const applied = items.filter((x) => x.applied).length;
  out.host = {
    id: 'autokill',
    name: 'AutoKill',
    installed: !!s.installed,
    version: s.version || null,
    running: !!s.running,
    rows: rows([
      { k: '主机', v: os.hostname() },
      { k: 'IP', v: localIPv4() || '无外网卡' },
      { k: 'AutoKill', v: s.version || '-' },
      { k: '进程', v: s.running ? '运行中' : '未运行' },
      { k: 'config', v: s.config || '—' },
      { k: 'CLI', v: s.cli || '—' },
    ]),
    config: s.config || null,
    cli: s.cli || null,
    support: s.support || null,
  };
  out.patches = {
    applicable: true,
    name: '梦神破甲',
    unit: '项',
    total: items.length,
    applied,
    items: items.map((x) => ({ id: x.id, label: x.label, applied: !!x.applied, current: x.current, target: String(x.target) })),
    note: items.length ? '' : (s.installed ? 'AutoKill CLI 没返回补丁状态' : '没找到 autokill-cli.exe'),
  };
  out.plugins = {
    applicable: false,
    note: 'AutoKill 没有 bundles；MCP 插件与 UI 插槽随「应用梦神破甲」一并挂载 / 卸载（见破甲页）',
    bundleCount: 0,
    bundles: [],
    installed: [],
  };
  out.capabilities = await opsSection(null, false);
  out.ok = items.length > 0 || !!s.installed;
  if (!s.installed) out.errors.push('autokill: 没找到 autokill-cli.exe');
}

/**
 * 按宿主聚合。providers.autokill 由 server 注入（CLI 调用住在 server 里）。
 * @param {string} dataDir
 * @param {'dsh'|'mengbot'|'autokill'} hostId
 * @param {{autokill?: () => Promise<any>}} providers
 */
const CACHE = new Map();
const INFLIGHT = new Map();
const CACHE_TTL = 15000;

export async function injectSummary(dataDir, hostId = 'dsh', providers = {}, opts = {}) {
  const id = String(hostId || 'dsh').toLowerCase();
  if (!SUMMARY_HOSTS.includes(id)) {
    const e = new Error('unknown_host');
    e.code = 'unknown_host';
    e.hostId = id;
    throw e;
  }
  // 短缓存：hostStatus(2.5s) + listOps(2.3s) 是右侧栏最贵的两块，并行后冷启动 ~2.3s。
  // 缓存活 15 秒；写操作后前端带 fresh=1 绕过它 —— 所以不会出现"点完注入栏里还是旧数"。
  const key = id + '|' + (dataDir || '');
  const now = Date.now();
  if (!opts.fresh) {
    const hit = CACHE.get(key);
    if (hit && now - hit.at < CACHE_TTL) return Object.assign({}, hit.data, { cached: true, ageMs: now - hit.at });
  }
  // 单飞：启动预热与页面首屏常常同时到达，不合并就会把同一份 hostStatus+listOps 跑两遍（实测 7.7s）
  const inflight = INFLIGHT.get(key);
  if (inflight) return inflight;
  const p = (async () => {
    const out = baseOut(id);
    try {
      if (id === 'dsh') await dshPayload(out, dataDir);
      else if (id === 'mengbot') await mengbotPayload(out);
      else await autokillPayload(out, providers.autokill);
    } catch (e) {
      out.ok = false;
      out.errors.push(id + ': ' + String((e && e.message) || e));
    }
    if (out.ok) CACHE.set(key, { at: Date.now(), data: out });
    return out;
  })();
  INFLIGHT.set(key, p);
  try {
    return await p;
  } finally {
    if (INFLIGHT.get(key) === p) INFLIGHT.delete(key);
  }
}
