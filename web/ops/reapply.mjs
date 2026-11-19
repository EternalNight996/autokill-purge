// web/ops/reapply.mjs —— 启动自动重放 / 官方升级后补丁回写 / 重启时机判定（外部控制台版）。
//
// 语义来源（上游 dsh-purge 1.1.71，只取判定条件，不搬宿主钩子）：
//   lib/reapply.js          → stamp 对齐 + 逐补丁 pending 实检（patchesMatchInstallStrict 那条路）
//   lib/official-update.js  → 官方升级留下的 resources/dsh-purge-reapply-asar 标记 + 陈旧解包目录 app.dshpurge-prev*
//   lib/settle-policy.js    → applyShouldRestart / settleDelayMs / settleMayRestart / settleMayReapply
//
// 为什么必须重写而不能照抄：
//   上游是「宿主内」插件，那套「桌面面不得重启 / 不得就地抢锁」的保护挂在 Cordis effect 与 Fiber._reload 上
//   （错误码 INACTIVE_EFFECT）。外部控制台是独立 node 进程，永远不在宿主进程树里，这些保护在这里没有对象；
//   我们只保留「判定结论」（status 里展示给人看），真正动手必须显式 opts.auto。
//
// 三个布尔的意义（UI 直接读这三个，别再自己拼）：
//   needsReapply —— 补丁要重放：逐补丁实检出现 pending / 官方升级标记还在 /
//                   磁盘 dsh 版本与归档版本不一致 / 我们的戳记版本过期（官方升级后补丁即过期）
//   needsRepack  —— 要重解包：asar 还在，而且 resources/app 不完整、或归档身份与「上次解包记录」不符
//   needsHandoff —— 要落地：asar 还在（桌面壳按 app.getAppPath() 仍从 asar 读 dsh，补丁一条都不生效）
//
// 纪律：status 只读（不写盘 / 不起进程 / 不杀进程）；run 自己 catch 一切异常；dryRun 全程不落盘。
import { existsSync } from 'node:fs';
import { mkdir, open, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE_DIR = dirname(fileURLToPath(import.meta.url));
const HOST_MODULE = join(HERE_DIR, '..', 'host.mjs');
const ENGINE_FILE = join(HERE_DIR, '..', 'patch-engine', 'vendor', 'core.js');

const DEFAULT_RESOURCES_DIR = 'C:/Users/Administrator/AppData/Local/Programs/DeepSeek Harness/resources';
const DEFAULT_DESKTOP_EXE = 'C:/Users/Administrator/AppData/Local/Programs/DeepSeek Harness/DeepSeek Harness.exe';

const STAMP_NAME = 'reapply-stamp.json';
const MARKER_NAME = 'dsh-purge-reapply-asar';
const PREV_PREFIX = 'app.dshpurge-prev';
/** 归档身份比对容差：NTFS 时间戳精度不稳，1~2s 的抖动不该被当成「官方升级过」。 */
const IDENTITY_TOLERANCE_MS = 2000;
/** 与上游常量同值：官方桌面启动时 Fiber._reload 还挂着 desktop-office，4s 内动文件会抢锁。 */
const DESKTOP_SETTLE_DELAY_MS = 4000;
/** 外部控制台面：既不是上游的 desktop 也不是 web，自成一面（判定里当「非桌面宿主面」处理）。 */
const CONSOLE_SURFACE = 'console';

export const META = {
  id: 'reapply',
  zh: '启动重放 / 官方升级回写',
  en: 'Reapply & official-update heal',
  kind: 'both',
  requires: ['web/patch-engine/vendor/core.js', 'web/host.mjs', 'resources/app 或 resources/app.asar'],
  note: '安全步骤（重放补丁）默认允许；重解包与落地（挪 asar + 重启宿主）只在 opts.auto 时执行，dryRun 全程不落盘。',
};

// ---- settle 判定移植（纯布尔组合，不需要 ctx / 不需要 Cordis） -------------------
// 上游 settle-policy.js 的四个函数原样保留签名，方便和参考源码逐行对照。

/** 桌面面要等 4s 再动文件；其他面（含外部控制台）不必等。 */
export function settleDelayMs(surface) {
  return surface === 'desktop' ? DESKTOP_SETTLE_DELAY_MS : 0;
}

/** 桌面面内不许 restart（Cordis 会 INACTIVE_EFFECT）；密封包里换不掉 asar，重启也没意义。 */
export function settleMayRestart({ surface, sealed = false } = {}) {
  if (surface === 'desktop') return false;
  if (sealed) return false;
  return true;
}

/** 密封 asar 上就地 extract/swap 会和官方 Host 的 Fiber._reload 抢锁 —— 只在「桌面面 + 密封」时禁止。 */
export function settleMayReapply({ surface, sealed = false } = {}) {
  if (surface === 'desktop' && sealed) return false;
  return true;
}

/**
 * 点「应用」后要不要重启宿主。上游网页/桌面共用这一条判定：
 *   密封包多出来的只是换包 → 必须完全退出，与补丁是否标 applied 无关；
 *   提示词已写入或这次写了补丁 → 也要重启；
 * 否则不重启。冷却（settle-restart.guard）不在这里做，否则第一次没换掉 asar，第二次应用会被当成取消。
 */
export function applyShouldRestart({ complete = false, sealed = false, appliedCount = 0, promptReady = false } = {}) {
  if (sealed) return true;
  if (complete || promptReady) return true;
  return Number(appliedCount) > 0;
}

// ---- official-update.js 移植：升级标记 / 陈旧解包目录 / wsh 字面量 ----------------

/** 只有官方 harness 的 exe 才配有升级标记（别的 exe 旁边写标记是污染）。 */
function harnessExeName(exe) {
  const base = String(exe || '').split(/[\\/]/).pop().toLowerCase();
  return base === 'deepseek harness.exe' || base === 'deepseek-harness.exe';
}

/** 标记落在 resources/ 下：官方升级脚本重启后靠它知道「要回写补丁」。 */
export function upgradeMarkerPath(exe) {
  if (!harnessExeName(exe)) return '';
  const dir = String(exe).replace(/\\/g, '/').replace(/\/[^/]+$/, '');
  return dir + '/resources/' + MARKER_NAME;
}

/** Windows Script Host 无 BOM 时按系统 ANSI 读文件：整份脚本保持 ASCII，中文写成 \\uXXXX。 */
export function isWshAscii(source) {
  const text = String(source || '');
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) > 0x7f) return false;
  }
  return true;
}

