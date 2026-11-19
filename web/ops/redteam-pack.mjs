// web/ops/redteam-pack.mjs —— dsh-purge 的 redteam 能力面（48 技能 + 5 角色 + 工具面托管）
//
// 为什么拆两半：
//   技能（skills/redteam/*.md）与角色（presets/redteam/*）本质是**数据**，外部控制台可以直接落盘，
//   DSH 的 skill-filesystem 提供方会自己扫 $DSH_HOME/skills/<name>/SKILL.md，角色走 $DSH_HOME/.agent-presets/<name>/。
//   但 redteam_* 工具必须在 DSH 进程内由插件 ctx.tools 注册，外部装不了 —— 所以那一半只做**体检与交代**，
//   不假装能装。这是本模块的核心纪律：能装的如实装，装不了的如实说清两条替代路径。
//
// 目录事实（本机侦察 2026-11-19）：
//   $DSH_HOME/skills/<id>/SKILL.md        ← 官方 bundle 布局（mem-purge-recall 就是这种），本模块的落地目标
//   $DSH_HOME/.agent-presets/redteam/     ← dsh-agent-presets 的用户 preset 根，dsh-purge 首次启动就往这写
//   $DSH_HOME/redteam/skills/*.md         ← dsh-purge 自己的平铺副本（预设用 dshHomePath('redteam/skills') 指它）
//   $DSH_HOME/profiles/<p>/node_modules/dsh-purge   ← 插件本体，工具面与冲突判断的真实来源
//
// 纪律（contract.mjs）：
//   status() 只读；run() 幂等、自己 catch、绝不裸抛；任何覆盖/删除之前先备份到 data/redteam-pack-backups/。
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

export const META = {
  id: 'redteam-pack',
  zh: '红队能力面（技能/角色安装 + 工具面托管）',
  en: 'Red-team pack (skills/roles install + tool hosting)',
  kind: 'both',
  requires: [],
  note: '技能与角色是数据，控制台可直接装；redteam_* 工具必须由 DSH 插件注册，这里只体检并给出替代路径。',
};

/** 与官方 @deepseek-ai/dsh-skill 一致：kebab-case，否则 skill 会被静默丢弃。 */
const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** 上游把描述截到 500 字；frontmatter 超长会被截断而不是报错，这里保持一致。 */
const MAX_DESCRIPTION = 500;
const SKILLS_SUBDIR = 'skills';
const USER_PRESET_PARENT = '.agent-presets';
const PRESET_NAME = 'redteam';
const ROLE_PLACEHOLDER = '{{REDTEAM_SKILLS_DIR}}';
/** 上游预设里技能目录的占位符落到本机时替换成这句（见 dsh-purge lib/redteam/index.js renderSkillsDir）。 */
const ROLE_SKILLS_EXPR = "!!js dshHomePath('redteam/skills')";
const BACKUP_SUBDIR = 'redteam-pack-backups';
/**
 * 安装台账：记录"上一次是我们写的 sha"。
 * 为什么需要它：源升级后文件内容会变（该覆盖），用户手改后内容也会变（不该覆盖）——
 * 只看 sha 不等根本分不清这两种。台账把"我们写的"钉住，才能既修得过期、又不吃掉用户的改动。
 * 它只在 run() 里写，status() 只读。
 */
const STATE_FILE = 'redteam-pack-state.json';
/** 任务书标称 56；实测以插件 lib/redteam/tools.js 的正则计数为准（1.1.71 实为 58），差异在 detail 里点明。 */
const EXPECTED_TOOL_COUNT = 56;
/** 上游 1.1.71 的技能/角色数量基线，仅用于"源明显不对"的快速判断，不做硬校验。 */
const EXPECTED_SKILL_COUNT = 48;
const EXPECTED_ROLE_FILE_COUNT = 3;
/** 只对这几个扩展名做占位符替换，避免把二进制资源当文本折腾。 */
const TEXT_EXT_RE = /\.(md|yml|yaml|mjs|cjs|js|json|txt)$/i;

// ───────────────────────────── 小工具 ─────────────────────────────

function sha256(input) {
  return createHash('sha256').update(input).digest('hex');
}

function bufSha(buf) {
  return sha256(buf);
}

function readTextIfExists(fp) {
  try {
    return readFileSync(fp, 'utf8');
  } catch {
    return null;
  }
}

function readBufIfExists(fp) {
  try {
    return readFileSync(fp);
  } catch {
    return null;
  }
}

function isDirectory(fp) {
  try {
    return statSync(fp).isDirectory();
  } catch {
    return false;
  }
}

function isFile(fp) {
  try {
    return statSync(fp).isFile();
  } catch {
    return false;
  }
}

