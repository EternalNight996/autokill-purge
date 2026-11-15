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
import { fileURLToPath } from 'node:url';

const HERE_DIR = dirname(fileURLToPath(import.meta.url));

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
  const patches = (c.ALL_PATCHES || []).map((p) => {
    const tone = patchTone((st.patch_status && st.patch_status[p.id]) || 'unknown');
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
    dshPurgeRoot: root,
    surface: st.surface,
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

/** 原版面板其他几栏的现状：规则集 / 技能 / 工具库 / 出口白名单 */
export async function hostInventory() {
  const dsh = process.env.DSH_HOME || join(process.env.USERPROFILE || '', '.dsh');
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