export function wshLiteral(value) {
  return JSON.stringify(String(value == null ? '' : value)).replace(/[\u007f-\uffff]/g, (ch) => {
    return '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0');
  });
}

// ---- stamp 判定移植 -------------------------------------------------------------

/** 上游的 apply:1.1.71 这类「手动应用占位戳」：只认版本，不认 rev。 */
export function isApplyPlaceholder(rev) {
  const text = String(rev || '').trim();
  return text.startsWith('apply:') || text === 'applied';
}

/**
 * 戳记是否仍代表「当前这一版宿主 + 当前这份补丁清单」。
 * 上游按 git rev 前缀模糊比对（sha 可能是短 sha）；我们的 rev 是自己拼的
 * cat:<清单摘要>@<宿主版本>，两侧都由本模块生成，所以严格相等即可 —— 模糊反而会漏掉清单换代。
 */
export function stampMatches(stamp, appVersion, rev) {
  if (!stamp) return false;
  const stampVersion = String(stamp.appVersion || '');
  if (!stampVersion || stampVersion !== String(appVersion || '')) return false;
  const stampRev = String(stamp.appliedRev || '').trim();
  if (!stampRev) return false; // 空 rev = 戳记不完整，不能当作已对齐
  const current = String(rev || '').trim();
  if (!current) return true;
  if (isApplyPlaceholder(stampRev) || isApplyPlaceholder(current)) return true;
  return stampRev === current;
}

// ---- 纯判定：把「宿主实况」翻译成三个布尔 ---------------------------------------

/**
 * @param {object} facts probe() 的输出（只读事实）
 * @returns {object} 三个需要布尔 + settle 结论 + 判定依据（reasons 供 UI 解释为什么）
 */
export function decide(facts = {}) {
  const f = facts || {};
  const appVersion = String(f.appVersion || '');
  const archiveVersion = String(f.archiveVersion || '');
  const sealed = f.asarPresent === true;
  const appComplete = f.appDirComplete === true;
  const surface = String(f.surface || CONSOLE_SURFACE);

  // 官方升级后：resources/app 是旧版解开的那份，归档（asar / 让位副本）是新版 → 旧补丁全部过期
  const versionDrift = Boolean(appVersion && archiveVersion && appVersion !== archiveVersion);

  const reasons = [];
  if (Number(f.pending) > 0) reasons.push('pending:' + Number(f.pending));
  if (f.upgradeMarker === true) reasons.push('upgrade-marker');
  if (versionDrift) reasons.push('version-drift');
  if (f.stampStale === true) reasons.push('stamp-stale');

  const needsReapply = reasons.length > 0;
  // 归档还在，而目录不完整 / 归档已换过（身份对不上上次解包记录）→ 必须重解包再洗
  const needsRepack = sealed && (!appComplete || f.unpackedMatches !== true);
  const needsHandoff = sealed;

  // status 里没有「刚做完清洗」这个事实，所以 complete=false、appliedCount=0：
  // 此时 shouldRestart 只剩「密封包没落地」这一个来源 —— 正是「现在就必须重启吗」的答案。
  const shouldRestart = applyShouldRestart({ complete: false, sealed, appliedCount: 0, promptReady: false });
  const shouldReapply = needsReapply && settleMayReapply({ surface, sealed });

  return {
    needsReapply,
    needsRepack,
    needsHandoff,
    shouldRestart,
    shouldReapply,
    needsStamp: f.stamp == null || f.stampAligned !== true,
    reasons,
    versionDrift,
    sealed,
    surface,
    // 归档都没了、目录又不完整 = 谁也救不了，只能重装官方包；单独标出来免得 UI 说「点一下就好」
    blocked: !sealed && !appComplete,
    mayRestart: settleMayRestart({ surface, sealed }),
    mayReapply: settleMayReapply({ surface, sealed }),
    delayMs: settleDelayMs(surface),
  };
}

