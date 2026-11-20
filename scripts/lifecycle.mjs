// lifecycle.mjs —— 三宿主（DSH / MengBot / AutoKill）统一「备份 / 还原 / 一键安装 / 卸载干净」
//
// 为什么要有这一层：三家的原语分散在各处（host.mjs、mengbot.mjs、server 内部、patch 脚本），
// 单点都能用，但没有一个地方能回答「现在装干净了吗 / 卸干净了吗」。这里只做编排 + 验收：
//   · 每个动作都先备份，失败不破坏现状；
//   · 每个动作都能 --dry-run 只打印计划；
//   · uninstall 之后跑 verify，给出逐项残留检查（这是「干净」的判据）。
//
// 用法（需要控制台在 8792 跑着；MengBot 补丁脚本直接本地跑）：
//   node scripts/lifecycle.mjs status
//   node scripts/lifecycle.mjs backup  --host=dsh|mengbot|autokill|all
//   node scripts/lifecycle.mjs install --host=... [--dry-run]
//   node scripts/lifecycle.mjs uninstall --host=... [--dry-run]
//   node scripts/lifecycle.mjs verify  --host=...
import { existsSync, readFileSync, readdirSync, statSync, mkdirSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';

const BASE = process.env.PURGE_WEB_BASE || 'http://127.0.0.1:8792';
const HOME = process.env.USERPROFILE || homedir();
const ROOT = process.env.PURGE_ROOT || 'F:/MyApp/eternal/autokill-purge';
const args = process.argv.slice(2);
const cmd = (args[0] || 'status').toLowerCase();
const hostArg = (args.find((a) => a.startsWith('--host=')) || '--host=all').slice(7);
const DRY = args.includes('--dry-run');

const HOSTS = hostArg === 'all' ? ['dsh', 'mengbot', 'autokill'] : [hostArg];

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(120000),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 500) }; }
  return { status: res.status, json };
}

const MB = {
  bots: join(HOME, '.mengbot', 'bots.json'),
  serverIdx: join(process.env.LOCALAPPDATA || '', 'Programs', 'mengbot', 'resources', 'server', 'index.js'),
  approval: join(process.env.LOCALAPPDATA || '', 'Programs', 'mengbot', 'resources', 'server', 'shared', 'approval-mode.js'),
  patchScript: join(ROOT, 'scripts', 'patch-mengbot-wrap.mjs'),
  payload: join(ROOT, 'web', 'prompts', 'mengbot-soul.md'),
  marker: '# 执行纪律（优先级最高',
};
const AK = {
  config: join(process.env.APPDATA || join(HOME, 'AppData', 'Roaming'), 'autokill', 'config.toml'),
  prompt: join(process.env.APPDATA || join(HOME, 'AppData', 'Roaming'), 'autokill', 'prompt-inject.md'),
};
const DSH = {
  prompt: join(HOME, '.dsh', 'prompt-inject.md'),
  profilePkg: join(HOME, '.dsh', 'profiles', 'desktop', 'package.json'),
};

// ---------- status ----------
async function statusDsh() {
  const r = await api('/api/host/status');
  const c = (r.json && r.json.counts) || {};
  const hh = await api('/api/host/handoff');
  return {
    host: 'dsh',
    installed: (c.applied || 0) > 0,
    patches: c,
    effective: !!(hh.json && hh.json.effective),
    prompt: existsSync(DSH.prompt) ? statSync(DSH.prompt).size : 0,
    plugin: (() => { try { return !!JSON.parse(readFileSync(DSH.profilePkg, 'utf8')).dependencies['autokill-purge-plugin']; } catch { return false; } })(),
  };
}
async function statusMengbot() {
  const r = await api('/api/mengbot/status');
  const bots = await api('/api/mengbot/bots');
  const injected = (bots.json && bots.json.bots || []).filter((b) => String(b.soulPreview || '').startsWith(MB.marker)).length;
  let patches = null;
  try { patches = JSON.parse(execFileSync('node', [MB.patchScript, '--check'], { encoding: 'utf8' })).targets.filter((t) => t.exists).map((t) => ({ file: t.file, patched: t.patched })); } catch { patches = 'check_failed'; }
  return { host: 'mengbot', installed: injected > 0 || (Array.isArray(patches) && patches.some((p) => p.patched)), bots: (bots.json && bots.json.count) || 0, injected, running: !!(r.json && r.json.processRunning), patches };
}
async function statusAutokill() {
  const mcp = await api('/api/autokill/mcp');
  const slots = await api('/api/autokill/slots');
  return {
    host: 'autokill',
    installed: !!(mcp.json && (mcp.json.mounted || mcp.json.present)) || existsSync(AK.prompt),
    mcpMounted: !!(mcp.json && (mcp.json.mounted || mcp.json.present)),
    prompt: existsSync(AK.prompt) ? statSync(AK.prompt).size : 0,
    configExists: existsSync(AK.config),
    slots: (slots.json && slots.json.slots) || null,
  };
}
const statusOf = { dsh: statusDsh, mengbot: statusMengbot, autokill: statusAutokill };

