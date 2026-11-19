// web/ops/rewind.mjs —— 会话回溯（补齐 dsh-purge 的 rewind，外部控制台版）
//
// 上游 lib/rewind.js 是在宿主进程内改 session 对象：往 surface 上 append 一条 rewind-* 空消息，
// 用 surfaceOp replace 把 fromSeq..endSeq 遮掉，再清 derive 缓存。外部控制台碰不到内存里的
// Session 实例，所以等价做法是**直接改会话存储文件**：把 seq >= fromSeq 的尾部事件物理截掉。
//
// 为什么截尾而不是"删中间"：JSONL 后端是 append-only + 前缀扫描（scanLog 只认前缀，尾部半帧才做恢复），
// 中间挖洞会让 turn/start、step 配对断掉，reader 只能拒收。回退天然就是"砍尾巴"，所以整份重写、
// 保留前缀不变，是对这套格式最温和的写法。
//
// 为什么自己拆 zstd 帧：node:zlib 的 zstdDecompressSync 只解**第一帧**（实测 676 帧的文件只吐 214 字节），
// 而这份日志是"一帧 = 一批事件"的拼接容器。必须照 @deepseek-ai/dsh-session-persistence-jsonl 的
// scanZstdFrames 语义自己按帧边界切，再逐帧解。写回时同样按帧压，并打开 checksumFlag（后端默认带校验）。
//
// 安全边界（本模块唯一允许写的两处）：
//   1) 目标会话文件本身（必须位于 <dshHome>/sessions 下，文件名匹配 session[.vN].jsonl[.zstd]）；
//   2) <dataDir>/rewind-backups/<ts>-<id>/ 备份目录。
// 其余路径一律拒绝，绝不碰宿主的 app.asar / 插件 / 其它会话。
import {
  closeSync, copyFileSync, existsSync, fsyncSync, ftruncateSync, mkdirSync, openSync,
  readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync, writeSync,
} from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { constants as zlibConstants, zstdCompressSync, zstdDecompressSync } from 'node:zlib';

export const META = {
  id: 'rewind',
  zh: '会话回溯',
  en: 'Session rewind',
  kind: 'both',
  requires: ['dsh-sessions-dir', 'zstd-multiframe'],
  note: '按 seq 截掉会话日志尾部（最后一轮/最近 N 轮/指定 seq），先整份备份到 data/rewind-backups 再重写；宿主正在写的会话拒绝操作。',
};

/** mtime 距今小于这个值就当"宿主可能正握着写句柄"，拒绝改动。3 秒是需求给的阈值。 */
const ACTIVE_WINDOW_MS = 3000;
/** 二次采样间隔：只比 mtime 新近度还不够，得确认这 200ms 内文件没在长。 */
const ACTIVE_REPROBE_MS = 200;
const STATUS_LIMIT = 20;
const PREVIEW_LIMIT = 40;
const FRAME_LINE_LIMIT = 256;
const FRAME_BYTE_LIMIT = 256 * 1024;
const ZSTD_MAGIC = 0xfd2fb528;
/** 只认会话日志文件名。v0..vN 都放行，写回时保持原版本号。 */
const SESSION_FILE_RE = /^session(?:\.v(\d+))?\.jsonl(\.zstd)?$/i;

// ───────────────────────────── 通用小工具 ─────────────────────────────

function errText(err) {
  if (!err) return '未知错误';
  if (typeof err === 'string') return err;
  return String((err && err.message) || err.code || err);
}

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function isoOf(ms) {
  const n = Number(ms);
  return Number.isFinite(n) ? new Date(n).toISOString() : '';
}

/** 备份目录名里的时间戳：去掉 ':'/'-' 便于 Windows 目录名，精确到秒。 */
function stamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '');
}

function safeJson(line) {
  try {
    const v = JSON.parse(line);
    return v && typeof v === 'object' ? v : null;
  } catch { return null; }
}

/**
 * 从裸行里抠 type，不 JSON.parse 整行。
 * 为什么：一个会话十几万行，逐行 parse 会慢一个量级；type 永远是第一个键，正则便宜得多。
 */
function typeOfRawLine(line) {
  const m = /^\{"type":"([^"]+)"/.exec(line);
  return m ? m[1] : '';
}

/** seq 同理走正则：seq 在 JSON 里是第二个键，取第一个出现即正确。 */
function seqOfRawLine(line) {
  const m = /^\{"type":"[^"]+","seq":(\d+)/.exec(line);
  return m ? Number(m[1]) : null;
}

/**
 * 只在需要精确归属时才付 JSON.parse 的代价。
 * 为什么留这个兜底：历史代（v0/v1 的 packed 行）或将来换键序都可能让正则落空，
 * 那时如果直接把 seq 当 null（= 保留该行），裁剪计数就会和计划对不上——宁可 parse 出真 seq。
 */
function seqOfLine(line) {
  const fast = seqOfRawLine(line);
  if (fast !== null) return fast;
  const event = safeJson(line);
  const seq = event && event.seq;
  return Number.isFinite(Number(seq)) ? Number(seq) : null;
}

function typeOfLine(line) {
  const fast = typeOfRawLine(line);
  if (fast) return fast;
  const event = safeJson(line);
  return event && typeof event.type === 'string' ? event.type : '';
}

function splitLines(text) {
  const raw = text.split('\n');
  // 合法日志每行都以 \n 结尾，split 出来的最后一个空串不算一行。
  if (raw.length && raw[raw.length - 1] === '') raw.pop();
  return raw;
}

// ─────────────────────── zstd 多帧容器：扫描 / 解 / 压 ───────────────────────

/**
 * 照 dsh-session-persistence-jsonl 的 scanZstdFrames 语义切帧：只读帧头/块头做结构定位，
 * 不做解压。结构非法直接判定文件损坏（宁可拒绝也不要瞎猜边界），EOF 落在帧中间则报 tornStart，
 * 让调用方按"半帧 = 宿主写崩的尾巴"处理，与后端的恢复语义对齐。
 */