/** 计划和 run 共用这一份步骤表：dryRun 就把它原样返回，不执行。 */
export function buildSteps(facts = {}, decision = decide(facts), { auto = false } = {}) {
  const d = decision || {};
  const steps = [];
  if (d.blocked) {
    steps.push({ id: 'blocked', zh: '归档与 resources/app 都不完整：只能重装官方包', side: 'none', needsAuto: false, runnable: false });
    return steps;
  }
  if (d.needsRepack) {
    steps.push({ id: 'extract', zh: '重解包官方 asar 到 resources/app', run: 'engine.openSealedDesktopHost({ forApply: true })', side: 'host', needsAuto: true, runnable: auto });
  }
  if (d.needsReapply) {
    steps.push({ id: 'reapply', zh: '重放补丁（先落快照，再逐宿主注入）', run: "host.applyHostPatches('apply', {})", side: 'host', needsAuto: false, runnable: true });
  }
  if (d.needsHandoff) {
    steps.push({ id: 'handoff', zh: '落地：结束宿主 → app.asar 改名让位 → 重新拉起', run: 'host.finishHostHandoff({ restart })', side: 'host', needsAuto: true, needsRestart: true, runnable: auto });
  }
  if (facts && facts.upgradeMarker === true) {
    steps.push({ id: 'clear-marker', zh: '清官方升级标记 resources/' + MARKER_NAME, side: 'host', needsAuto: true, runnable: auto });
  }
  if (d.needsStamp) {
    steps.push({ id: 'stamp', zh: '写 data/' + STAMP_NAME + '（appliedRev / appVersion / asarIdentity / at）', side: 'data', needsAuto: false, runnable: true });
  }
  if (!steps.length) {
    steps.push({ id: 'noop', zh: '宿主已对齐：无需动作', side: 'none', needsAuto: false, runnable: false });
  }
  return steps;
}

// ---- 只读探测 -------------------------------------------------------------------

let enginePromise = null;
/** 引擎缺失不是硬错：status 仍能靠文件事实给出结论，只是统计不了 pending。 */
async function engine() {
  if (!enginePromise) {
    enginePromise = (async () => {
      try {
        return await import('file:///' + ENGINE_FILE.replace(/\\/g, '/'));
      } catch { return null; }
    })();
  }
  return enginePromise;
}

function normPath(p) {
  const text = String(p || '').trim();
  return text ? text.replace(/\\/g, '/') : '';
}

async function readJson(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return null; }
}

async function readJsonVersion(file) {
  const raw = await readJson(file);
  return raw && raw.version ? String(raw.version) : null;
}

async function fileIdentity(file) {
  try {
    const s = await stat(file);
    return { path: normPath(file), size: s.size, mtimeMs: Math.round(s.mtimeMs) };
  } catch { return null; }
}

/** 归档身份：只有 size + mtime 两个数（上游 unpacked-asar.json 就是这两个字段）。 */
export function sameIdentity(a, b) {
  if (!a || !b) return false;
  const sa = Number(a.size);
  const sb = Number(b.size);
  if (!Number.isFinite(sa) || !Number.isFinite(sb) || sa !== sb) return false;
  const ma = Number(a.mtimeMs == null ? b.mtimeMs : a.mtimeMs);
  const mb = Number(b.mtimeMs == null ? a.mtimeMs : b.mtimeMs);
  if (!Number.isFinite(ma) || !Number.isFinite(mb)) return false;
  return Math.abs(ma - mb) <= IDENTITY_TOLERANCE_MS;
}

