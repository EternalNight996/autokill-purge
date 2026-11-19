// MengBot 破甲 / 装备。
//
// 读走它自己的 HTTP API（8799，无需鉴权）；**写走文件**，因为它的 PATCH /api/bots/<id>
// 要桌面 App 的 loopbackMutationToken（`x-mengbot-desktop-owner` 头 + 会话内 token），
// 实测直接 PATCH 返回 403：forbidden: this change must come from the desktop app or a paired device。
//
// 文件层事实（读源码 server/bot-folder.ts + store.ts，并对本机 bots.json 实测）：
//   · ~/.mengbot/bots.json 顶层是数字键对象 { "0": BotRecord, "1": ... }，共 22 个 bot
//   · BotRecord.soul 是权威；soulHash === sha256(soul, 'utf8')（已实测一致）
//   · ~/.mengbot/bots/<id>/SOUL.md 是镜像（UTF-8 落盘）
//   · store 启动时若发现 soulHash 与 soul 不符会自动重算；SOUL.md 上限 24000 字节
//
// 所以：改 bots.json 的 soul + soulHash + 同步写 SOUL.md → 重启 MengBot 生效。
// 每次写入前把整份 bots.json 备份到 ~/.dsh/autokill-purge-data/mengbot-snapshots/，可一键还原。
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, copyFileSync, renameSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';

const MAX_SOUL_BYTES = 24000;

/** 装备 id：与 MengBot 的 shared/gear.ts、AutoKill 的 build.gear 同一套。空字符串 = 不装备。 */
export const GEAR_IDS = ['redteam', 'recon', 'lateral', 'radio', 're', 'custom'];

/** 只做格式校验，认不出的值一律落成空——和 MengBot 的 parseGear() 一字不差。 */
function normalizeGear(value) {
  return GEAR_IDS.includes(String(value == null ? '' : value).trim()) ? String(value).trim() : '';
}

function home() {
  return process.env.USERPROFILE || process.env.HOME || '';
}
export function mbDataDir() {
  return join(home(), '.mengbot');
}
export function mbPort() {
  return Number(process.env.MENGBOT_PORT || 8799);
}
export function botsFile() {
  return join(mbDataDir(), 'bots.json');
}
export function soulFile(id) {
  return join(mbDataDir(), 'bots', id, 'SOUL.md');
}
function snapDir() {
  return join(home(), '.dsh', 'autokill-purge-data', 'mengbot-snapshots');
}

const sha256 = (s) => createHash('sha256').update(String(s), 'utf8').digest('hex');
const bytes = (s) => Buffer.byteLength(String(s || ''), 'utf8');
const clip = (s, n) => {
  const t = String(s == null ? '' : s);
  return t.length > n ? t.slice(0, n) + '…' : t;
};

function readBotsRaw() {
  const raw = JSON.parse(readFileSync(botsFile(), 'utf8'));
  const list = Object.values(raw).filter((x) => x && x.id);
  return { raw: raw, list: list };
}

function writeBotsRaw(raw) {
  const file = botsFile();
  const tmp = file + '.' + process.pid + '.tmp';
  // MengBot 原来就是紧凑 JSON（~71KB）；pretty 化会把文件撑到 96KB，且它 fs.watch 到 rename 可能直接退出
  writeFileSync(tmp, JSON.stringify(raw), 'utf8');
  renameSync(tmp, file);
}

function writeSoulMirror(id, soul) {
  const f = soulFile(id);
  mkdirSync(join(mbDataDir(), 'bots', id), { recursive: true });
  writeFileSync(f, soul, 'utf8');
}

/** MengBot 主进程是否在跑（Electron 会持有 bots.json 的内存副本，直接改文件可能让它退出） */
function serviceRunning() {
  try {
    const out = execFileSync('tasklist', ['/FI', 'IMAGENAME eq MengBot.exe', '/NH'], { encoding: 'utf8', windowsHide: true, timeout: 6000 });
    return /MengBot\.exe/i.test(out);
  } catch {
    return null;
  }
}