export function scanZstdFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (offset < buffer.length) {
    const start = offset;
    if (buffer.length - offset < 4) return { frames, tornStart: start };
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) {
      throw new Error('zstd 帧魔数不符（偏移 ' + offset + '），文件可能在中间被改坏');
    }
    offset += 4;
    if (offset === buffer.length) return { frames, tornStart: start };
    const descriptor = buffer.readUInt8(offset);
    offset += 1;
    if ((descriptor & 24) !== 0) throw new Error('zstd 帧头保留位非零（偏移 ' + (offset - 1) + '）');
    const contentSizeFlag = descriptor >>> 6;
    const singleSegment = (descriptor & 32) !== 0;
    const checksum = (descriptor & 4) !== 0;
    const dictionaryFlag = descriptor & 3;
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag;
    const headerRest = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
    if (buffer.length - offset < headerRest) return { frames, tornStart: start };
    offset += headerRest;
    for (;;) {
      if (buffer.length - offset < 3) return { frames, tornStart: start };
      const blockHeader = buffer.readUIntLE(offset, 3);
      offset += 3;
      const lastBlock = (blockHeader & 1) !== 0;
      const blockType = (blockHeader >>> 1) & 3;
      const blockSize = blockHeader >>> 3;
      if (blockType === 3) throw new Error('zstd 块类型保留值（偏移 ' + (offset - 3) + '）');
      // RLE 块只占 1 字节负载，其余类型按 blockSize 跳过。
      const payloadBytes = blockType === 1 ? 1 : blockSize;
      if (buffer.length - offset < payloadBytes) return { frames, tornStart: start };
      offset += payloadBytes;
      if (lastBlock) break;
    }
    if (checksum) {
      if (buffer.length - offset < 4) return { frames, tornStart: start };
      offset += 4;
    }
    frames.push({ start, end: offset });
  }
  return { frames };
}

/** 单帧压缩：带上 content checksum，和上游 compressZstdFrame 的选项一致。 */
function compressFrame(input) {
  return zstdCompressSync(input, { params: { [zlibConstants.ZSTD_c_checksumFlag]: 1 } });
}

/**
 * 解出一整份会话日志的明文。
 * 会被 status() 频繁调用，所以返回帧数/压缩方式/半帧位置这些诊断字段给上层汇总。
 */
export function decodeSession(buffer) {
  if (!buffer || buffer.length === 0) throw new Error('会话文件是空的');
  if (buffer.length < 4 || buffer.readUInt32LE(0) !== ZSTD_MAGIC) {
    // compression:'none' 的部署会直接落明文 JSONL，这里要同样支持（不能再假设一定是 zstd）。
    const text = buffer.toString('utf8');
    if (!text.startsWith('{"type":"session"')) throw new Error('不是会话日志：首行既不是 zstd 帧也不是 session 头');
    return { compression: 'none', frames: 0, torn: false, text };
  }
  const { frames, tornStart } = scanZstdFrames(buffer);
  const parts = [];
  for (const frame of frames) {
    // 逐帧解压：一帧坏掉就点名偏移，别把整份日志的失败糊成一句"读取失败"。
    try {
      parts.push(zstdDecompressSync(buffer.subarray(frame.start, frame.end)));
    } catch (e) {
      throw new Error('zstd 帧解压失败（偏移 ' + frame.start + '）：' + errText(e));
    }
  }
  return {
    compression: 'zstd',
    frames: frames.length,
    torn: tornStart !== undefined,
    tornStart: tornStart === undefined ? null : tornStart,
    text: Buffer.concat(parts).toString('utf8'),
  };
}

/**
 * 把行数组重新编码成会话文件的字节。
 * 头行单独压一帧：后端 list()/stat() 只解第一帧就能拿到会话元信息，保持这个布局能省它的事。
 */
export function encodeSessionBytes(lines, options = {}) {
  const compression = options.compression === 'none' ? 'none' : 'zstd';
  if (!Array.isArray(lines) || lines.length === 0) throw new Error('要写入的行列表为空');
  const text = lines.join('\n') + '\n';
  if (compression === 'none') return Buffer.from(text, 'utf8');
  const parts = [compressFrame(Buffer.from(lines[0] + '\n', 'utf8'))];
  let batch = [];
  let bytes = 0;
  for (let i = 1; i < lines.length; i += 1) {
    const lineBuf = Buffer.from(lines[i] + '\n', 'utf8');
    batch.push(lineBuf);
    bytes += lineBuf.length;
    if (batch.length >= FRAME_LINE_LIMIT || bytes >= FRAME_BYTE_LIMIT) {
      parts.push(compressFrame(Buffer.concat(batch)));
      batch = [];
      bytes = 0;
    }
  }
  if (batch.length) parts.push(compressFrame(Buffer.concat(batch)));
  return Buffer.concat(parts);
}

// ─────────────────────────── 事件语义（移植上游判定） ───────────────────────────

function blocksText(content) {
  const c = content;
  if (typeof c === 'string') return c.trim();
  if (!Array.isArray(c)) return '';
  const parts = [];
  for (const block of c) {
    if (!block) continue;
    if (typeof block === 'string') { parts.push(block); continue; }
    if (block.type === 'text' || typeof block.text === 'string') parts.push(String(block.text ?? ''));
  }
  return parts.join('').trim();
}

/** 上游 userTextFromEvent：data.content 与 data.message.content 两种形状都要认。 */
export function userTextOf(event) {
  const data = event && event.data;
  if (!data) return '';
  const content = data.content !== undefined ? data.content : (data.message && data.message.content);
  return blocksText(content);
}

function assistantTextOf(event) {
  const data = event && event.data;
  if (!data) return '';
  const content = data.content !== undefined ? data.content : (data.message && data.message.content);
  return blocksText(content);
}