/**
 * 从 asar（或它的让位副本 app.asar.dshpurge-aside）里精确读 dsh/package.json 的 version。
 * 为什么自己实现：web/host.mjs 的 asarVersion() 钉死在 app.asar 上，落地后那个路径已经不存在，
 * 而「官方升级了没」恰恰要靠让位副本的版本和 resources/app 比。只读 16 字节头 + 目标文件，不整包解压。
 */
const archiveVersionCache = new Map();
async function readArchiveDshVersion(file, identity) {
  const key = normPath(file) + '|' + (identity ? identity.size + '|' + identity.mtimeMs : '');
  if (archiveVersionCache.has(key)) return archiveVersionCache.get(key);
  let fh = null;
  let version = null;
  try {
    fh = await open(file, 'r');
    const head = Buffer.alloc(16);
    const readHead = await fh.read(head, 0, 16, 0);
    if (readHead.bytesRead < 16) return null;
    const headerSize = head.readUInt32LE(4);
    const jsonLen = head.readUInt32LE(12);
    if (!(jsonLen > 0 && jsonLen < 64 * 1024 * 1024)) return null;
    const jbuf = Buffer.alloc(jsonLen);
    await fh.read(jbuf, 0, jsonLen, 16);
    const header = JSON.parse(jbuf.toString('utf8'));
    let cur = header;
    for (const part of ['dsh', 'package.json']) cur = cur && cur.files ? cur.files[part] : null;
    if (!cur || typeof cur.size !== 'number') return null;
    const buf = Buffer.alloc(cur.size);
    if (cur.size) await fh.read(buf, 0, cur.size, 8 + headerSize + Number(cur.offset));
    version = JSON.parse(buf.toString('utf8')).version || null;
  } catch {
    version = null;
  } finally {
    if (fh) { try { await fh.close(); } catch { /* 关闭失败不影响结论 */ } }
  }
  archiveVersionCache.set(key, version);
  return version;
}

function uniquePaths(list) {
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const raw = String(item || '').trim();
    if (!raw) continue;
    const key = normPath(raw).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(raw);
  }
  return out;
}

function countStates(statusMap) {
  const counts = { total: 0, applied: 0, pending: 0, skipped: 0, na: 0, unmatched: 0, missing: 0, other: 0 };
  for (const state of Object.values(statusMap || {})) {
    counts.total += 1;
    const s = String(state || '').toLowerCase();
    if (s === 'applied' || s === 'already') counts.applied += 1;
    else if (s === 'pending') counts.pending += 1;
    else if (s === 'skipped') counts.skipped += 1;
    else if (s === 'na') counts.na += 1;
    else if (s === 'unmatched') counts.unmatched += 1;
    else if (s === 'missing_file') counts.missing += 1;
    else counts.other += 1;
  }
  return counts;
}

/** 我们自己的 rev：补丁清单摘要 + 宿主版本。清单换代或官方升级都会让它变 → 戳记自然失效。 */
async function currentAppliedRev(appVersion) {
  let digest = '';
  try {
    const host = await import('file:///' + HOST_MODULE.replace(/\\/g, '/'));
    const catalog = await host.patchCatalog();
    if (catalog && catalog.ok) digest = String(catalog.digest || '');
  } catch { digest = ''; }
  const short = digest ? digest.slice(0, 12) : 'nocatalog';
  return 'cat:' + short + '@' + (appVersion || 'unknown');
}

/**
 * 宿主实况。只读：existsSync / readFile / stat / readdir + 引擎 patchStatus（它只读文本）。
 * @returns {object} facts
 */