function safeReaddir(fp) {
  try {
    return readdirSync(fp, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** 防跑偏：任何写入/删除都必须落在预设根之内，别让一个拼错的 id 把别处删了。 */
function assertInsideAny(roots, target) {
  const b = resolve(target);
  const inside = roots.some((root) => {
    const a = resolve(root);
    if (b === a) return true;
    const prefix = a.endsWith(sep) ? a : a + sep;
    return b.startsWith(prefix);
  });
  if (!inside) throw new Error('路径越界：' + b);
}

/** 原子写：先写同目录临时文件再 rename，避免 DSH 的 watcher 读到半个 SKILL.md。 */
function atomicWriteFile(fp, data) {
  mkdirSync(dirname(fp), { recursive: true });
  const tmp = fp + '.tmp-' + process.pid + '-' + Date.now();
  writeFileSync(tmp, data);
  try {
    renameSync(tmp, fp);
  } catch (e) {
    try { rmSync(tmp, { force: true }); } catch { /* 临时文件清不掉不影响主流程 */ }
    throw e;
  }
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

// ───────────────────── frontmatter 解析（移植自 dsh-purge lib/skills.js） ─────────────────────
//
// 为什么自己写：SKILL.md 的 frontmatter 是 YAML 的**子集**，但子集里就有块标量（| / >）、chomp 指示、
// 引号与行内注释。零依赖下要么引个 yaml 包（违反项目约束），要么按官方语义只认这几个键。这里选后者，
// 并且解析失败必须能说出"哪个键不对"，否则 48 篇里坏一篇会被 DSH 静默丢弃，无从排查。

export function splitFrontmatter(raw) {
  const text = String(raw || '').replace(/^\uFEFF/, '');
  if (!text.startsWith('---')) return null;
  const afterOpen = text.slice(3);
  if (!/^\r?\n/.test(afterOpen)) return null;
  const rest = afterOpen.replace(/^\r?\n/, '');
  const close = rest.match(/\r?\n---(?:\r?\n|$)/);
  if (!close || close.index == null) return null;
  return { head: rest.slice(0, close.index), body: rest.slice(close.index + close[0].length) };
}

function yamlScalar(value) {
  const text = String(value == null ? '' : value).trim();
  if (!text) return '""';
  // 纯 ASCII 安全字符才裸写；中文/冒号/井号一律 JSON 引号包起来。
  if (/^[A-Za-z0-9._+/-]+$/.test(text)) return text;
  return JSON.stringify(text);
}

function escapeYamlKey(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 块标量：只扫 frontmatter，压成单行（官方目录与上游面板都按单行描述渲染）。 */
function blockScalarValue(head, key) {
  const lines = String(head || '').split(/\r?\n/);
  const headerRe = new RegExp('^(\\s*)' + escapeYamlKey(key) + ':\\s*([|>])([+-]?)(\\d*)\\s*(?:#.*)?$');
  let headerIdx = -1;
  let keyIndent = 0;
  let style = '|';
  let chomp = '';
  let indentHint = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(headerRe);
    if (!m) continue;
    headerIdx = i;
    keyIndent = m[1].length;
    style = m[2];
    chomp = m[3] || '';
    indentHint = m[4] ? parseInt(m[4], 10) : 0;
    break;
  }
  if (headerIdx < 0) return '';
  const body = [];
  let blockIndent = indentHint > 0 ? keyIndent + indentHint : 0;
  for (let i = headerIdx + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === '') { body.push(''); continue; }
    const indent = line.match(/^(\s*)/)[1].length;
    if (indent <= keyIndent) break;
    if (!blockIndent) blockIndent = indent;
    if (indent < blockIndent) break;
    body.push(line.slice(blockIndent));
  }
  while (body.length && body[body.length - 1] === '') body.pop();
  let text;
  if (style === '|') {
    text = body.join('\n');
  } else {
    text = '';
    for (let i = 0; i < body.length; i += 1) {
      const cur = body[i];
      if (i === 0) { text += cur; continue; }
      if (cur === '') { text += '\n'; continue; }
      if (body[i - 1] === '') { text += cur; continue; }
      text += ' ' + cur;
    }
  }
  if (chomp === '+') text += '\n';
  else if (chomp !== '-' && text.length > 0) text += '\n';
  return text.replace(/\s+/g, ' ').trim();
}

function yamlLineField(head, key) {
  const re = new RegExp('^' + escapeYamlKey(key) + ':\\s*(.*)$', 'm');
  const match = String(head || '').match(re);
  if (!match) return '';
  let value = match[1].trim();
  if (!value) return '';
  if (/^[|>][+-]?\d*\s*(?:#.*)?$/.test(value)) return blockScalarValue(head, key);
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    try {
      return value.startsWith('"') ? JSON.parse(value) : value.slice(1, -1);
    } catch {
      return value.slice(1, -1);
    }
  }
  const comment = value.indexOf(' #');
  if (comment >= 0) value = value.slice(0, comment).trim();
  return value;
}

function yamlBoolField(head, key) {
  const re = new RegExp('^' + escapeYamlKey(key) + ':\\s*(.*)$', 'm');
  const match = String(head || '').match(re);
  if (!match) return { present: false };
  let value = match[1].trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1).trim();
  }
  const comment = value.indexOf(' #');
  if (comment >= 0) value = value.slice(0, comment).trim();
  const norm = value.toLowerCase();
  if (['true', 'yes', 'on', '1'].includes(norm)) return { present: true, value: true };
  if (['false', 'no', 'off', '0'].includes(norm)) return { present: true, value: false };
  return { present: true, invalid: true };
}

export function validSkillName(id) {
  return typeof id === 'string' && SKILL_NAME_RE.test(id);
}

/**
 * 解析一篇 SKILL.md。ok=false 时带**人类可读的原因**，这样 48 篇里坏一篇能在测试与报告里点名。
 * 额外把上游自有的 role / enabled 读出来（只用于报告，不写进官方 frontmatter）。
 */
export function parseSkillDocument(raw) {
  const parts = splitFrontmatter(raw);
  if (!parts) return { ok: false, error: '缺少 YAML frontmatter（须以 --- 包围）' };
  const name = yamlLineField(parts.head, 'name');
  const description = yamlLineField(parts.head, 'description');
  if (!validSkillName(name)) return { ok: false, error: 'frontmatter.name 必须是 kebab-case，例如 active-scan' };
  if (!description) return { ok: false, error: 'frontmatter.description 必填（单行）' };
  const disableModel = yamlBoolField(parts.head, 'disable-model-invocation');
  const userInvocable = yamlBoolField(parts.head, 'user-invocable');
  if (disableModel.invalid) return { ok: false, error: 'disable-model-invocation 必须是布尔值（true/false）' };
  if (userInvocable.invalid) return { ok: false, error: 'user-invocable 必须是布尔值（true/false）' };
  return {
    ok: true,
    name,
    description,
    whenToUse: yamlLineField(parts.head, 'whenToUse'),
    role: yamlLineField(parts.head, 'role'),
    enabled: yamlBoolField(parts.head, 'enabled').value,
    modelInvocable: disableModel.value !== true,
    userInvocable: userInvocable.value !== false,
    body: parts.body,
    head: parts.head,
  };
}

/**
 * 规范化重渲染：只留官方认识的 name / description / whenToUse。
 * 为什么丢掉 role / enabled：那是 dsh-purge 面板自己认的字段，写进 $DSH_HOME/skills 只会变成未知键噪音
 * （官方 loader 对未知键不报错也不生效）。真正需要 role 的是上游平铺目录 $DSH_HOME/redteam/skills。
 */
export function renderSkillDocument(id, description, whenToUse, body) {
  if (!validSkillName(id)) throw new Error('invalid skill name: ' + id);
  const desc = String(description || '').trim().slice(0, MAX_DESCRIPTION) || id;
  const inner = String(body || '').replace(/^\uFEFF/, '').replace(/^\r?\n/, '');
  const lines = ['---', 'name: ' + id, 'description: ' + yamlScalar(desc)];
  const wtu = String(whenToUse || '').trim();
  if (wtu) lines.push('whenToUse: ' + yamlScalar(wtu));
  lines.push('---', '');
  return lines.join('\n') + inner.replace(/\r\n/g, '\n').replace(/\s*$/, '\n');
}

// ───────────────────────────── 源：dsh-purge 1.1.71 ─────────────────────────────

/** 本机所有可能装过 dsh-purge 的 profile。用户可能同时有 desktop / web / headless。 */
export function pluginRoots(ctx) {
  const out = [];
  const profilesRoot = join(ctx.dshHome || '', 'profiles');
  for (const entry of safeReaddir(profilesRoot)) {
    if (!entry.isDirectory()) continue;
    const fp = join(profilesRoot, entry.name, 'node_modules', 'dsh-purge');
    if (isDirectory(fp) && !out.includes(fp)) out.push(fp);
  }
  const hoisted = join(profilesRoot, 'node_modules', 'dsh-purge');
  if (isDirectory(hoisted) && !out.includes(hoisted)) out.push(hoisted);
  return out;
}

function readPluginMeta(root) {
  const pkg = readTextIfExists(join(root, 'package.json'));
  let version = '';
  let name = '';
  if (pkg) {
    try {
      const j = JSON.parse(pkg);
      version = String(j.version || '');
      name = String(j.name || '');
    } catch { /* package.json 坏掉就当没版本，不影响其它判断 */ }
  }
  return { version, name };
}

/**
 * 决定"这次到底以哪份源码为准"：
 *   env:DSH_PURGE_SRC > 本机插件（宿主真正加载的那份）> 开发仓参考副本。
 * 为什么插件优先于 F:\MyApp\dsh-purge-v1.1.71：用户看到的状态必须对齐宿主实际跑的版本，
 * 否则"报告已装"而实际跑的是别的版本，冲突提示就失真了。
 */
export function sourceCandidates(ctx) {
  const list = [];
  const push = (root, origin) => {
    if (!root) return;
    const abs = resolve(root);
    if (list.some((x) => x.root === abs)) return;
    list.push({ root: abs, origin });
  };
  if (process.env.DSH_PURGE_SRC) push(process.env.DSH_PURGE_SRC, 'env:DSH_PURGE_SRC');
  for (const root of pluginRoots(ctx)) push(root, 'plugin');
  // 开发仓参考副本：只读参考，允许它不存在（换机器 / 裁剪安装时）。
  // ctx.dshPurgeSrc 是给测试用的逃生口：测试要把"源缺失"也覆盖到，不能让写死的本机路径兜底，
  // 否则换任何一台机器这条分支都永远走不到。
  push(ctx && ctx.dshPurgeSrc ? ctx.dshPurgeSrc : 'F:\\MyApp\\dsh-purge-v1.1.71', 'dev-ref');
  return list;
}

export function resolveSource(ctx) {
  for (const cand of sourceCandidates(ctx)) {
    const skillsDir = join(cand.root, 'skills', 'redteam');
    if (!isDirectory(skillsDir)) continue;
    const files = safeReaddir(skillsDir).filter((e) => e.isFile() && e.name.endsWith('.md'));
    if (!files.length) continue;
    const meta = readPluginMeta(cand.root);
    return {
      root: cand.root,
      origin: cand.origin,
      version: meta.version,
      skillsDir,
      rolesDir: join(cand.root, 'presets', PRESET_NAME),
      toolsFile: join(cand.root, 'lib', 'redteam', 'tools.js'),
    };
  }
  return null;
}

/** 读 48 篇 md → 规范化清单（含期望内容与 sha，供状态比对与幂等写入复用）。 */
export function readSourceSkills(src) {
  if (!src) return [];
  const out = [];
  for (const entry of safeReaddir(src.skillsDir)) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const file = join(src.skillsDir, entry.name);
    const rawBuf = readBufIfExists(file);
    if (!rawBuf) continue;
    const raw = rawBuf.toString('utf8');
    const parsed = parseSkillDocument(raw);
    const fallbackId = entry.name.slice(0, -3);
    const id = parsed.ok ? parsed.name : (validSkillName(fallbackId) ? fallbackId : '');
    if (!id) continue;
    const rendered = parsed.ok ? renderSkillDocument(id, parsed.description, parsed.whenToUse, parsed.body) : raw;
    out.push({
      id,
      file: entry.name,
      ok: parsed.ok,
      error: parsed.ok ? null : parsed.error,
      description: parsed.ok ? parsed.description : '',
      whenToUse: parsed.ok ? parsed.whenToUse : '',
      role: parsed.ok ? parsed.role : '',
      bytes: rawBuf.length,
      rendered,
      sha: sha256(rendered),
      rawSha: bufSha(rawBuf),
    });
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

/** 读角色源（preset.yml / agent.cordis.yml / anchor-gate.mjs），文本文件替换技能目录占位符。 */
export function readSourceRoles(src) {
  if (!src || !isDirectory(src.rolesDir)) return [];
  const out = [];
  for (const entry of safeReaddir(src.rolesDir)) {
    if (!entry.isFile()) continue;
    const abs = join(src.rolesDir, entry.name);
    const rawBuf = readBufIfExists(abs);
    if (!rawBuf) continue;
    let expected = rawBuf;
    let placeholderReplaced = false;
    if (TEXT_EXT_RE.test(entry.name)) {
      const text = rawBuf.toString('utf8');
      if (text.includes(ROLE_PLACEHOLDER)) {
        expected = Buffer.from(text.split(ROLE_PLACEHOLDER).join(ROLE_SKILLS_EXPR), 'utf8');
        placeholderReplaced = true;
      }
    }
    out.push({
      name: entry.name,
      bytes: expected.length,
      expected,
      sha: bufSha(expected),
      sourceSha: bufSha(rawBuf),
      placeholderReplaced,
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

// ───────────────────────────── 落地目标（只读推导） ─────────────────────────────

export function stateFile(ctx) {
  return join(ctx.dataDir || '.', STATE_FILE);
}

export function readState(ctx) {
  const empty = { version: 1, skills: {}, roles: {}, updatedAt: null };
  const raw = readTextIfExists(stateFile(ctx));
  if (!raw) return empty;
  try {
    const j = JSON.parse(raw);
    return {
      version: 1,
      skills: (j && j.skills) || {},
      roles: (j && j.roles) || {},
      updatedAt: (j && j.updatedAt) || null,
    };
  } catch {
    return empty;
  }
}

function writeState(ctx, state) {
  const next = { version: 1, skills: state.skills || {}, roles: state.roles || {}, updatedAt: new Date().toISOString() };
  atomicWriteFile(stateFile(ctx), JSON.stringify(next, null, 2));
  return next;
}

export function skillsTarget(ctx) {
  return join(ctx.dshHome, SKILLS_SUBDIR);
}

/**
 * 角色落地目录。
 * 真实机制是 dsh-agent-presets 的用户 preset 根 $DSH_HOME/.agent-presets/<name>/（本机已存在 redteam 预设）。
 * 只有机制目录不存在时才退回 data/redteam-roles/ 并明说"DSH 侧未接入"——假装装上了比没装更坏。
 */
export function roleTarget(ctx) {
  const parent = join(ctx.dshHome, USER_PRESET_PARENT);
  if (isDirectory(parent)) {
    return {
      dir: join(parent, PRESET_NAME),
      mech: 'agent-presets',
      wired: true,
      note: 'DSH 用户 preset 根（dsh-agent-presets 会扫它）',
    };
  }
  const legacy = join(ctx.dshHome, 'presets');
  if (isDirectory(legacy)) {
    return {
      dir: join(legacy, PRESET_NAME),
      mech: 'presets-legacy',
      wired: false,
      note: '只有 $DSH_HOME/presets，DSH 不扫这个目录：写入后 DSH 侧未接入',
    };
  }
  return {
    dir: join(ctx.dataDir || '.', 'redteam-roles', PRESET_NAME),
    mech: 'data-fallback',
    wired: false,
    note: '本机没有 $DSH_HOME/.agent-presets：落到 data/redteam-roles，DSH 侧未接入',
  };
}

/**
 * 扫已装技能。一次扫完所有 bundle 与平铺文件，按 frontmatter.name（读不到则目录名）建索引：
 * 用户可能是官方 bundle 装的，也可能是上游平铺的，还可能是别的工具改过名的目录——都要认出来，
 * 否则 status 会把"其实已经能用"的技能报成缺失。
 */
export function scanInstalledSkills(ctx) {
  const dir = skillsTarget(ctx);
  const found = new Map();
  for (const entry of safeReaddir(dir)) {
    if (entry.name.startsWith('.')) continue;
    if (entry.isDirectory()) {
      if (entry.name === '.system') continue;
      const fp = join(dir, entry.name, 'SKILL.md');
      if (!isFile(fp)) continue;
      const buf = readBufIfExists(fp);
      if (!buf) continue;
      const parsed = parseSkillDocument(buf.toString('utf8'));
      const id = parsed.ok ? parsed.name : (validSkillName(entry.name) ? entry.name : '');
      if (!id || found.has(id)) continue;
      found.set(id, { id, kind: 'bundle', path: fp, dir: join(dir, entry.name), sha: bufSha(buf), parsed });
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.md') || entry.name === 'SKILL.md') continue;
    const fp = join(dir, entry.name);
    const buf = readBufIfExists(fp);
    if (!buf) continue;
    const parsed = parseSkillDocument(buf.toString('utf8'));
    const fallback = entry.name.slice(0, -3);
    const id = parsed.ok ? parsed.name : (validSkillName(fallback) ? fallback : '');
    if (!id || found.has(id)) continue;
    found.set(id, { id, kind: 'flat', path: fp, dir: null, sha: bufSha(buf), parsed });
  }
  return found;
}

/** 扫已装角色文件。 */
export function scanInstalledRoles(ctx) {
  const target = roleTarget(ctx);
  const found = new Map();
  for (const entry of safeReaddir(target.dir)) {
    if (!entry.isFile()) continue;
    const fp = join(target.dir, entry.name);
    const buf = readBufIfExists(fp);
    if (!buf) continue;
    found.set(entry.name, { name: entry.name, path: fp, sha: bufSha(buf) });
  }
  return { target, found };
}

// ───────────────────────────── 工具面托管 ─────────────────────────────

/**
 * 工具面：redteam_* 必须由 DSH 插件注册，外部装不了。
 * 这里只做三件事：在位与否、真实工具数（从 tools.js 正则数，不猜）、缺失时给两条替代路径。
 */
export function toolHosting(ctx) {
  const plugins = [];
  const profilesRoot = join(ctx.dshHome || '', 'profiles');
  for (const profile of safeReaddir(profilesRoot)) {
    if (!profile.isDirectory()) continue;
    const profileDir = join(profilesRoot, profile.name);
    const pkgText = readTextIfExists(join(profileDir, 'package.json'));
    let bundles = [];
    if (pkgText) {
      try {
        const j = JSON.parse(pkgText);
        const b = j && j.dsh && j.dsh.profile && j.dsh.profile.bundles;
        bundles = Array.isArray(b) ? b.map(String) : [];
      } catch { /* profile 的 package.json 坏了就不判断启用状态 */ }
    }
    const root = join(profileDir, 'node_modules', 'dsh-purge');
    if (!isDirectory(root)) continue;
    const meta = readPluginMeta(root);
    plugins.push({ profile: profile.name, profileDir, root, version: meta.version, enabled: bundles.includes('dsh-purge') });
  }

  const missingPaths = [
    {
      id: 'install-plugin',
      title: '路径 A：把 dsh-purge 插件装回来（工具面才真正可用）',
      steps: [
        '在 DSH 插件市场装 dsh-purge，或把 tgz 装进 $DSH_HOME/profiles/<profile>/，并把 dsh-purge 加进该 profile package.json 的 dsh.profile.bundles',
        '装完重启桌面端，再回控制台用本能力复查 redteam_* 工具面是否就位',
        '注意：插件在位且 autoApplyOnStart=true 时会和本项目抢同一批宿主补丁，装完先去插件配置里关掉自动重放',
      ],
    },
    {
      id: 'cli-payload',
      title: '路径 B：不装插件，改用本项目 CLI 载荷（工具面换成本地二进制/脚本）',
      steps: [
        'node break/break.mjs —— 目标二进制的补丁/载荷生成（PE 解析在 break/pe.mjs，纯 node: 实现，零依赖）',
        '83 条宿主补丁注入仍走本项目 web/patch-engine 引擎（node web/server.mjs → 破甲控制台）',
        'redteam_* 的资产库/计分/报告能力没有等价物：要么接受缺失，要么把 $DSH_HOME/redteam/knowledge.db 当只读事实库自行查询',
      ],
    },
  ];

  if (!plugins.length) {
    return {
      available: false,
      summary: '工具面缺失：redteam_* 未被注册（本机没找到 dsh-purge 插件）',
      plugins: [],
      paths: missingPaths,
    };
  }

  const primary = plugins.find((p) => p.enabled) || plugins[0];
  const toolsText = readTextIfExists(join(primary.root, 'lib', 'redteam', 'tools.js')) || '';
  const names = new Set();
  const re = /name:\s*['"](redteam_[a-z0-9_]+)['"]/g;
  let m;
  while ((m = re.exec(toolsText)) !== null) names.add(m[1]);
  const skillFiles = safeReaddir(join(primary.root, 'skills', 'redteam')).filter((e) => e.isFile() && e.name.endsWith('.md'));
  const versionText = primary.version || '?';
  const profileNote = primary.enabled ? '' : '（未在本 profile 启用）';

  return {
    available: names.size > 0,
    summary: names.size > 0
      ? '工具面在位：' + names.size + ' 个 redteam_*（dsh-purge ' + versionText + ' · profile ' + primary.profile + profileNote + '）'
      : '工具面缺失：dsh-purge 插件目录在，但 lib/redteam/tools.js 读不到工具定义',
    version: primary.version,
    profile: primary.profile,
    enabled: primary.enabled,
    toolCount: names.size,
    expectedToolCount: EXPECTED_TOOL_COUNT,
    toolCountNote: names.size === EXPECTED_TOOL_COUNT ? '' : '实测 ' + names.size + ' 个（任务书标称 ' + EXPECTED_TOOL_COUNT + '，以插件源码为准）',
    toolNames: [...names].sort(),
    pluginSkillCount: skillFiles.length,
    plugins,
    paths: names.size > 0 ? [] : missingPaths,
  };
}

/** 上游自己的平铺副本：$DSH_HOME/redteam/skills。只读报告，不写（那是插件的领地）。 */
export function upstreamFlatSkills(ctx) {
  const dir = join(ctx.dshHome || '', 'redteam', 'skills');
  const files = safeReaddir(dir).filter((e) => e.isFile() && e.name.endsWith('.md'));
  return { dir, count: files.length };
}

// ───────────────────────────── 冲突提示 ─────────────────────────────

/**
 * 冲突：dsh-purge 插件若开着 autoApplyOnStart，每次宿主启动都会重放它那套补丁，
 * 和本项目的 83 条补丁抢同一批宿主文件——表现是"注入完重启就变回原样"。
 * 判断口径：有效配置 = profile 的 cordis.patch.yml 覆盖 > 插件自带 cordis.patch.yml 默认。
 */
export function conflictWarning(ctx) {
  const hosting = toolHosting(ctx);
  if (!hosting.plugins || !hosting.plugins.length) return null;
  const details = [];
  let autoApply = false;
  let source = '';
  for (const p of hosting.plugins) {
    const bundlePatch = readTextIfExists(join(p.root, 'cordis.patch.yml')) || '';
    const profilePatch = readTextIfExists(join(p.profileDir, 'cordis.patch.yml')) || '';
    // 只认 dsh-purge 自己那一段：先定位 id: dsh-purge，再在其后 3KB 内找 autoApplyOnStart。
    // 为什么不全文 grep：别的插件的 patch 里也可能出现同名键，误判会给出假警报。
    const pick = (text) => {
      const at = text.indexOf('id: dsh-purge');
      if (at < 0) return null;
      const seg = text.slice(at, at + 3000);
      const hit = seg.match(/autoApplyOnStart:\s*(true|false|yes|no|on|off|1|0)\b/i);
      return hit ? /^(true|yes|on|1)$/i.test(hit[1]) : null;
    };
    const fromProfile = pick(profilePatch);
    const fromBundle = pick(bundlePatch);
    const effective = fromProfile != null ? fromProfile : (fromBundle != null ? fromBundle : false);
    const from = fromProfile != null ? 'profile/patch' : (fromBundle != null ? 'plugin/patch' : 'default(false)');
    details.push({ profile: p.profile, autoApplyOnStart: effective, from });
    if (effective) {
      autoApply = true;
      if (!source) source = p.profile + ':' + from;
    }
  }
  if (!autoApply) {
    return {
      level: 'info',
      code: 'no-auto-apply',
      text: 'dsh-purge 在位但 autoApplyOnStart=false：宿主启动时不会重放补丁，与本项目不抢文件。',
      detail: details,
    };
  }
  return {
    level: 'warn',
    code: 'auto-apply-conflict',
    text: 'dsh-purge 插件 autoApplyOnStart=true（' + source + '）：宿主每次启动都会重放它那套补丁，会覆盖本项目注入结果。装本项目补丁前先把该开关关掉。',
    detail: details,
  };
}

// ───────────────────────────── status ─────────────────────────────

function pct(a, b) {
  return b ? Math.round((a / b) * 100) : 0;
}

export async function status(ctx) {
  const started = Date.now();
  try {
    const src = resolveSource(ctx);
    const hosting = toolHosting(ctx);
    const warning = conflictWarning(ctx);
    const flat = upstreamFlatSkills(ctx);
    const target = roleTarget(ctx);

    if (!src) {
      return {
        ok: true,
        available: false,
        summary: '找不到 redteam 技能源：本机没有 dsh-purge 插件，也没有开发仓参考副本（可用 DSH_PURGE_SRC 指定）',
        detail: {
          source: null,
          candidates: sourceCandidates(ctx).map((c) => ({ root: c.root, origin: c.origin, exists: isDirectory(c.root) })),
          toolHosting: hosting,
          warning,
        },
        warning,
      };
    }

    const sourceSkills = readSourceSkills(src);
    const installed = scanInstalledSkills(ctx);
    const skillsTargetDir = skillsTarget(ctx);
    const ledger = readState(ctx);
    // 状态四分法：
    //   ok        内容与源一致
    //   stale     我们上次写的，但源更新了（该被 install 覆盖）
    //   modified  盘上内容既不是源的、也不是我们上次写的（用户改过，默认不动）
    //   missing   没装
    // 只有带上台账才分得清后两者，否则"源升级"和"用户手改"在 sha 上长得一模一样。
    const skillItems = sourceSkills.map((s) => {
      const found = installed.get(s.id);
      const wantPath = join(skillsTargetDir, s.id, 'SKILL.md');
      const ledgerSha = ledger.skills[s.id] ? ledger.skills[s.id].sha : null;
      let state = 'missing';
      if (found) {
        if (found.sha === s.sha && resolve(found.path) === resolve(wantPath)) state = 'ok';
        else if (found.sha === s.sha) state = 'elsewhere';
        else if (ledgerSha && ledgerSha === found.sha) state = 'stale';
        else state = 'modified';
      }
      return {
        id: s.id,
        state,
        path: found ? found.path : wantPath,
        kind: found ? found.kind : 'bundle',
        sha: found ? found.sha : null,
        expectedSha: s.sha,
        ledgerSha,
        bytes: s.bytes,
        parseOk: s.ok,
        parseError: s.error,
      };
    });
    const skillCount = {
      source: sourceSkills.length,
      ok: skillItems.filter((i) => i.state === 'ok').length,
      elsewhere: skillItems.filter((i) => i.state === 'elsewhere').length,
      stale: skillItems.filter((i) => i.state === 'stale').length,
      modified: skillItems.filter((i) => i.state === 'modified').length,
      missing: skillItems.filter((i) => i.state === 'missing').length,
      invalid: sourceSkills.filter((s) => !s.ok).length,
    };

    const sourceRoles = readSourceRoles(src);
    const installedRoles = scanInstalledRoles(ctx).found;
    const roleItems = sourceRoles.map((r) => {
      const found = installedRoles.get(r.name);
      const ledgerSha = ledger.roles[r.name] ? ledger.roles[r.name].sha : null;
      let state = 'missing';
      if (found) {
        if (found.sha === r.sha) state = 'ok';
        else if (ledgerSha && ledgerSha === found.sha) state = 'stale';
        else state = 'customized';
      }
      return {
        name: r.name,
        state,
        path: found ? found.path : join(target.dir, r.name),
        sha: found ? found.sha : null,
        expectedSha: r.sha,
        ledgerSha,
        bytes: r.bytes,
      };
    });
    const roleCount = {
      source: sourceRoles.length,
      ok: roleItems.filter((i) => i.state === 'ok').length,
      stale: roleItems.filter((i) => i.state === 'stale').length,
      customized: roleItems.filter((i) => i.state === 'customized').length,
      missing: roleItems.filter((i) => i.state === 'missing').length,
    };

    // 摘要只写用户真正关心的四件事：技能、角色、工具面、冲突。
    const parts = [];
    parts.push('技能 ' + skillCount.ok + '/' + skillCount.source + ' 已装'
      + (skillCount.stale ? '（' + skillCount.stale + ' 过期）' : '')
      + (skillCount.modified ? '（' + skillCount.modified + ' 本地已改）' : '')
      + (skillCount.missing ? '（缺 ' + skillCount.missing + '）' : ''));
    parts.push('角色 ' + roleCount.ok + '/' + roleCount.source + ' 一致'
      + (roleCount.stale ? '（' + roleCount.stale + ' 过期）' : '')
      + (roleCount.customized ? '（本地已改 ' + roleCount.customized + '）' : '')
      + (roleCount.missing ? '（缺 ' + roleCount.missing + '）' : ''));
    parts.push(hosting.available ? '工具面 ' + hosting.toolCount + ' 个在册' : '工具面缺失');
    if (!target.wired) parts.push('角色目录未接入 DSH');
    if (warning && warning.level === 'warn') parts.push('⚠ 自动重放冲突');
    const summary = parts.join(' · ');

    return {
      ok: true,
      available: true,
      summary,
      detail: {
        source: {
          root: src.root,
          origin: src.origin,
          version: src.version,
          skillsDir: src.skillsDir,
          rolesDir: src.rolesDir,
          candidates: sourceCandidates(ctx).map((c) => ({ root: c.root, origin: c.origin, exists: isDirectory(c.root) })),
        },
        skills: {
          ...skillCount,
          targetDir: skillsTargetDir,
          percent: pct(skillCount.ok, skillCount.source),
          items: skillItems,
        },
        roles: {
          ...roleCount,
          targetDir: target.dir,
          mech: target.mech,
          wired: target.wired,
          note: target.note,
          items: roleItems,
        },
        toolHosting: hosting,
        upstreamFlat: flat,
        warning,
        spec: { expectedSkills: EXPECTED_SKILL_COUNT, expectedRoles: EXPECTED_ROLE_FILE_COUNT, expectedTools: EXPECTED_TOOL_COUNT },
        elapsedMs: Date.now() - started,
      },
      warning,
    };
  } catch (e) {
    return {
      ok: false,
      available: false,
      summary: '状态读取失败：' + String((e && e.message) || e),
      detail: { error: String((e && e.message) || e) },
    };
  }
}

// ───────────────────────────── plan / run ─────────────────────────────

/**
 * 纯函数计划：把"要写什么、要删什么、跳过什么"全算出来，不落盘。
 * run() 与 plan() 共用它，保证 dry-run 看到的和真跑的一致——两套逻辑各写一遍必然漂移。
 */
export function collect(ctx, opts = {}) {
  const action = String(opts.action || 'install');
  const ids = Array.isArray(opts.ids) && opts.ids.length ? new Set(opts.ids.map(String)) : null;
  const force = opts.force === true;
  // reinstall 允许直接覆盖技能（技能文件是我们生成的）；角色默认不覆盖，用户可能手工改过（本机就被 gear 修过）。
  const overwriteSkills = force || action === 'reinstall';
  const overwriteRoles = force;

  const src = resolveSource(ctx);
  if (!src) return { src: null, action, ops: [], skipped: [], error: 'source-missing' };

  const sourceSkills = readSourceSkills(src).filter((s) => (ids ? ids.has(s.id) : true));
  const ledger = readState(ctx);
  const installed = scanInstalledSkills(ctx);
  const skillDir = skillsTarget(ctx);
  const target = roleTarget(ctx);
  const installedRoles = scanInstalledRoles(ctx).found;
  const sourceRoles = readSourceRoles(src);
  const ops = [];
  const skipped = [];

  for (const s of sourceSkills) {
    const found = installed.get(s.id);
    const wantPath = join(skillDir, s.id, 'SKILL.md');
    // "是不是我们写的"由台账判定：只有台账记的 sha 与盘上一致，才允许直接覆盖/删除。
    const ledgerSha = ledger.skills[s.id] ? ledger.skills[s.id].sha : null;
    const ours = !!(found && ledgerSha && ledgerSha === found.sha);
    if (action === 'uninstall') {
      if (!found) { skipped.push({ kind: 'skill', id: s.id, reason: 'not-installed' }); continue; }
      if (!ours && !force) { skipped.push({ kind: 'skill', id: s.id, reason: 'modified-by-user', path: found.path }); continue; }
      ops.push({ kind: 'skill', id: s.id, type: 'remove', path: found.path, bundleDir: found.dir, reason: ours ? 'ours' : 'force' });
      continue;
    }
    if (found && found.sha === s.sha && resolve(found.path) === resolve(wantPath)) {
      skipped.push({ kind: 'skill', id: s.id, reason: 'up-to-date' });
      continue;
    }
    const reason = !found ? 'missing' : (found.sha === s.sha ? 'relocate' : (ours ? 'stale' : 'modified'));
    if (found && found.sha !== s.sha && !ours && !overwriteSkills) {
      skipped.push({ kind: 'skill', id: s.id, reason: 'modified-by-user', path: found.path });
      continue;
    }
    ops.push({ kind: 'skill', id: s.id, type: 'write', path: wantPath, content: s.rendered, bytes: Buffer.byteLength(s.rendered), reason, sha: s.sha });
    if (found && found.kind === 'flat' && resolve(found.path) !== resolve(wantPath)) {
      // 平铺同名文件与 bundle 同时存在时 DSH 会各算一条同名 skill，装完顺手把平铺那份收掉（先备份）。
      ops.push({ kind: 'skill', id: s.id, type: 'remove', path: found.path, bundleDir: null, reason: 'superseded-flat' });
    }
  }

  for (const r of sourceRoles) {
    const found = installedRoles.get(r.name);
    const wantPath = join(target.dir, r.name);
    const ledgerSha = ledger.roles[r.name] ? ledger.roles[r.name].sha : null;
    const ours = !!(found && ledgerSha && ledgerSha === found.sha);
    if (action === 'uninstall') {
      if (!found) { skipped.push({ kind: 'role', id: r.name, reason: 'not-installed' }); continue; }
      if (!ours && !force) { skipped.push({ kind: 'role', id: r.name, reason: 'customized', path: found.path }); continue; }
      ops.push({ kind: 'role', id: r.name, type: 'remove', path: found.path, reason: ours ? 'ours' : 'force' });
      continue;
    }
    if (found && found.sha === r.sha) { skipped.push({ kind: 'role', id: r.name, reason: 'up-to-date' }); continue; }
    if (found && !ours && !overwriteRoles) {
      skipped.push({ kind: 'role', id: r.name, reason: 'customized', path: found.path });
      continue;
    }
    ops.push({ kind: 'role', id: r.name, type: 'write', path: wantPath, content: r.expected, bytes: r.bytes, reason: !found ? 'missing' : (ours ? 'stale' : 'modified'), sha: r.sha });
  }

  return { src, action, ops, skipped, skillDir, roleDir: target.dir, roleTarget: target };
}

export async function plan(ctx, opts = {}) {
  try {
    const c = collect(ctx, opts);
    if (!c.src) return { ok: false, error: '找不到技能/角色源（dsh-purge）', action: c.action };
    return {
      ok: true,
      action: c.action || 'install',
      source: { root: c.src.root, origin: c.src.origin, version: c.src.version },
      targets: { skills: c.skillDir, roles: c.roleDir, rolesWired: c.roleTarget.wired },
      counts: {
        write: c.ops.filter((o) => o.type === 'write').length,
        remove: c.ops.filter((o) => o.type === 'remove').length,
        skipped: c.skipped.length,
      },
      ops: c.ops.map((o) => ({ kind: o.kind, id: o.id, type: o.type, path: o.path, bytes: o.bytes || 0, reason: o.reason })),
      skipped: c.skipped,
    };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

/** 备份：把即将被覆盖/删除的现存文件按 $DSH_HOME 相对路径复制走，并留一份 manifest。 */
function backupExisting(ctx, ops, action) {
  const existing = ops.filter((o) => o.type === 'remove' || (o.type === 'write' && isFile(o.path)));
  if (!existing.length) return null;
  const dir = join(ctx.dataDir, BACKUP_SUBDIR, stamp() + '-' + action);
  const dshHome = resolve(ctx.dshHome || '.');
  const entries = [];
  for (const o of existing) {
    let rel;
    try {
      rel = relative(dshHome, resolve(o.path));
      if (rel.startsWith('..')) rel = join('_outside', resolve(o.path).replace(/[:\\/]/g, '_'));
    } catch {
      rel = join('_outside', resolve(o.path).replace(/[:\\/]/g, '_'));
    }
    const dest = join(dir, rel);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(o.path, dest);
    entries.push({ path: o.path, rel, kind: o.kind, id: o.id, reason: o.reason || o.type });
  }
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ at: new Date().toISOString(), dshHome, action, entries }, null, 2));
  return dir;
}

function removeOp(op, roots) {
  assertInsideAny(roots, op.path);
  if (!existsSync(op.path)) return false;
  rmSync(op.path, { force: true });
  if (op.bundleDir) {
    // 只在 bundle 里只剩空壳时删目录，别把用户放在同目录的 references/ 一起带走。
    const left = safeReaddir(op.bundleDir).filter((e) => e.name !== 'SKILL.md');
    if (!left.length) rmSync(op.bundleDir, { recursive: true, force: true });
  }
  return true;
}

export async function run(ctx, opts = {}) {
  const started = Date.now();
  try {
    const action = String(opts.action || 'install');
    if (!['install', 'uninstall', 'reinstall', 'verify'].includes(action)) {
      return { ok: false, changed: false, summary: '未知 action：' + action + '（只认 install / uninstall / reinstall / verify）', error: 'unsupported-action' };
    }
    const dryRun = opts.dryRun === true;
    const c = collect(ctx, { ...opts, action });
    if (!c.src) {
      return { ok: false, changed: false, summary: '找不到技能/角色源：本机没有 dsh-purge（插件或 DSH_PURGE_SRC 都可）', error: 'source-missing' };
    }
    const roots = [c.skillDir, c.roleDir];
    const detailBase = {
      action,
      dryRun,
      source: { root: c.src.root, origin: c.src.origin, version: c.src.version },
      targets: { skills: c.skillDir, roles: c.roleDir, rolesWired: c.roleTarget.wired, rolesMech: c.roleTarget.mech },
      planned: c.ops.map((o) => ({ kind: o.kind, id: o.id, type: o.type, path: o.path, bytes: o.bytes || 0, reason: o.reason })),
      skipped: c.skipped,
    };

    if (action === 'verify' || dryRun) {
      const verb = action === 'verify' ? '校验' : 'dry-run';
      const writeCount = c.ops.filter((o) => o.type === 'write').length;
      const removeCount = c.ops.filter((o) => o.type === 'remove').length;
      return {
        ok: true,
        changed: false,
        summary: verb + '：待写 ' + writeCount + ' 项、待删 ' + removeCount + ' 项、跳过 ' + c.skipped.length + ' 项' + (dryRun ? '（未落盘）' : ''),
        detail: detailBase,
      };
    }

    // —— 真跑 ——
    const backupDir = backupExisting(ctx, c.ops, action);
    let written = 0;
    let removed = 0;
    const failures = [];
    // 台账只记"这次真的落地成功"的条目：失败的下一轮还要重试，不能被记成已装。
    const ledger = readState(ctx);
    let ledgerDirty = false;
    for (const op of c.ops) {
      const bucket = op.kind === 'skill' ? ledger.skills : ledger.roles;
      try {
        if (op.type === 'write') {
          assertInsideAny(roots, op.path);
          atomicWriteFile(op.path, Buffer.isBuffer(op.content) ? op.content : String(op.content));
          written += 1;
          bucket[op.id] = { sha: op.sha, path: op.path, at: new Date().toISOString() };
          ledgerDirty = true;
        } else if (removeOp(op, roots)) {
          removed += 1;
          if (bucket[op.id]) { delete bucket[op.id]; ledgerDirty = true; }
        }
      } catch (e) {
        // 单条失败不拖垮整批：记下来，最后如实汇报（最大忌讳是"一半成功却报全成功"）。
        failures.push({ id: op.id, kind: op.kind, path: op.path, error: String((e && e.message) || e) });
      }
    }
    if (ledgerDirty) {
      try {
        writeState(ctx, ledger);
      } catch (e) {
        failures.push({ id: STATE_FILE, kind: 'state', path: stateFile(ctx), error: String((e && e.message) || e) });
      }
    }
    if (typeof ctx.log === 'function') {
      ctx.log('[redteam-pack] ' + action + ' written=' + written + ' removed=' + removed + ' failed=' + failures.length + (backupDir ? ' backup=' + backupDir : ''));
    }

    // 角色目录若落到 data/redteam-roles，摘要必须明说 DSH 侧未接入，不能让人以为装完就能用。
    const summaryParts = [];
    const verb = action === 'uninstall' ? '卸载' : (action === 'reinstall' ? '重装' : '安装');
    summaryParts.push(verb + '：写 ' + written + '、删 ' + removed + '、跳过 ' + c.skipped.length);
    if (!c.roleTarget.wired) summaryParts.push('角色落 ' + c.roleTarget.mech + '，DSH 侧未接入');
    if (failures.length) summaryParts.push('失败 ' + failures.length);
    if (backupDir) summaryParts.push('已备份 ' + backupDir.split(/[\\/]/).slice(-1)[0]);

    return {
      ok: failures.length === 0,
      changed: written + removed > 0,
      summary: summaryParts.join(' · '),
      detail: { ...detailBase, backupDir, stateFile: stateFile(ctx), written, removed, failures, elapsedMs: Date.now() - started },
      error: failures.length ? failures[0].error : null,
    };
  } catch (e) {
    const msg = String((e && e.message) || e);
    if (ctx && typeof ctx.log === 'function') ctx.log('[redteam-pack] run threw: ' + msg);
    return { ok: false, changed: false, summary: '执行失败：' + msg, error: msg };
  }
}