/** 插件草稿（记忆快照之类）不是人写的，回退边界不能落在它上面。 */
function isPluginDraft(text) {
  const v = String(text || '').trim();
  if (!v) return false;
  return /^\[MNEMON\]/i.test(v) || /MNEMON RUNTIME MEMORY SNAPSHOT/i.test(v) || /^MNEMON VIEW TOOLS/im.test(v);
}

function isRewindMarker(event) {
  if (!event || event.type !== 'user/message') return false;
  const id = event.data && event.data.id;
  return typeof id === 'string' && id.startsWith('rewind-');
}

/** 上游 isHumanUserEvent 的外部等价物：source.kind 缺失或 'user' 才算人打的。 */
export function isHumanUserEvent(event) {
  if (!event || event.type !== 'user/message') return false;
  const source = event.data && event.data.source;
  if (source && source.kind === 'plugin') return false;
  if (source && source.kind && source.kind !== 'user') return false;
  const text = userTextOf(event);
  if (!text || isPluginDraft(text)) return false;
  return true;
}

/** 上游 isRoundPromptEvent：手打是 user；goal 各轮（含 round 0）也算一轮的起点。 */
export function isRoundPromptEvent(event) {
  if (!event || event.type !== 'user/message' || isRewindMarker(event)) return false;
  const source = event.data && event.data.source;
  const kind = source && source.kind;
  if (kind === 'plugin') return false;
  const text = userTextOf(event);
  if (!text || isPluginDraft(text)) return false;
  if (!kind || kind === 'user') return true;
  if (kind === 'goal') return Number.isFinite(Number(source.round)) && Number(source.round) >= 0;
  return false;
}

/** 已闭合的 turn 窗口，按出现顺序。startSeq 找不到（v2 以前缺 turn/start）时给 -1，交给上层退化。 */
export function closedTurnWindows(events) {
  const starts = new Map();
  const windows = [];
  for (const event of events) {
    if (!event) continue;
    if (event.type === 'turn/start') {
      starts.set(event.data && event.data.turn, Number(event.seq));
    } else if (event.type === 'turn/end') {
      const turn = event.data && event.data.turn;
      const startSeq = starts.has(turn) ? starts.get(turn) : NaN;
      windows.push({ turn, startSeq: Number.isFinite(startSeq) ? startSeq : -1, endSeq: Number(event.seq) });
    }
  }
  return windows;
}

function brief(event) {
  const type = String((event && event.type) || '?');
  if (type === 'user/message') {
    const kind = (event.data && event.data.source && event.data.source.kind) || 'user';
    return '[' + kind + '] ' + userTextOf(event).replace(/\s+/g, ' ').slice(0, 90);
  }
  if (type === 'assistant/message') return assistantTextOf(event).replace(/\s+/g, ' ').slice(0, 90);
  if (type === 'tool/call') {
    const d = event.data || {};
    return String(d.name || d.toolName || 'tool') + '(' + JSON.stringify(d.arguments || d.input || {}).slice(0, 60) + ')';
  }
  if (type === 'tool/result') return assistantTextOf(event).replace(/\s+/g, ' ').slice(0, 90);
  if (type === 'turn/start' || type === 'turn/end') return 'turn ' + String((event.data && event.data.turn) ?? '?');
  return '';
}

// ───────────────────────────── 会话文件发现 ─────────────────────────────

function sessionsRootOf(ctx) {
  // 允许覆盖：测试用临时 dshHome，线上走 ctx.dshHome。只读，不建目录。
  const root = (ctx && ctx.sessionsRoot) || join(String((ctx && ctx.dshHome) || ''), 'sessions');
  return resolve(root);
}

/**
 * 每个会话目录只取"最新一代"日志：vN 里取最大 N，同版本优先压缩版。
 * 为什么：v3→v4 迁移期间同一目录可能同时躺着多代文件，写错代会把旧格式当当前格式改。
 */
function pickCanonical(entries) {
  let best = null;
  for (const name of entries) {
    const m = SESSION_FILE_RE.exec(name);
    if (!m) continue;
    // 捕获组：1 = '.vN' 里的 N（可能缺省），2 = '.zstd' 后缀。
    const version = m[1] === undefined ? 0 : Number(m[1]);
    const zstd = m[2] ? 1 : 0;
    const rank = version * 10 + zstd;
    if (!best || rank > best.rank) best = { name, version, zstd, rank };
  }
  return best;
}

/** 扫描 sessions 根目录，返回所有会话的物理文件（只 stat + readdir，不读内容）。 */
export function listSessionFiles(root) {
  const rows = [];
  let projects = [];
  try { projects = readdirSync(root, { withFileTypes: true }); } catch { return rows; }
  for (const project of projects) {
    if (!project.isDirectory()) continue;
    const projectPath = join(root, project.name);
    let sessions = [];
    try { sessions = readdirSync(projectPath, { withFileTypes: true }); } catch { continue; }
    for (const session of sessions) {
      if (!session.isDirectory()) continue;
      const dirPath = join(projectPath, session.name);
      let files = [];
      try { files = readdirSync(dirPath); } catch { continue; }
      const pick = pickCanonical(files);
      if (!pick) continue;
      const filePath = join(dirPath, pick.name);
      let st = null;
      try { st = statSync(filePath); } catch { continue; }
      if (!st.isFile()) continue;
      rows.push({
        id: session.name,
        project: project.name,
        dir: dirPath,
        path: filePath,
        fileName: pick.name,
        version: pick.version,
        compression: pick.zstd ? 'zstd' : 'none',
        sizeBytes: st.size,
        mtimeMs: st.mtimeMs,
      });
    }
  }
  rows.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return rows;
}