export async function probe(ctx = {}) {
  const resourcesDir = normPath(ctx.resourcesDir) || DEFAULT_RESOURCES_DIR;
  const appDir = normPath(ctx.appDir) || join(resourcesDir, 'app');
  const asarPath = normPath(ctx.asarPath) || join(resourcesDir, 'app.asar');
  const asidePath = normPath(ctx.asidePath) || asarPath + '.dshpurge-aside';
  const desktopExe = normPath(ctx.desktopExe) || DEFAULT_DESKTOP_EXE;
  const dataDir = normPath(ctx.dataDir) || join(HERE_DIR, '..', '..', 'data');

  const appDirExists = existsSync(appDir);
  const appVersion = await readJsonVersion(join(appDir, 'dsh', 'package.json'));
  const appDirComplete = Boolean(appVersion);

  const asarPresent = existsSync(asarPath);
  const asarIdentity = asarPresent ? await fileIdentity(asarPath) : null;
  const asideIdentity = await fileIdentity(asidePath);
  // 归档 = 官方原件：asar 在位时就是它，让位了就去看旁边那份 —— 两处都是同一个官方包。
  const archiveIdentity = asarPresent ? asarIdentity : asideIdentity;
  const archiveSource = asarPresent ? asarPath : (asideIdentity ? asidePath : null);
  const archiveVersion = archiveSource ? await readArchiveDshVersion(archiveSource, archiveIdentity) : null;

  const core = await engine();
  const engineReady = Boolean(core);
  const hosts = [];
  if (core) {
    // 桌面 resources/app 那份才「会被加载」，必须排第一；npm-global / profile 副本只是陪跑。
    const desktopBase = uniquePaths([
      join(appDir, 'dsh', 'node_modules', '@deepseek-ai'),
      join(appDir, 'node_modules', '@deepseek-ai'),
    ]).find((p) => existsSync(p)) || null;
    let discovered = [];
    try { discovered = core.enumeratePatchAiBases({ discover: true }) || []; } catch { discovered = []; }
    const bases = uniquePaths([desktopBase, ...discovered]).filter((p) => existsSync(p));
    for (const base of bases) {
      let map = {};
      try { map = (await core.patchStatus(base)) || {}; } catch { map = {}; }
      const counts = countStates(map);
      let hostWritten = false;
      try { hostWritten = core.hostCleanMarkersPresent(base) === true; } catch { hostWritten = false; }
      hosts.push({
        aiBase: base,
        kind: desktopBase && normPath(base).toLowerCase() === normPath(desktopBase).toLowerCase() ? 'desktop' : 'package',
        total: counts.total,
        applied: counts.applied,
        pending: counts.pending,
        skipped: counts.skipped,
        na: counts.na,
        unmatched: counts.unmatched,
        missing: counts.missing,
        hostWritten,
      });
    }
  }
  const primary = hosts.find((h) => h.kind === 'desktop') || hosts[0] || null;
  const pending = hosts.reduce((n, h) => n + h.pending, 0);
  const applied = primary ? primary.applied : 0;
  const total = primary ? primary.total : 0;

  let unpackedStamp = null;
  try { unpackedStamp = core && typeof core.readUnpackedAsarStamp === 'function' ? core.readUnpackedAsarStamp() : null; } catch { unpackedStamp = null; }
  const unpackedMatches = sameIdentity(archiveIdentity, unpackedStamp);

  const markerFromExe = upgradeMarkerPath(desktopExe);
  const markerPath = markerFromExe || join(resourcesDir, MARKER_NAME);
  let upgradeMarker = false;
  try { upgradeMarker = existsSync(markerPath); } catch { upgradeMarker = false; }

  let stalePrevDirs = [];
  try {
    stalePrevDirs = (await readdir(resourcesDir)).filter((name) => name.startsWith(PREV_PREFIX));
  } catch { stalePrevDirs = []; }

  const stamp = await readJson(join(dataDir, STAMP_NAME));
  const rev = await currentAppliedRev(appVersion);
  const stampAligned = stampMatches(stamp, appVersion || '', rev);
  // 戳记版本和当前磁盘 dsh 不一致 = 官方升级过，旧补丁过期（戳记缺失不算过期，由 needsStamp 表达）
  const stampStale = Boolean(stamp && appVersion && String(stamp.appVersion || '') !== String(appVersion));

  return {
    at: new Date().toISOString(),
    surface: CONSOLE_SURFACE,
    resourcesDir,
    appDir,
    asarPath,
    asidePath,
    desktopExe,
    dataDir,
    stampPath: join(dataDir, STAMP_NAME),
    markerPath,
    appDirExists,
    appDirComplete,
    appVersion,
    asarPresent,
    asidePresent: Boolean(asideIdentity),
    asarIdentity,
    asideIdentity,
    archiveIdentity,
    archiveSource,
    archiveVersion,
    unpackedStamp,
    unpackedMatches,
    engineReady,
    hosts,
    primaryHost: primary,
    pending,
    applied,
    total,
    stamp,
    stampAligned,
    stampStale,
    rev,
    upgradeMarker,
    stalePrevDirs,
  };
}

function brief(facts) {
  return {
    appVersion: facts.appVersion,
    archiveVersion: facts.archiveVersion,
    archiveSource: facts.archiveSource,
    asarPresent: facts.asarPresent,
    asidePresent: facts.asidePresent,
    appDirComplete: facts.appDirComplete,
    unpackedMatches: facts.unpackedMatches,
    pending: facts.pending,
    applied: facts.applied,
    total: facts.total,
    upgradeMarker: facts.upgradeMarker,
    stampAligned: facts.stampAligned,
    rev: facts.rev,
  };
}

