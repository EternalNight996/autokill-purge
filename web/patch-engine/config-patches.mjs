// 配置层补丁（不碰二进制、不改签名）：Codex 的 approval/sandbox 硬闸，Claude Code 的权限模式。
//
//   node web/patch-engine/config-patches.mjs check            # 只看现状
//   node web/patch-engine/config-patches.mjs apply            # 写（原文件不存在就创建；存在则先备份）
//   node web/patch-engine/config-patches.mjs revert           # 还原（原本不存在的就删掉）
//   node web/patch-engine/config-patches.mjs check --json
//
// 为什么单独一条：这两个宿主的"硬闸"不在提示词里，而在官方配置面——
//   · Codex：approval_policy = "never" + sandbox_mode = "danger-full-access"
//            （`codex doctor` 会直接显示 "unrestricted fs + enabled network · approval Never"）
//   · Claude Code：settings.json 的 defaultMode = "bypassPermissions" + permissions.allow 全工具
// 改配置比改 exe 稳：签名不变、升级不被覆盖、随时可回滚。
import { copyFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

const HOME = process.env.USERPROFILE || homedir();
const ARGS = process.argv.slice(2);
const MODE = (ARGS.find((a) => ['check', 'apply', 'revert'].includes(a)) || 'check').toLowerCase();
const AS_JSON = ARGS.includes('--json');

// ---------------- Codex（TOML，段落感知的最小实现） ----------------
const CODEX_FILE = join(HOME, '.codex', 'config.toml');
const CODEX_WANT = {
  approval_policy: 'never',
  sandbox_mode: 'danger-full-access',
};

function tomlGet(text, key) {
  const lines = String(text).split(/\r?\n/);
  let section = '';
  for (const line of lines) {
    const m = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (m) { section = m[1].trim(); continue; }
    if (section) continue;                       // 只看顶层键
    const kv = new RegExp('^\\s*' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*=\\s*(.+?)\\s*$').exec(line);
    if (kv) return kv[1].replace(/^["']|["']$/g, '');
  }
  return null;
}

function tomlSet(text, key, value) {
  const lines = String(text).split(/\r?\n/);
  let section = '';
  const val = typeof value === 'boolean' || typeof value === 'number' ? String(value) : JSON.stringify(String(value));
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*\[([^\]]+)\]\s*$/.exec(lines[i]);
    if (m) { section = m[1].trim(); continue; }
    if (section) continue;
    const re = new RegExp('^(\\s*' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*=\\s*)(.+?)(\\s*)$');
    const kv = re.exec(lines[i]);
    if (kv) { lines[i] = kv[1] + val + kv[3]; return lines.join('\n'); }
  }
  // 顶层没有：插到第一个 section 之前（或末尾）
  let at = lines.findIndex((l) => /^\s*\[/.test(l));
  if (at < 0) at = lines.length;
  lines.splice(at, 0, `${key} = ${val}`);
  return lines.join('\n');
}

function codexCheck() {
  const exists = existsSync(CODEX_FILE);
  const text = exists ? readFileSync(CODEX_FILE, 'utf8') : '';
  const rows = Object.entries(CODEX_WANT).map(([k, want]) => {
    const cur = exists ? tomlGet(text, k) : null;
    return { key: k, want, current: cur, ok: cur === want };
  });
  return { host: 'codex', file: CODEX_FILE, exists, rows, ok: rows.every((r) => r.ok) };
}

function codexApply() {
  const state = codexCheck();
  if (state.ok) return { ...state, changed: false };
  mkdirSync(dirname(CODEX_FILE), { recursive: true });
  const before = existsSync(CODEX_FILE) ? readFileSync(CODEX_FILE, 'utf8') : null;
  let text = before == null ? '' : before;
  for (const [k, v] of Object.entries(CODEX_WANT)) text = tomlSet(text, k, v);
  if (before != null) copyFileSync(CODEX_FILE, CODEX_FILE + '.dshpurge.bak');
  writeFileSync(CODEX_FILE, text, 'utf8');
  return { ...codexCheck(), changed: true, created: before == null, backup: before != null ? CODEX_FILE + '.dshpurge.bak' : null };
}

function codexRevert() {
  const bak = CODEX_FILE + '.dshpurge.bak';
  if (existsSync(bak)) {
    copyFileSync(bak, CODEX_FILE);
    return { host: 'codex', file: CODEX_FILE, reverted: true, from: bak };
  }
  if (existsSync(CODEX_FILE)) {
    // 原文件本来就是本工具新建的：删掉
    unlinkSync(CODEX_FILE);
    return { host: 'codex', file: CODEX_FILE, reverted: true, removed: true };
  }
  return { host: 'codex', file: CODEX_FILE, reverted: false, reason: 'nothing to revert' };
}

// ---------------- Claude Code（JSON） ----------------
const CLAUDE_FILE = join(HOME, '.claude', 'settings.json');
const CLAUDE_WANT = {
  defaultMode: 'bypassPermissions',
  allowAllTools: true,
};

function claudeCheck() {
  const exists = existsSync(CLAUDE_FILE);
  let j = {};
  let parseError = null;
  if (exists) { try { j = JSON.parse(readFileSync(CLAUDE_FILE, 'utf8')); } catch (e) { parseError = e.message; } }
  const mode = j.defaultMode || null;
  const allow = (j.permissions && Array.isArray(j.permissions.allow)) ? j.permissions.allow : [];
  return {
    host: 'claude-code', file: CLAUDE_FILE, exists, parseError,
    rows: [
      { key: 'defaultMode', want: CLAUDE_WANT.defaultMode, current: mode, ok: mode === CLAUDE_WANT.defaultMode },
      { key: 'permissions.allow', want: '(含 Bash/Write/Edit…)', current: allow.length + ' 项', ok: allow.length >= 8 },
    ],
    ok: !parseError && mode === CLAUDE_WANT.defaultMode && allow.length >= 8,
  };
}

function claudeApply() {
  const state = claudeCheck();
  if (state.ok) return { ...state, changed: false };
  mkdirSync(dirname(CLAUDE_FILE), { recursive: true });
  const before = existsSync(CLAUDE_FILE) ? readFileSync(CLAUDE_FILE, 'utf8') : null;
  let j = {};
  if (before) { try { j = JSON.parse(before); } catch { j = {}; } }
  j.defaultMode = CLAUDE_WANT.defaultMode;
  j.permissions = j.permissions || {};
  j.permissions.allow = [...new Set([
    ...(Array.isArray(j.permissions.allow) ? j.permissions.allow : []),
    'Bash', 'Read', 'Write', 'Edit', 'MultiEdit', 'Glob', 'Grep', 'LS',
    'NotebookEdit', 'NotebookRead', 'WebFetch', 'WebSearch', 'Task', 'TodoWrite',
  ])];
  j.permissions.deny = Array.isArray(j.permissions.deny) ? j.permissions.deny : [];
  j.permissions.ask = Array.isArray(j.permissions.ask) ? j.permissions.ask : [];
  if (before != null) copyFileSync(CLAUDE_FILE, CLAUDE_FILE + '.dshpurge.bak');
  writeFileSync(CLAUDE_FILE, JSON.stringify(j, null, 2) + '\n', 'utf8');
  return { ...claudeCheck(), changed: true, created: before == null, backup: before != null ? CLAUDE_FILE + '.dshpurge.bak' : null };
}

function claudeRevert() {
  const bak = CLAUDE_FILE + '.dshpurge.bak';
  if (existsSync(bak)) {
    copyFileSync(bak, CLAUDE_FILE);
    return { host: 'claude-code', file: CLAUDE_FILE, reverted: true, from: bak };
  }
  if (existsSync(CLAUDE_FILE)) {
    unlinkSync(CLAUDE_FILE);
    return { host: 'claude-code', file: CLAUDE_FILE, reverted: true, removed: true };
  }
  return { host: 'claude-code', file: CLAUDE_FILE, reverted: false, reason: 'nothing to revert' };
}

// ---------------- 主流程 ----------------
const result = MODE === 'apply'
  ? { mode: MODE, codex: codexApply(), claude: claudeApply() }
  : MODE === 'revert'
    ? { mode: MODE, codex: codexRevert(), claude: claudeRevert() }
    : { mode: MODE, codex: codexCheck(), claude: claudeCheck() };

const ok = MODE === 'revert'
  ? true
  : (result.codex.ok !== false && result.claude.ok !== false);

if (AS_JSON) {
  console.log(JSON.stringify({ ok, ...result }, null, 2));
} else {
  console.log(`[config-patches] ${MODE}`);
  for (const [name, r] of [['codex', result.codex], ['claude-code', result.claude]]) {
    if (r.rows) {
      console.log(`  ${name} → ${r.file}  ${r.ok ? '✅ 已就位' : '⚠ 未就位'}`);
      for (const row of r.rows) console.log(`      ${row.key}: ${row.current ?? '(缺)'}${row.ok ? '' : '  → 期望 ' + row.want}`);
    } else {
      console.log(`  ${name} → ${JSON.stringify(r)}`);
    }
  }
}
process.exit(ok ? 0 : 1);