/**
 * 整棵树的扫描（约 1.2k 个会话目录 ≈ 150ms）在 plan/run 每次点击时都跑一遍太浪费，
 * 给个 2 秒 TTL 的进程内缓存；调 status() 时顺手刷新，保证"刚打开列表就点回退"是最新视图。
 * 缓存的只是路径/大小/mtime，真正改文件前一律重新 stat（activeProbe），不会被缓存骗到。
 */
let scanCache = { root: '', at: 0, rows: null };

function scanSessions(root, fresh = false) {
  const now = Date.now();
  if (!fresh && scanCache.rows && scanCache.root === root && now - scanCache.at < 2000) return scanCache.rows;
  const rows = listSessionFiles(root);
  scanCache = { root, at: now, rows };
  return rows;
}

/** 会话目录名 → 会话 id。目录名就是 id（会话 id 已被宿主转义成安全路径段）。 */
function normalizeSessionId(raw) {
  const id = String(raw == null ? '' : raw).trim();
  if (!id) return '';
  // 只允许单段目录名：任何路径分隔、盘符、.. 都直接判非法，避免用 sessionId 拼出越界路径。
  if (id.includes('/') || id.includes('\\') || id.includes(':') || id.includes('..') || id.includes('\0')) return '';
  return id;
}

function findSession(rows, sessionId) {
  const id = normalizeSessionId(sessionId);
  if (!id) return null;
  return rows.find((row) => row.id === id) || null;
}

// ───────────────────────────── 汇总（status 用） ─────────────────────────────

/**
 * 一遍扫完全部行，产出 status 需要的四个数：事件数、闭合轮数、可回退轮数、最后一条人类消息。
 * 只对 turn/*、user/message、session/title 这几类真正 JSON.parse，其余只数行。
 */
function summarizeSession(text) {
  const lines = splitLines(text);
  const out = {
    lines: lines.length,
    header: null,
    events: 0,
    turns: 0,
    rewindable: 0,
    openTurn: false,
    title: '',
    lastHuman: null,
    subagent: false,
    cwd: '',
  };
  if (!lines.length) return out;
  out.header = safeJson(lines[0]);
  if (out.header) {
    out.subagent = out.header.origin === 'subagent' || Number(out.header.delegationDepth || 0) > 0;
    out.cwd = String(out.header.cwd || '');
  }
  const windows = [];
  const starts = new Map();
  const prompts = [];
  let lastBoundary = '';
  for (let i = 1; i < lines.length; i += 1) {
    const type = typeOfLine(lines[i]);
    if (!type) continue;
    out.events += 1;
    if (type !== 'turn/start' && type !== 'turn/end' && type !== 'user/message' && type !== 'session/title') continue;
    const event = safeJson(lines[i]);
    if (!event) continue;
    if (type === 'turn/start') {
      starts.set(event.data && event.data.turn, Number(event.seq));
      lastBoundary = 'start';
    } else if (type === 'turn/end') {
      const turn = event.data && event.data.turn;
      const s = starts.has(turn) ? starts.get(turn) : NaN;
      windows.push({ turn, startSeq: Number.isFinite(s) ? s : -1, endSeq: Number(event.seq) });
      lastBoundary = 'end';
    } else if (type === 'user/message') {
      if (isRoundPromptEvent(event)) prompts.push({ seq: Number(event.seq), text: userTextOf(event) });
      if (isHumanUserEvent(event)) out.lastHuman = { seq: Number(event.seq), text: userTextOf(event) };
    } else if (type === 'session/title') {
      const d = event.data || {};
      if (d.title) out.title = String(d.title);
    }
  }
  out.turns = windows.length;
  out.openTurn = lastBoundary === 'start';
  // 可回退轮数 = 窗口内确实落了一轮提示的闭合轮（只有窗口没有提示，说明是 goal/子代理自跑，退不了）。
  for (let i = 0; i < windows.length; i += 1) {
    const floor = i > 0 ? windows[i - 1].endSeq : -1;
    if (prompts.some((p) => p.seq > floor && p.seq <= windows[i].endSeq)) out.rewindable += 1;
  }
  if (out.lastHuman) out.lastHuman.text = out.lastHuman.text.replace(/\s+/g, ' ').slice(0, 120);
  return out;
}

/** status 每次首屏都会被调用，文件大时重复解压很浪费：按 (path,size,mtime) 缓存汇总结果（纯内存）。 */
const summaryCache = new Map();

function summaryFor(row) {
  const key = row.path + '|' + row.sizeBytes + '|' + row.mtimeMs;
  const hit = summaryCache.get(key);
  if (hit) return hit;
  const buf = readFileSync(row.path);
  const decoded = decodeSession(buf);
  const summary = summarizeSession(decoded.text);
  summary.frames = decoded.frames;
  summary.compression = decoded.compression;
  summary.torn = decoded.torn;
  if (summaryCache.size > 64) summaryCache.clear();
  summaryCache.set(key, summary);
  return summary;
}

// ───────────────────────────── status ─────────────────────────────