function summaryOf(facts, decision) {
  const parts = [];
  const host = '宿主 v' + (facts.appVersion || '?');
  parts.push(host + (facts.asarPresent ? '（asar 仍在：未落地）' : '（asar 已让位：resources/app 生效）'));
  if (facts.archiveVersion && facts.appVersion && facts.archiveVersion !== facts.appVersion) {
    parts.push('归档 v' + facts.archiveVersion + ' ≠ 磁盘 v' + facts.appVersion + '（官方升级过，补丁过期）');
  }
  if (facts.total) parts.push(facts.total + ' 条补丁：' + facts.applied + ' 已注入 / ' + facts.pending + ' 待注入');
  else parts.push('引擎不可用：只做文件级判定，统计不了逐补丁状态');
  const todo = [];
  if (decision.needsRepack) todo.push('重解包');
  if (decision.needsReapply) todo.push('重放补丁');
  if (decision.needsHandoff) todo.push('落地（挪 asar）');
  if (decision.blocked) todo.push('需要重装官方包');
  parts.push(todo.length ? '待办：' + todo.join(' → ') : '无需动作');
  if (decision.reasons.length) parts.push('依据：' + decision.reasons.join(','));
  return parts.join('；');
}

function needsOf(decision) {
  const d = decision || {};
  return {
    needsReapply: d.needsReapply === true,
    needsRepack: d.needsRepack === true,
    needsHandoff: d.needsHandoff === true,
    shouldRestart: d.shouldRestart === true,
    shouldReapply: d.shouldReapply === true,
    blocked: d.blocked === true,
    reasons: d.reasons || [],
  };
}

// ---- status（只读） -------------------------------------------------------------

export async function status(ctx = {}) {
  try {
    const facts = await probe(ctx);
    const decision = decide(facts);
    const available = Boolean(facts.engineReady && (facts.appDirExists || facts.asarPresent || facts.asidePresent));
    return {
      ok: true,
      available,
      summary: summaryOf(facts, decision),
      detail: {
        needsReapply: decision.needsReapply,
        needsRepack: decision.needsRepack,
        needsHandoff: decision.needsHandoff,
        shouldRestart: decision.shouldRestart,
        shouldReapply: decision.shouldReapply,
        needsStamp: decision.needsStamp,
        blocked: decision.blocked,
        reasons: decision.reasons,
        versionDrift: decision.versionDrift,
        settle: {
          surface: decision.surface,
          delayMs: decision.delayMs,
          desktopDelayMs: settleDelayMs('desktop'),
          mayRestart: decision.mayRestart,
          mayReapply: decision.mayReapply,
          shouldRestart: decision.shouldRestart,
          shouldReapply: decision.shouldReapply,
        },
        paths: {
          resourcesDir: facts.resourcesDir,
          appDir: facts.appDir,
          asarPath: facts.asarPath,
          asidePath: facts.asidePath,
          desktopExe: facts.desktopExe,
          stampPath: facts.stampPath,
        },
        facts: brief(facts),
        hosts: facts.hosts,
        unpackedStamp: facts.unpackedStamp,
        upgradeMarker: facts.upgradeMarker,
        markerPath: facts.markerPath,
        stalePrevDirs: facts.stalePrevDirs,
        stamp: facts.stamp,
        stampAligned: facts.stampAligned,
        rev: facts.rev,
      },
    };
  } catch (e) {
    // 注册表首屏会并行调所有 status：这里抛裸异常等于把整行拖成红字，宁可降级成 available:false。
    return { ok: false, available: false, summary: '宿主状态读取失败：' + msgOf(e), detail: { error: msgOf(e) } };
  }
}

// ---- plan（只读计划） -----------------------------------------------------------

export async function plan(ctx = {}, opts = {}) {
  const facts = await probe(ctx);
  const decision = decide(facts);
  return buildSteps(facts, decision, { auto: opts.auto === true });
}

// ---- run -----------------------------------------------------------------------

function msgOf(e) {
  return String((e && e.message) || e);
}

/** 引擎的按面判定要 DSH_SURFACE=desktop 才会解开/换包（裸 node 进程会被判成 web）。 */
async function withDesktopSurface(fn) {
  const prev = process.env.DSH_SURFACE;
  process.env.DSH_SURFACE = 'desktop';
  try { return await fn(); } finally {
    if (prev === undefined) delete process.env.DSH_SURFACE;
    else process.env.DSH_SURFACE = prev;
  }
}

/** 戳记签名：at 每次都变，参与比较就永远「有变化」，幂等性也就没了，所以单独排除它。 */
function stampSignature(stamp) {
  if (!stamp) return '';
  const ident = stamp.asarIdentity || {};
  return JSON.stringify({
    appliedRev: String(stamp.appliedRev || ''),
    appVersion: String(stamp.appVersion || ''),
    size: Number(ident.size),
    mtimeMs: Number(ident.mtimeMs),
    pending: Number(stamp.pending),
    complete: stamp.complete === true,
  });
}