// ---------- backup ----------
async function backup(host) {
  if (DRY) return { host, dryRun: true, plan: ['快照到 data/lifecycle-backups/<stamp>/' + host] };
  if (host === 'dsh') {
    const r = await api('/api/host/snapshot', { method: 'POST', body: { confirm: true, tag: 'lifecycle' } });
    return { host, ok: r.json && r.json.ok !== false, snapshot: r.json && r.json.id };
  }
  if (host === 'mengbot') {
    const r = await api('/api/mengbot/snapshots');
    return { host, ok: true, existing: (r.json && r.json.files || []).length, note: 'MengBot 的备份是逐 bot pre-inject 快照；新注入会自动再存一份' };
  }
  if (host === 'autokill') {
    // AutoKill 没有宿主内快照接口：直接把 config.toml + prompt-inject.md 复制到 data/lifecycle-backups/
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const dir = join(ROOT, 'data', 'lifecycle-backups', stamp + '-autokill');
    mkdirSync(dir, { recursive: true });
    const copied = [];
    for (const [name, src] of [['config.toml', AK.config], ['prompt-inject.md', AK.prompt]]) {
      if (existsSync(src)) { copyFileSync(src, join(dir, name)); copied.push(name); }
    }
    return { host, ok: true, dir, copied, empty: copied.length === 0 };
  }
}

// ---------- restore ----------
async function restore(host) {
  const plan = {
    dsh: ['回到最近一份快照（data/host-snapshots/<最新>）', '恢复前再存一份 pre-restore 守卫快照'],
    mengbot: ['逐 bot 回到最近一次 pre-inject 快照（恢复前再存 pre-restore）'],
    autokill: ['从 data/lifecycle-backups/<最新>-autokill 拷回 config.toml + prompt-inject.md'],
  }[host];
  if (DRY) return { host, dryRun: true, plan };
  if (host === 'dsh') {
    const r = await api('/api/host/restore', { method: 'POST', body: { confirm: true } });
    return { host, ok: r.json && r.json.ok !== false, restored: r.json && (r.json.id || r.json.restored), guard: r.json && r.json.guard };
  }
  if (host === 'mengbot') {
    const bots = await api('/api/mengbot/bots');
    const out = [];
    for (const b of (bots.json && bots.json.bots) || []) {
      const r = await api('/api/mengbot/restore', { method: 'POST', body: { id: b.id, confirm: true } });
      out.push({ name: b.name, action: r.json && r.json.ok ? 'restored' : (r.json && r.json.error) || 'failed' });
    }
    return { host, ok: true, restored: out };
  }
  if (host === 'autokill') {
    const base = join(ROOT, 'data', 'lifecycle-backups');
    if (!existsSync(base)) return { host, ok: false, error: 'no_backup_dir' };
    const dirs = readdirSync(base).filter((n) => n.endsWith('-autokill')).sort();
    if (!dirs.length) return { host, ok: false, error: 'no_autokill_backup' };
    const latest = join(base, dirs[dirs.length - 1]);
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const guard = join(ROOT, 'data', 'lifecycle-backups', stamp + '-autokill-guard');
    mkdirSync(guard, { recursive: true });
    const done = [];
    for (const [name, dst] of [['config.toml', AK.config], ['prompt-inject.md', AK.prompt]]) {
      const src = join(latest, name);
      if (!existsSync(src)) continue;
      if (existsSync(dst)) copyFileSync(dst, join(guard, name));
      copyFileSync(src, dst);
      done.push(name);
    }
    return { host, ok: true, from: latest, guard, restored: done };
  }
}

// ---------- install ----------
async function install(host) {
  const plan = {
    dsh: ['整组 apply 83 条补丁', '写 prompt-inject.md', '装 autokill-purge-plugin 进 profile', '落地（挪 asar）需人工确认'],
    mengbot: ['打 5 条宿主补丁（scripts/patch-mengbot-wrap.mjs --apply）', '给每个 bot 的 soul 前置破甲正文', '清 node-compile 缓存，重启 MengBot 生效'],
    autokill: ['把 autokill-purge 挂成 AutoKill 的 MCP 插件', '写 prompt-inject.md', '写 ui.slots（可选）'],
  }[host];
  if (DRY) return { host, dryRun: true, plan };
  if (host === 'dsh') {
    const a = await api('/api/host/apply', { method: 'POST', body: { confirm: true } });
    const p = await api('/api/host/prompt', { method: 'POST', body: { confirm: true, reset: true } });
    const g = await api('/api/host/apply', { method: 'POST', body: { confirm: true, plugins: ['autokill-purge-plugin'] } });
    return { host, ok: true, apply: a.json && a.json.applied, prompt: p.json && p.json.bytes, plugin: g.json && g.json.plugin };
  }
  if (host === 'mengbot') {
    let patch = null;
    try { patch = JSON.parse(execFileSync('node', [MB.patchScript, '--apply'], { encoding: 'utf8' })); } catch (e) { patch = { ok: false, error: String(e && e.message || e) }; }
    const payload = readFileSync(MB.payload, 'utf8');
    const bots = await api('/api/mengbot/bots');
    const out = [];
    for (const b of (bots.json && bots.json.bots) || []) {
      if (String(b.soulPreview || '').startsWith(MB.marker)) { out.push({ name: b.name, action: 'skip(已注入)' }); continue; }
      const r = await api('/api/mengbot/inject', { method: 'POST', body: { id: b.id, text: payload, mode: 'prefix', confirm: true } });
      out.push({ name: b.name, action: r.json && r.json.ok ? 'injected' : 'failed' });
    }
    return { host, ok: true, patch, injected: out };
  }
  if (host === 'autokill') {
    const m = await api('/api/autokill/mcp', { method: 'POST', body: { confirm: true, action: 'mount' } });
    const p = await api('/api/breach/inject-host', { method: 'POST', body: { confirm: true, host: 'autokill' } });
    return { host, ok: true, mcp: m.json, prompt: p.json };
  }
}