export async function status(ctx) {
  const root = sessionsRootOf(ctx);
  try {
    if (!existsSync(root)) {
      return { ok: true, available: false, summary: '没有会话目录：' + root, detail: { root, sessions: [] } };
    }
    const startAt = Date.now();
    const rows = scanSessions(root);
    const shown = rows.slice(0, STATUS_LIMIT);
    const sessions = [];
    for (const row of shown) {
      const base = {
        id: row.id,
        project: row.project,
        path: row.path,
        fileName: row.fileName,
        format: 'v' + row.version,
        compression: row.compression,
        sizeBytes: row.sizeBytes,
        mtime: isoOf(row.mtimeMs),
        ageMs: Math.max(0, Date.now() - row.mtimeMs),
        active: Date.now() - row.mtimeMs < ACTIVE_WINDOW_MS,
      };
      try {
        const summary = summaryFor(row);
        sessions.push({
          ...base,
          events: summary.events,
          lines: summary.lines,
          turns: summary.turns,
          rewindable: summary.rewindable,
          openTurn: summary.openTurn,
          subagent: summary.subagent,
          title: summary.title,
          cwd: summary.cwd,
          lastHuman: summary.lastHuman,
          torn: !!summary.torn,
          error: null,
        });
      } catch (e) {
        // 单个会话读坏不影响整屏：标 error 让它自己那一行降级。
        sessions.push({ ...base, events: null, rewindable: 0, error: errText(e) });
      }
    }
    const usable = sessions.filter((s) => !s.error && Number(s.rewindable) > 0);
    const freshest = usable[0] || sessions[0] || null;
    const summary = sessions.length === 0
      ? '会话目录里没有可识别的日志：' + root
      : ('可回退会话 ' + usable.length + '/' + sessions.length + '（共 ' + rows.length + ' 个）'
        + (freshest ? '；最新 ' + freshest.id.slice(0, 18) + ' 有 ' + freshest.rewindable + ' 轮可退' : ''));
    return {
      ok: true,
      available: sessions.length > 0,
      summary,
      detail: {
        root,
        total: rows.length,
        shown: sessions.length,
        limit: STATUS_LIMIT,
        scanMs: Date.now() - startAt,
        activeWindowMs: ACTIVE_WINDOW_MS,
        backupsDir: join(String(ctx.dataDir || ''), 'rewind-backups'),
        sessions,
      },
    };
  } catch (e) {
    return { ok: false, available: false, summary: '会话目录读取失败：' + errText(e), detail: { root, error: errText(e) } };
  }
}

// ───────────────────────── 计划：planRewind 的外部等价物 ─────────────────────────

/**
 * 纯函数：给事件数组 + 选项，算出要截掉的 seq 区间。
 * 语义对齐上游 planRewind：只在"最近一个已闭合的 turn 窗口"里找最后一轮提示，
 * 回退起点优先用该窗口的 turn/start（这样整轮连上下文快照一起退掉），拿不到才退化成提示自身的 seq。
 */
export function planRewindEvents(events, options = {}) {
  const list = (Array.isArray(events) ? events : []).filter(Boolean);
  if (!list.length) return { ok: false, error: '会话里没有事件' };
  const maxSeq = list.reduce((acc, e) => (Number.isFinite(Number(e.seq)) ? Math.max(acc, Number(e.seq)) : acc), -1);
  const mode = options.mode === 'to-seq'
    ? 'to-seq'
    : ((options.mode === 'last-turns' || Number(options.turns) > 0) ? 'last-turns' : 'last-turn');

  let fromSeq = null;
  let dropTurns = 0;
  let text = '';
  let targetTurn = null;

  if (mode === 'to-seq') {
    const seq = Number(options.seq);
    if (!Number.isInteger(seq) || seq < 0) return { ok: false, error: 'to-seq 模式需要非负整数 seq' };
    if (!list.some((e) => Number(e.seq) === seq)) return { ok: false, error: '该会话里没有 seq=' + seq + ' 的事件' };
    fromSeq = seq;
  } else {
    const windows = closedTurnWindows(list);
    if (!windows.length) return { ok: false, error: '没有已闭合的轮次，无可回退' };
    const want = mode === 'last-turns' ? Math.max(1, Number(options.turns) || 1) : 1;
    if (want > windows.length) return { ok: false, error: '只有 ' + windows.length + ' 个完整轮次，退不了 ' + want + ' 轮' };
    const index = windows.length - want;
    const win = windows[index];
    const floor = index > 0 ? windows[index - 1].endSeq : -1;
    const prompts = list
      .filter((e) => isRoundPromptEvent(e))
      .map((e) => ({ seq: Number(e.seq), text: userTextOf(e) }))
      .filter((p) => p.seq > floor && p.seq <= win.endSeq);
    const anchor = prompts.length ? prompts[prompts.length - 1] : null;
    if (win.startSeq < 0 && !anchor) return { ok: false, error: '这一轮既没有 turn/start 也没有人类提示，定位不到回退边界' };
    fromSeq = win.startSeq >= 0 ? win.startSeq : anchor.seq;
    dropTurns = want;
    targetTurn = win.turn;
    text = anchor ? anchor.text : '';
  }

  const drop = list.filter((e) => Number.isFinite(Number(e.seq)) && Number(e.seq) >= fromSeq);
  const keep = list.filter((e) => !(Number.isFinite(Number(e.seq)) && Number(e.seq) >= fromSeq));
  const preview = drop.slice(0, PREVIEW_LIMIT).map((e) => ({
    seq: Number(e.seq),
    type: String(e.type || '?'),
    brief: brief(e),
  }));
  // 砍完尾巴后前缀若停在 turn/start，说明会话会留下一个"开着的回合"，宿主下次启动会补合成 turn/end。
  const lastKeptBoundary = [...keep].reverse().find((e) => e.type === 'turn/start' || e.type === 'turn/end');
  return {
    ok: true,
    mode,
    fromSeq,
    toSeq: maxSeq,
    dropCount: drop.length,
    dropTurns,
    turn: targetTurn,
    text,
    eventsBefore: list.length,
    eventsAfter: keep.length,
    leavesOpenTurn: !!lastKeptBoundary && lastKeptBoundary.type === 'turn/start',
    preview,
    previewTruncated: drop.length > preview.length,
  };
}

/** 载入一个会话：文件行 + 事件 + 诊断，run/plan 共用。 */
function loadSession(row) {
  const buffer = readFileSync(row.path);
  const decoded = decodeSession(buffer);
  const lines = splitLines(decoded.text);
  const events = [];
  for (let i = 1; i < lines.length; i += 1) {
    const seq = seqOfLine(lines[i]);
    if (seq === null) continue;
    const event = safeJson(lines[i]);
    if (!event) continue;
    events.push(event);
  }
  return { buffer, decoded, lines, events };
}