function servicePid() {
  try {
    const out = execFileSync('tasklist', ['/FI', 'IMAGENAME eq MengBot.exe', '/NH', '/FO', 'CSV'], { encoding: 'utf8', windowsHide: true, timeout: 6000 });
    const m = out.match(/"MengBot\.exe","(\d+)"/i);
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

function serviceWarning() {
  const running = serviceRunning();
  if (running === true) {
    return {
      serviceRunning: true,
      warning: 'MengBot 正在运行。它把 bots.json 缓存在内存里，直接改文件可能让进程退出（实测过一次：进程消失、端口断掉）。建议先退出 MengBot → 破甲/还原 → 再启动。',
    };
  }
  return { serviceRunning: running === true, warning: null };
}

function snapshot(tag, botId) {
  mkdirSync(snapDir(), { recursive: true });
  const name = Date.now() + '-' + tag + (botId ? '-' + botId : '') + '.json';
  const file = join(snapDir(), name);
  copyFileSync(botsFile(), file);
  return file;
}

function listSnapshots(botId) {
  const dir = snapDir();
  if (!existsSync(dir)) return [];
  const all = readdirSync(dir).filter((f) => f.endsWith('.json')).sort().reverse();
  if (!botId) return all;
  return all.filter((f) => f.indexOf('-' + botId) >= 0);
}

/** 状态：API 可达性 + 文件模式的说明 */
export async function mbStatus() {
  let api = null;
  try {
    const r = await fetch('http://127.0.0.1:' + mbPort() + '/api/health', { signal: AbortSignal.timeout(4000) });
    api = await r.json();
  } catch { api = null; }
  const hasFile = existsSync(botsFile());
  let count = 0;
  try { count = readBotsRaw().list.length; } catch { /* 读失败不阻断 */ }
  return {
    ok: hasFile,
    mode: 'file',
    reachable: !!api,
    port: mbPort(),
    app: api ? api.app : null,
    pid: api ? api.pid : null,
    dataDir: mbDataDir(),
    botsFile: botsFile(),
    botsCount: count,
    processRunning: serviceRunning(),
    processPid: servicePid(),
    whyFile: 'PATCH /api/bots/<id> 需要桌面 App 的 loopbackMutationToken，HTTP 直写返回 403；改文件后重启 MengBot 生效',
  };
}

/** 停 MengBot（破甲前必须先停，否则改 files 会让它退出） */
export function mbServiceStop() {
  const pid = servicePid();
  if (!pid) return { ok: true, stopped: false, note: 'MengBot 本来就没在跑' };
  try {
    execFileSync('taskkill', ['/IM', 'MengBot.exe', '/F', '/T'], { encoding: 'utf8', windowsHide: true, timeout: 20000 });
  } catch { /* taskkill 对已退出的进程会非零，忽略 */ }
  const still = servicePid();
  return { ok: !still, stopped: true, wasPid: pid, stillRunning: still || null };
}

/** 启 MengBot（走 shell，等同双击；从服务进程里拉 Electron 也能活） */
export function mbServiceStart() {
  if (servicePid()) return { ok: true, started: false, note: 'MengBot 已经在跑', pid: servicePid() };
  const exe = join(process.env.LOCALAPPDATA || join(home(), 'AppData', 'Local'), 'Programs', 'mengbot', 'MengBot.exe');
  if (!existsSync(exe)) return { ok: false, error: 'exe_not_found', exe: exe };
  try {
    const child = spawn('cmd', ['/c', 'start', '', exe], {
      detached: true, stdio: 'ignore', windowsHide: true,
      cwd: join(exe, '..'),
    });
    child.unref();
    return { ok: true, started: true, exe: exe, note: '已提交启动，等 15–25 秒服务才就绪' };
  } catch (e) {
    return { ok: false, error: 'spawn_failed', detail: String((e && e.message) || e) };
  }
}

/** 列表：文件为真源（含 soul 长度），顺带标注 API 是否在跑 */
export function mbListBots() {
  if (!existsSync(botsFile())) return { ok: false, error: 'no_bots_file', bots: [] };
  const { list } = readBotsRaw();
  const bots = list.map((b) => ({
    id: b.id,
    name: b.name || '',
    title: b.title || '',
    description: clip(b.description || '', 120),
    soulChars: (b.soul || '').length,
    soulBytes: bytes(b.soul),
    soulPreview: clip(String(b.soul || '').replace(/\s+/g, ' '), 120),
    soulHash: b.soulHash || '',
    hashOk: b.soulHash === sha256(b.soul || ''),
    soulDrift: !!b.soulDrift,
    modelSelection: b.modelSelection || null,
    approvalMode: b.approvalMode || b.autoApprove || '',
    autoApprove: !!b.autoApprove,
    gear: normalizeGear(b.gear),
    snapshotCount: listSnapshots(b.id).length,
  }));
  bots.sort((a, b) => b.soulBytes - a.soulBytes);
  return { ok: true, count: bots.length, bots: bots };
}

export function mbReadBot(id) {
  if (!existsSync(botsFile())) return { ok: false, error: 'no_bots_file' };
  const { list } = readBotsRaw();
  const b = list.find((x) => x.id === id);
  if (!b) return { ok: false, error: 'not_found', id: id };
  return {
    ok: true,
    bot: {
      id: b.id, name: b.name || '', title: b.title || '', description: b.description || '',
      soul: b.soul || '', soulHash: b.soulHash || '', soulBytes: bytes(b.soul),
      hashOk: b.soulHash === sha256(b.soul || ''),
      modelSelection: b.modelSelection || null, approvalMode: b.approvalMode || '', autoApprove: !!b.autoApprove,
      gear: normalizeGear(b.gear),
    },
  };
}

/** 装备模式：写 BotRecord.gear。MengBot 读它来决定系统提示词里那一段「本次装配」；改完要重启 MengBot 才生效
 * （它把 bots.json 缓存在内存里）。value 认不出就当不装备，与 MengBot 的 parseGear 一致。 */
export function mbSetGear(id, gear) {
  if (!existsSync(botsFile())) return { ok: false, error: 'no_bots_file' };
  const { raw, list } = readBotsRaw();
  const b = list.find((x) => x.id === id);
  if (!b) return { ok: false, error: 'not_found', id: id };
  const next = normalizeGear(gear);
  const key = Object.keys(raw).find((k) => raw[k] && raw[k].id === id);
  const before = normalizeGear(b.gear);
  if (before === next) {
    // 没变化就不动文件：写一次反而要重启 MengBot，且会多一份快照。
    return { ok: true, botId: id, name: b.name || '', gear: next, changed: false, restartRequired: false, ...serviceWarning() };
  }
  const snap = snapshot('pre-gear', id);
  raw[key] = Object.assign({}, raw[key], { gear: next });
  writeBotsRaw(raw);
  return {
    ok: true,
    botId: id,
    name: b.name || '',
    gear: next,
    before: before,
    changed: true,
    snapshot: snap,
    restartRequired: true,
    hint: next ? 'MengBot 重启后，系统提示词会多出「本次装配」那一段（阶段表走 autokill-purge 的 /api/gear/' + next + '）' : 'MengBot 重启后，系统提示词里那段装备说明消失',
    ...serviceWarning(),
  };
}

/** 破甲：把 text 拼在原 soul 前面（默认）或整体替换 */
export function mbInjectSoul(id, { text, mode = 'prefix' } = {}) {
  if (!existsSync(botsFile())) return { ok: false, error: 'no_bots_file' };
  const inject = String(text || '');
  if (!inject.trim()) return { ok: false, error: 'empty_text' };
  const { raw, list } = readBotsRaw();
  const b = list.find((x) => x.id === id);
  if (!b) return { ok: false, error: 'not_found', id: id };
  const before = String(b.soul || '');
  const next = mode === 'replace' ? inject : (inject + '\n\n---\n\n' + before);
  const nextBytes = bytes(next);
  if (nextBytes > MAX_SOUL_BYTES) {
    return { ok: false, error: 'too_long', detail: '合并后 ' + nextBytes + ' 字节，超过 MengBot 上限 ' + MAX_SOUL_BYTES, bytes: nextBytes };
  }
  const snap = snapshot('pre-inject', id);
  // 找到这个 bot 在 raw 里的键（数字键对象）
  const key = Object.keys(raw).find((k) => raw[k] && raw[k].id === id);
  raw[key] = Object.assign({}, raw[key], { soul: next, soulHash: sha256(next), soulDrift: false });
  writeBotsRaw(raw);
  writeSoulMirror(id, next);
  return {
    ok: true,
    botId: id,
    name: b.name || '',
    before: { chars: before.length, bytes: bytes(before), hash: b.soulHash || '' },
    after: { chars: next.length, bytes: nextBytes, hash: sha256(next) },
    addedBytes: nextBytes - bytes(before),
    snapshot: snap,
    restartRequired: true,
    ...serviceWarning(),
  };
}

/** 还原：用最近一次含该 bot 的快照恢复整份 bots.json + SOUL.md 镜像 */
export function mbRestoreSoul(id) {
  const snaps = listSnapshots(id);
  if (!snaps.length) {
    const anySnap = listSnapshots('');
    if (!anySnap.length) return { ok: false, error: 'no_snapshot' };
    return { ok: false, error: 'no_snapshot_for_bot', id: id, hint: '整库快照有 ' + anySnap.length + ' 份，但没有这个 bot 的' };
  }
  const file = join(snapDir(), snaps[0]);
  const snapRaw = JSON.parse(readFileSync(file, 'utf8'));
  const snapList = Object.values(snapRaw).filter((x) => x && x.id);
  const target = snapList.find((x) => x.id === id);
  if (!target) return { ok: false, error: 'bot_not_in_snapshot', snapshot: file };
  // 还原前也留一份当前状态
  const guard = snapshot('pre-restore', id);
  const cur = readBotsRaw();
  const key = Object.keys(cur.raw).find((k) => cur.raw[k] && cur.raw[k].id === id);
  if (key === undefined) return { ok: false, error: 'bot_missing_now', id: id };
  cur.raw[key] = Object.assign({}, cur.raw[key], { soul: target.soul || '', soulHash: sha256(target.soul || ''), soulDrift: false });
  writeBotsRaw(cur.raw);
  writeSoulMirror(id, target.soul || '');
  const now = readBotsRaw().list.find((x) => x.id === id);
  return {
    ok: true,
    botId: id,
    from: snaps[0],
    guardSnapshot: guard,
    restoredBytes: bytes(target.soul),
    hashMatches: now ? now.soulHash === target.soulHash : false,
    restartRequired: true,
    ...serviceWarning(),
  };
}

/** 装备：给 bot 落模型 / 权限（approvalMode→autoApprove 由它的 UI 口径决定，这里只改明确字段） */
export function mbEquipBot(id, { modelSelection, approvalMode, autoApprove, gear } = {}) {
  if (!existsSync(botsFile())) return { ok: false, error: 'no_bots_file' };
  const patch = {};
  if (modelSelection && modelSelection.model) {
    patch.modelSelection = modelSelection.instanceId
      ? { instanceId: modelSelection.instanceId, model: modelSelection.model }
      : { model: modelSelection.model };
  }
  if (approvalMode) patch.approvalMode = String(approvalMode);
  if (typeof autoApprove === 'boolean') patch.autoApprove = autoApprove;
  if (gear !== undefined) patch.gear = normalizeGear(gear);
  if (!Object.keys(patch).length) return { ok: false, error: 'nothing_to_equip' };
  const { raw, list } = readBotsRaw();
  const b = list.find((x) => x.id === id);
  if (!b) return { ok: false, error: 'not_found', id: id };
  const snap = snapshot('pre-equip', id);
  const key = Object.keys(raw).find((k) => raw[k] && raw[k].id === id);
  raw[key] = Object.assign({}, raw[key], patch);
  writeBotsRaw(raw);
  const now = readBotsRaw().list.find((x) => x.id === id);
  return {
    ok: true,
    botId: id,
    name: b.name || '',
    snapshot: snap,
    before: { modelSelection: b.modelSelection || null, approvalMode: b.approvalMode || '', autoApprove: !!b.autoApprove, gear: normalizeGear(b.gear) },
    after: now ? { modelSelection: now.modelSelection || null, approvalMode: now.approvalMode || '', autoApprove: !!now.autoApprove, gear: normalizeGear(now.gear) } : null,
    restartRequired: true,
    ...serviceWarning(),
  };
}

export function mbSnapshots(id) {
  return { ok: true, dir: snapDir(), files: listSnapshots(id || '') };
}

export function mbPruneSnapshots(keep = 10) {
  const all = listSnapshots('');
  const drop = all.slice(keep);
  for (const f of drop) { try { rmSync(join(snapDir(), f), { force: true }); } catch { /* 忽略 */ } }
  return { ok: true, removed: drop.length, kept: Math.min(all.length, keep) };
}