// ---------- uninstall ----------
async function uninstall(host) {
  const plan = {
    dsh: ['恢复 asar 原件', '按 asar 基线还原补丁', '删 prompt-inject.md 的注入块', '从 profile 卸插件', '验证：pending=0 且无残留'],
    mengbot: ['5 条补丁 --revert 回 .bak', '逐 bot 用 pre-inject 快照还原 soul', '清 node-compile 缓存'],
    autokill: ['卸 MCP 插件', '删 prompt-inject.md', '清 ui.slots 里 purge 的块'],
  }[host];
  if (DRY) return { host, dryRun: true, plan };
  if (host === 'dsh') {
    const u = await api('/api/host/uninstall', { method: 'POST', body: { confirm: true } });
    return { host, ok: u.json && u.json.ok !== false, steps: u.json && u.json.steps };
  }
  if (host === 'mengbot') {
    let patch = null;
    try { patch = JSON.parse(execFileSync('node', [MB.patchScript, '--revert'], { encoding: 'utf8' })); } catch (e) { patch = { ok: false, error: String(e && e.message || e) }; }
    const bots = await api('/api/mengbot/bots');
    const out = [];
    for (const b of (bots.json && bots.json.bots) || []) {
      if (!String(b.soulPreview || '').startsWith(MB.marker)) { out.push({ name: b.name, action: 'skip(未注入)' }); continue; }
      const r = await api('/api/mengbot/restore', { method: 'POST', body: { id: b.id, confirm: true } });
      out.push({ name: b.name, action: r.json && r.json.ok ? 'restored' : 'failed' });
    }
    return { host, ok: true, patch, restored: out };
  }
  if (host === 'autokill') {
    const m = await api('/api/autokill/mcp', { method: 'POST', body: { confirm: true, action: 'unmount' } });
    const r = await api('/api/autokill/revert', { method: 'POST', body: { confirm: true } });
    return { host, ok: true, mcp: m.json, revert: r.json };
  }
}

// ---------- verify（"干净"的判据） ----------
async function verify(host) {
  const s = await statusOf[host]();
  const checks = [];
  if (host === 'dsh') {
    checks.push(['补丁已全部还原', (s.patches.applied || 0) === 0, 'applied=' + (s.patches.applied || 0)]);
    checks.push(['prompt-inject.md 不存在', !existsSync(DSH.prompt), DSH.prompt]);
    checks.push(['profile 里没有插件声明', !s.plugin, DSH.profilePkg]);
    const hh = await api('/api/host/handoff');
    checks.push(['asar 已放回原位', !(hh.json && hh.json.asideExists), JSON.stringify(hh.json && hh.json.aside)]);
  } else if (host === 'mengbot') {
    checks.push(['没有 bot 带注入', s.injected === 0, 'injected=' + s.injected]);
    const patched = Array.isArray(s.patches) ? s.patches.filter((p) => p.patched) : [];
    checks.push(['宿主补丁已回滚', patched.length === 0, patched.map((p) => p.file).join(',')]);
  } else if (host === 'autokill') {
    checks.push(['MCP 插件已卸', !s.mcpMounted, 'mounted=' + s.mcpMounted]);
    checks.push(['prompt-inject.md 不存在', !existsSync(AK.prompt), AK.prompt]);
  }
  return { host, clean: checks.every((c) => c[1]), checks: checks.map(([name, ok, detail]) => ({ name, ok, detail })) };
}

// ---------- main ----------
const out = { cmd, host: hostArg, dryRun: DRY, at: new Date().toISOString(), results: [] };
for (const h of HOSTS) {
  try {
    if (cmd === 'status') out.results.push(await statusOf[h]());
    else if (cmd === 'backup') out.results.push(await backup(h));
    else if (cmd === 'restore') out.results.push(await restore(h));
    else if (cmd === 'install') out.results.push(await install(h));
    else if (cmd === 'uninstall') out.results.push(await uninstall(h));
    else if (cmd === 'verify') out.results.push(await verify(h));
    else { out.error = 'unknown cmd: ' + cmd; break; }
  } catch (e) {
    out.results.push({ host: h, error: String((e && e.message) || e) });
  }
}
console.log(JSON.stringify(out, null, 2));
process.exit(out.error || out.results.some((r) => r.error) ? 1 : 0);