/** 已知项目目录时直连，省掉整棵树扫描（UI 从 status.detail.sessions[i].project 就能带过来）。 */
function directRow(root, project, id) {
  const name = String(project || '');
  if (!name || name.includes('..') || name.includes('/') || name.includes('\\')) return null;
  const dir = join(root, name, id);
  let files = [];
  try { files = readdirSync(dir); } catch { return null; }
  const pick = pickCanonical(files);
  if (!pick) return null;
  const filePath = join(dir, pick.name);
  let st = null;
  try { st = statSync(filePath); } catch { return null; }
  if (!st.isFile()) return null;
  return {
    id,
    project: name,
    dir,
    path: filePath,
    fileName: pick.name,
    version: pick.version,
    compression: pick.zstd ? 'zstd' : 'none',
    sizeBytes: st.size,
    mtimeMs: st.mtimeMs,
  };
}

/**
 * 给 UI 的兜底清单：缺 sessionId 时把"最近几个真能退的会话"带回去，
 * 前端拿它渲染选择器，而不是让用户自己去 ~/.dsh 里翻目录名。
 */
function candidateRows(ctx, limit = 5) {
  const out = [];
  try {
    for (const row of scanSessions(sessionsRootOf(ctx), true).slice(0, 12)) {
      try {
        const s = summaryFor(row);
        if (s.rewindable > 0 && !s.torn) {
          out.push({
            id: row.id,
            project: row.project,
            rewindable: s.rewindable,
            openTurn: s.openTurn,
            lastHuman: s.lastHuman,
            mtime: isoOf(row.mtimeMs),
            active: Date.now() - row.mtimeMs < ACTIVE_WINDOW_MS,
          });
          if (out.length >= limit) break;
        }
      } catch { /* 单个会话读坏就跳过，别拖累清单 */ }
    }
  } catch { /* 连目录都读不了时返回空清单 */ }
  return out;
}

/** sessionId:'auto' 时挑"最近修改且确实有可退轮次"的那一个。 */
function pickAutoRow(ctx) {
  for (const row of scanSessions(sessionsRootOf(ctx), true).slice(0, 12)) {
    try {
      const s = summaryFor(row);
      if (s.rewindable > 0 && !s.torn) return row;
    } catch { /* 跳过读坏的会话 */ }
  }
  return null;
}

function resolveTarget(ctx, opts) {
  const root = sessionsRootOf(ctx);
  const raw = opts && opts.sessionId;
  const id = normalizeSessionId(raw);
  if (!id) {
    // 不是"报错完事"：把候选项一起交回去，UI 才有东西可展示。
    return {
      ok: false,
      error: '需要 sessionId（可传 "auto" 让后端挑最近一个可回退会话）',
      hint: { needsSessionId: true, candidates: candidateRows(ctx) },
    };
  }
  let row = null;
  if (id === 'auto') {
    row = pickAutoRow(ctx);
    if (!row) return { ok: false, error: '没有可自动挑选的会话（最近 12 个里都没有可回退轮次）' };
  }
  // 缓存里找不到不代表不存在（可能是刚建好的会话），所以判定"没有这个会话"之前强制刷一次。
  row = row
    || directRow(root, opts && opts.project, id)
    || findSession(scanSessions(root), id)
    || findSession(scanSessions(root, true), id);
  if (!row) return { ok: false, error: '没有这个会话：' + id + '（根目录 ' + root + '）' };
  // 双保险：解析出来的绝对路径必须落在 sessions 根目录里，且文件名还是会话日志名。
  const abs = resolve(row.path);
  if (!abs.startsWith(root.endsWith(sep) ? root : root + sep)) return { ok: false, error: '会话路径越界：' + abs };
  if (!SESSION_FILE_RE.test(basename(abs))) return { ok: false, error: '目标不是会话日志文件：' + basename(abs) };
  const dataDir = ctx.dataDir ? resolve(String(ctx.dataDir)) : '';
  if (dataDir && (abs === dataDir || abs.startsWith(dataDir + sep))) return { ok: false, error: '拒绝把 dataDir 内的文件当会话日志改写' };
  return { ok: true, root, row, abs, autoPicked: id === 'auto' };
}

export async function plan(ctx, opts = {}) {
  try {
    const target = resolveTarget(ctx, opts);
    if (!target.ok) return { ok: false, error: target.error, detail: target.hint || null };
    const { row } = target;
    const { decoded, lines, events } = loadSession(row);
    if (decoded.torn) {
      return { ok: false, error: '会话尾部有半帧（宿主写入中断），先用 restart 让宿主跑完恢复再回退' };
    }
    const p = planRewindEvents(events, opts);
    if (!p.ok) return p;
    return {
      ...p,
      sessionId: row.id,
      project: row.project,
      autoPicked: target.autoPicked === true,
      path: row.path,
      compression: decoded.compression,
      frames: decoded.frames,
      linesBefore: lines.length,
      linesAfter: Math.max(1, lines.length - p.dropCount),
      active: Date.now() - row.mtimeMs < ACTIVE_WINDOW_MS,
      mtime: isoOf(row.mtimeMs),
    };
  } catch (e) {
    return { ok: false, error: errText(e) };
  }
}

// ───────────────────────── 写入：备份 / 原子发布 ─────────────────────────

/** 宿主还开着写句柄时改文件 = 谁都可能踩到半截状态，所以先看它最近动过没有。 */
function activeProbe(row) {
  let st = null;
  try { st = statSync(row.path); } catch (e) { return { ok: false, error: errText(e) }; }
  const age = Date.now() - st.mtimeMs;
  if (age < ACTIVE_WINDOW_MS) {
    return {
      ok: false,
      ageMs: age,
      error: '会话活跃（mtime 距今 ' + age + 'ms < ' + ACTIVE_WINDOW_MS + 'ms），先停一会话/停宿主再回退',
    };
  }
  return { ok: true, ageMs: age, size: st.size, mtimeMs: st.mtimeMs };
}