async function writeStamp(stampPath, payload) {
  const prev = await readJson(stampPath);
  if (stampSignature(prev) && stampSignature(prev) === stampSignature(payload)) return false;
  await mkdir(dirname(stampPath), { recursive: true });
  await writeFile(stampPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  return true;
}

async function clearUpgradeMarker(markerPath) {
  try { await rm(markerPath, { force: true }); return true; } catch { return false; }
}

/** 官方升级后，上一版解出来的 resources/app.dshpurge-prev* 已经没用了（连回滚都救不回来）。 */
async function cleanStalePrev(resourcesDir) {
  const removed = [];
  let names = [];
  try { names = await readdir(resourcesDir); } catch { return removed; }
  for (const name of names) {
    if (!name.startsWith(PREV_PREFIX)) continue;
    try { await rm(join(resourcesDir, name), { recursive: true, force: true }); removed.push(name); } catch { /* 删不掉就留着，下次再说 */ }
  }
  return removed;
}

/**
 * 重放 / 回写宿主补丁。
 *
 * opts:
 *   dryRun    —— 只预览计划，不落盘、不起进程、不杀进程（测试只走这条）
 *   auto      —— 额外允许「重解包」与「落地（挪 asar + 重启宿主）」
 *   stampOnly —— 只补戳（上游 healEmptyAppliedStamp 的等价物），不碰宿主
 *   restart   —— 落地后是否重新拉起宿主，默认 true（仅 auto 生效）
 *   cleanPrev —— 真解包过之后是否清 app.dshpurge-prev*，默认 true（仅 auto 生效）
 */
export async function run(ctx = {}, opts = {}) {
  const dryRun = opts.dryRun === true || opts.preview === true;
  const auto = opts.auto === true;
  const stampOnly = opts.stampOnly === true;
  const log = typeof ctx.log === 'function' ? ctx.log : () => {};
  const detail = { dryRun, auto, stampOnly, steps: [], performed: [] };

  try {
    const before = await probe(ctx);
    const d0 = decide(before);
    const steps = buildSteps(before, d0, { auto });
    detail.steps = steps;
    detail.before = brief(before);

    if (dryRun) {
      const todo = !d0.blocked && (d0.needsRepack || d0.needsReapply || d0.needsHandoff || d0.needsStamp);
      return {
        ok: true,
        changed: false,
        summary: 'dryRun 预览（未落盘）：' + (todo ? steps.map((s) => s.id).join(' → ') : '宿主已对齐，无动作'),
        detail: { ...detail, needs: needsOf(d0) },
      };
    }

    const failures = [];
    let changed = false;
    let snapshot = null;
    let applyResult = null;
    let opened = null;
    let handoffResult = null;
    const removedPrev = [];
    let markerCleared = false;

    if (!stampOnly) {
      // 1) 重解包（仅 auto）：官方换过 asar 或目录不完整时必须先解开，否则 apply 会写到残目录里
      if (auto && d0.needsRepack) {
        const core = await engine();
        if (!core || typeof core.openSealedDesktopHost !== 'function') {
          return {
            ok: false,
            changed: false,
            summary: '重解包失败：引擎不可用（缺 openSealedDesktopHost）',
            error: 'engine_unavailable',
            detail,
          };
        }
        try {
          opened = await withDesktopSurface(() => core.openSealedDesktopHost({ forApply: true }));
          detail.performed.push({ step: 'extract', aiBase: opened.aiBase || null, extracted: opened.extracted === true, prev: opened.prev || '' });
          log('[reapply] 重解包完成 extracted=' + (opened.extracted === true) + ' aiBase=' + String(opened.aiBase || ''));
        } catch (e) {
          return {
            ok: false,
            changed: false,
            summary: '重解包失败：' + msgOf(e) + '（宿主未被改动）',
            error: msgOf(e),
            detail: { ...detail, needs: needsOf(d0) },
          };
        }
      }

      // 2) 重放补丁：唯一「默认允许」的宿主动作。改宿主前必须落快照，快照失败就整条中止。
      if (d0.needsReapply) {
        if (typeof ctx.snapshot === 'function') {
          try {
            snapshot = await ctx.snapshot('reapply');
          } catch (e) {
            return {
              ok: false,
              changed: false,
              summary: '快照失败，已中止重放（宿主未被改动）：' + msgOf(e),
              error: 'snapshot_failed: ' + msgOf(e),
              detail: { ...detail, needs: needsOf(d0) },
            };
          }
        } else {
          snapshot = { skipped: 'ctx.snapshot 缺失' };
        }
        const host = await import('file:///' + HOST_MODULE.replace(/\\/g, '/'));
        applyResult = await host.applyHostPatches('apply', {});
        changed = true;
        detail.performed.push({
          step: 'reapply',
          applied: applyResult.applied || 0,
          already: applyResult.already || 0,
          hosts: applyResult.hosts || [],
          applyError: applyResult.applyError || null,
        });
        if (applyResult.applyError) failures.push('apply: ' + applyResult.applyError);
        log('[reapply] apply → applied=' + (applyResult.applied || 0) + ' already=' + (applyResult.already || 0));
      }

      if (auto) {
        // 3) 落地前再实检一次：补丁没真进去就换包 = 换上一份半成品，宁可停在「待落地」
        const mid = await probe(ctx);
        if (mid.pending > 0) {
          failures.push('落地前仍有 ' + mid.pending + ' 条 pending，已跳过落地');
        } else if (mid.asarPresent) {
          const restart = opts.restart !== false;
          try {
            const host = await import('file:///' + HOST_MODULE.replace(/\\/g, '/'));
            handoffResult = await host.finishHostHandoff({ restart });
            changed = true;
            detail.performed.push({ step: 'handoff', ok: handoffResult.ok !== false, aside: handoffResult.aside || '', restarting: handoffResult.restarting === true, error: handoffResult.error || null });
            if (handoffResult.ok === false) failures.push('handoff: ' + (handoffResult.error || '未落地'));
            log('[reapply] handoff → ok=' + (handoffResult.ok !== false) + ' restart=' + restart);
          } catch (e) {
            failures.push('handoff: ' + msgOf(e));
          }
        }
        // 4) 官方升级标记与陈旧解包目录：只有真解包过才清 prev，否则会把可回滚的上一份删掉
        if (d0.upgradeMarker) {
          markerCleared = await clearUpgradeMarker(before.markerPath);
          if (markerCleared) changed = true;
        }
        if (opened && opened.extracted === true && opts.cleanPrev !== false) {
          removedPrev.push(...await cleanStalePrev(before.resourcesDir));
          if (removedPrev.length) changed = true;
        }
      }
    }

    // 5) 写戳：appliedRev / appVersion / asarIdentity / at（幂等：签名没变就不重写 at）
    const after = await probe(ctx);
    const d1 = decide(after);
    if (after.pending > 0) failures.push('仍有 ' + after.pending + ' 条 pending');
    const payload = {
      appliedRev: after.rev,
      appVersion: after.appVersion || '',
      asarIdentity: after.archiveIdentity
        ? { path: after.archiveIdentity.path, size: after.archiveIdentity.size, mtimeMs: after.archiveIdentity.mtimeMs }
        : null,
      at: new Date().toISOString(),
      pending: after.pending,
      alreadyApplied: after.applied,
      complete: after.pending === 0,
      needsReapply: d1.needsReapply,
      needsRepack: d1.needsRepack,
      needsHandoff: d1.needsHandoff,
      hostVersionDrift: d1.versionDrift,
      scope: stampOnly ? 'stamp-only' : (auto ? 'auto' : 'safe'),
    };
    const stampWrote = await writeStamp(after.stampPath, payload);
    if (stampWrote) changed = true;

    const ok = failures.length === 0;
    detail.after = brief(after);
    detail.stamp = { path: after.stampPath, wrote: stampWrote, payload };
    detail.snapshot = snapshot;
    detail.removedPrev = removedPrev;
    detail.markerCleared = markerCleared;
    detail.needs = needsOf(d1);

    const doneNotes = [];
    if (applyResult) doneNotes.push('重放 ' + (applyResult.applied || 0) + ' 条（已对齐 ' + (applyResult.already || 0) + ' 条）');
    if (handoffResult && handoffResult.ok !== false) doneNotes.push('asar 已让位' + (handoffResult.restarting ? '并已重新拉起宿主' : '（未重启）'));
    if (stampWrote) doneNotes.push('戳记已更新');
    if (!doneNotes.length) doneNotes.push('宿主已对齐，无写入');

    return {
      ok,
      changed,
      summary: (ok ? '重放完成：' : '重放未完成：') + doneNotes.join('；') + '。'
        + (failures.length ? '失败项：' + failures.join(' / ') + '。' : '')
        + summaryOf(after, d1),
      detail,
      ...(ok ? {} : { error: failures.join(' / ') }),
    };
  } catch (e) {
    // 契约要求：绝不把裸异常抛给路由
    try { log('[reapply] threw: ' + msgOf(e)); } catch { /* ignore */ }
    return { ok: false, changed: false, summary: '重放失败：' + msgOf(e), error: msgOf(e), detail };
  }
}