function sleepSync(ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) { /* 忙等：这是同步 API，阻塞几百毫秒换取一次真实采样 */ }
}

/** 二次采样：mtime 新近度只能说明"刚写过"，还得确认这 200ms 里它没继续长。 */
function activeReprobe(row, before) {
  sleepSync(ACTIVE_REPROBE_MS);
  let st = null;
  try { st = statSync(row.path); } catch (e) { return { ok: false, error: errText(e) }; }
  if (st.size !== before.size || st.mtimeMs !== before.mtimeMs) {
    return { ok: false, ageMs: Date.now() - st.mtimeMs, error: '会话正在被宿主写入（' + ACTIVE_REPROBE_MS + 'ms 内发生变化），拒绝改写' };
  }
  return { ok: true, ageMs: Date.now() - st.mtimeMs };
}

function backupDirFor(ctx, sessionId) {
  const base = join(String(ctx.dataDir || ''), 'rewind-backups');
  // 时间戳只算一次：跨秒重算会让 -2/-3 的候选名换了前缀，冲突规避失效。
  const ts = stamp();
  let dir = join(base, ts + '-' + sessionId);
  for (let i = 2; existsSync(dir) && i < 50; i += 1) dir = join(base, ts + '-' + sessionId + '-' + i);
  return dir;
}

/** 先把原文件整份落到备份目录，再返回目录与两份 sha256（用来事后证明"备份 == 原文"）。 */
function makeBackup(ctx, row, buffer, fileName) {
  const dir = backupDirFor(ctx, row.id);
  mkdirSync(dir, { recursive: true });
  const target = join(dir, fileName);
  copyFileSync(row.path, target);
  const copyBuf = readFileSync(target);
  return {
    dir,
    file: target,
    sha256Source: sha256(buffer),
    sha256Backup: sha256(copyBuf),
    sizeBytes: copyBuf.length,
    identical: sha256(copyBuf) === sha256(buffer),
  };
}

/**
 * 发布新内容。优先 rename（同目录原子替换，不产生"写一半"的中间态）；
 * Windows 上若目标被宿主持着而 rename 失败，退化成原地覆盖——备份已经在手，退回去只要一次 copyFile。
 */
function publish(targetPath, bytes) {
  // 临时文件必须和目标同目录（跨卷 rename 不原子），名字带 pid+时间避免撞车。
  const tmp = join(dirname(targetPath), '.rewind-' + process.pid + '-' + Date.now().toString(36) + '.tmp');
  const writeAll = (fd) => { writeSync(fd, bytes, 0, bytes.length, 0); fsyncSync(fd); };
  try {
    const fd = openSync(tmp, 'wx');
    try { writeAll(fd); } finally { closeSync(fd); }
    try {
      renameSync(tmp, targetPath);
      return 'rename';
    } catch (e) {
      // 目标被宿主持着时 Windows 可能拒绝 rename：退化成原地覆盖。
      try { unlinkSync(tmp); } catch { /* 可能已被 rename 收走 */ }
      const out = openSync(targetPath, 'r+');
      try { ftruncateSync(out, 0); writeAll(out); } finally { closeSync(out); }
      return 'inplace';
    }
  } catch (e) {
    // 失败也要收尸：别把半截 .rewind-*.tmp 留在宿主的会话目录里。
    try { unlinkSync(tmp); } catch { /* 没建成就没得删 */ }
    throw e;
  }
}

// ───────────────────────────── run ─────────────────────────────

export async function run(ctx, opts = {}) {
  const dryRun = opts && opts.dryRun === true;
  try {
    const target = resolveTarget(ctx, opts);
    if (!target.ok) {
      return { ok: false, changed: false, summary: target.error, error: target.error, detail: target.hint || null };
    }

    const { row } = target;
    const { buffer, decoded, lines, events } = loadSession(row);
    if (decoded.torn) {
      const msg = '会话尾部有半帧（宿主写入中断），先用 restart 让宿主完成恢复再回退';
      return { ok: false, changed: false, summary: msg, error: msg };
    }

    const p = planRewindEvents(events, opts);
    if (!p.ok) {
      // 没有可退的轮次不是错误：重复点按钮应当稳定得到"没变化"。
      return {
        ok: true,
        changed: false,
        summary: '没有可回退的轮次：' + p.error,
        detail: { sessionId: row.id, path: row.path, plan: p, dryRun },
      };
    }

    // 按 seq 裁行：保留头行 + seq < fromSeq 的事件行；缺 seq 的行一律保留（不敢猜它的归属）。
    const kept = [lines[0]];
    let dropped = 0;
    for (let i = 1; i < lines.length; i += 1) {
      const seq = seqOfLine(lines[i]);
      if (seq === null || seq < p.fromSeq) kept.push(lines[i]);
      else dropped += 1;
    }
    if (dropped !== p.dropCount) {
      // 行级裁剪和事件级计划对不上，说明文件里有结构没被 loadSession 认出来：宁可停手。
      const msg = '裁剪结果与计划不一致（计划 ' + p.dropCount + ' 条、实际 ' + dropped + ' 条），已中止';
      return { ok: false, changed: false, summary: msg, error: msg, detail: { plan: p } };
    }

    const bytes = encodeSessionBytes(kept, { compression: decoded.compression });
    // 自校验：先把新字节解回来，行数/头行都对得上才可能落盘。
    const verify = decodeSession(bytes);
    const keptBack = splitLines(verify.text);
    if (keptBack.length !== kept.length || keptBack[0] !== kept[0]) {
      const msg = '重新编码后的自查失败（行数 ' + keptBack.length + '/' + kept.length + '），已中止未写入';
      return { ok: false, changed: false, summary: msg, error: msg, detail: { plan: p } };
    }

    const baseDetail = {
      sessionId: row.id,
      project: row.project,
      autoPicked: target.autoPicked === true,
      path: row.path,
      compression: decoded.compression,
      mode: p.mode,
      fromSeq: p.fromSeq,
      toSeq: p.toSeq,
      text: p.text,
      turns: p.dropTurns,
      linesBefore: lines.length,
      linesAfter: kept.length,
      eventsBefore: p.eventsBefore,
      eventsAfter: p.eventsAfter,
      leavesOpenTurn: p.leavesOpenTurn,
      bytesBefore: buffer.length,
      bytesAfter: bytes.length,
      sha256Before: sha256(buffer),
      sha256After: sha256(bytes),
      plan: p,
    };

    // dry-run 放在活跃闸门之前：它一个字节都不写，用户在"会话还开着"时更需要先看清要砍什么。
    // 但仍把闸门结论带出来（wouldRefuse），免得用户以为真跑一次也会成功。
    if (dryRun) {
      const probe = activeProbe(row);
      return {
        ok: true,
        changed: false,
        summary: '[dry-run] 将截掉 seq ' + p.fromSeq + '..' + p.toSeq + '（' + p.dropCount + ' 事件 / '
          + (lines.length - kept.length) + ' 行），' + lines.length + ' → ' + kept.length + ' 行，未写盘',
        detail: {
          ...baseDetail,
          dryRun: true,
          backupDir: null,
          writeMode: null,
          ageMs: probe.ageMs,
          active: !probe.ok,
          wouldRefuse: probe.ok ? null : probe.error,
        },
      };
    }

    // 真写之前的两道闸门：mtime 新近度 + 200ms 内有没有继续长。宿主握着写句柄时改文件必踩半截状态。
    const forced = opts.force === true;
    const probe = activeProbe(row);
    if (!probe.ok && !forced) {
      return {
        ok: false,
        changed: false,
        summary: probe.error,
        error: probe.error,
        detail: { sessionId: row.id, path: row.path, ageMs: probe.ageMs, plan: p },
      };
    }
    const reprobe = forced ? { ok: true } : activeReprobe(row, probe);
    if (!reprobe.ok) {
      return {
        ok: false,
        changed: false,
        summary: reprobe.error,
        error: reprobe.error,
        detail: { sessionId: row.id, path: row.path, plan: p },
      };
    }

    const backup = makeBackup(ctx, row, buffer, basename(row.path));
    if (!backup.identical) {
      // 备份和原文对不上就不许继续——回退能力的前提是"一定退得回去"。
      const msg = '备份校验失败（sha256 不一致），已中止未写入：' + backup.dir;
      return { ok: false, changed: false, summary: msg, error: msg, detail: { ...baseDetail, backupDir: backup.dir } };
    }

    let writeMode = '';
    try {
      writeMode = publish(row.path, bytes);
    } catch (e) {
      const msg = '写入会话文件失败（备份在 ' + backup.dir + '）：' + errText(e);
      return { ok: false, changed: false, summary: msg, error: msg, detail: { ...baseDetail, backupDir: backup.dir } };
    }

    // 落盘后再读一遍核对：不一致就立刻用备份还原，并把现场交出来。
    let afterSha = '';
    let afterLines = -1;
    try {
      const afterBuf = readFileSync(row.path);
      afterSha = sha256(afterBuf);
      afterLines = splitLines(decodeSession(afterBuf).text).length;
    } catch (e) {
      afterSha = 'read-error:' + errText(e);
    }
    if (afterLines !== kept.length || afterSha !== baseDetail.sha256After) {
      let restored = false;
      try { copyFileSync(backup.file, row.path); restored = true; } catch { restored = false; }
      const msg = '写入后校验不通过（行 ' + afterLines + '/' + kept.length + '），'
        + (restored ? '已用备份还原' : '还原失败，请手工从 ' + backup.dir + ' 复制回去');
      return { ok: false, changed: false, summary: msg, error: msg, detail: { ...baseDetail, backupDir: backup.dir, writeMode, restored } };
    }

    const manifest = {
      tool: 'autokill-purge/web/ops/rewind',
      at: new Date().toISOString(),
      sessionId: row.id,
      project: row.project,
      sourcePath: row.path,
      backupFile: basename(backup.file),
      writeMode,
      plan: { mode: p.mode, fromSeq: p.fromSeq, toSeq: p.toSeq, dropCount: p.dropCount, turns: p.dropTurns, text: p.text },
      before: { sha256: backup.sha256Source, sizeBytes: buffer.length, lines: lines.length },
      after: { sha256: afterSha, sizeBytes: bytes.length, lines: kept.length },
      backup: { sha256: backup.sha256Backup, sizeBytes: backup.sizeBytes, identical: backup.identical },
      host: { node: process.version, platform: process.platform, release: process.release && process.release.name },
    };
    try {
      writeFileSync(join(backup.dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    } catch { /* manifest 只是凭证，写不进去不影响已经成功的回退 */ }

    if (typeof ctx.log === 'function') {
      ctx.log('[rewind] ' + row.id + ' ' + p.mode + ' fromSeq=' + p.fromSeq
        + ' 删 ' + p.dropCount + ' 事件（' + lines.length + '→' + kept.length + ' 行）备份 ' + backup.dir);
    }

    return {
      ok: true,
      changed: true,
      summary: '已回退 ' + row.id.slice(0, 18) + '：截掉 seq ' + p.fromSeq + '..' + p.toSeq
        + '（' + p.dropCount + ' 事件），' + lines.length + ' → ' + kept.length + ' 行，备份 ' + basename(backup.dir),
      detail: {
        ...baseDetail,
        dryRun: false,
        backupDir: backup.dir,
        backupFile: backup.file,
        manifest: join(backup.dir, 'manifest.json'),
        writeMode,
        sha256AfterWrite: afterSha,
      },
    };
  } catch (e) {
    // 契约要求：不抛裸异常给路由。
    const msg = errText(e);
    return { ok: false, changed: false, summary: '会话回退失败：' + msg, error: msg };
  }
}
