// logbus.mjs —— UI 级系统日志（参考 etest 的日志窗口：级别过滤 / 搜索 / 标签 / 实时 / 暂停 / 导出）
//
// 设计取舍：
//   · 环形缓冲（默认 3000 条）常驻内存，SSE 实时推给前端，历史按 since 拉取；
//   · 同时按天落盘 data/logs/app-YYYYMMDD.log（桌面壳崩了也能查），落盘失败不影响内存缓冲；
//   · console.* 与 process.stdout/stderr 的原始输出被镜像进来（tag=console / stderr），
//     这样第三方库的报错也能在 UI 里看见。
import { appendFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

export const LEVELS = ['debug', 'info', 'warn', 'error'];
const LEVEL_RANK = { debug: 10, info: 20, warn: 30, error: 40 };

const CAP = Number(process.env.PURGE_LOG_CAP || 3000);
const buffer = [];
let seq = 0;
let dir = null;
let currentDay = '';
let fileLines = 0;
const subs = new Set();
let wrapped = false;

function dayKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate());
}

function fmtTs(ts) {
  const d = new Date(ts);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) + '.' + p(d.getMilliseconds(), 3);
}

/** 初始化落盘目录；失败只记一条 warn，不影响内存日志 */
export function attach(options = {}) {
  try {
    dir = options.dir || dir;
    if (!dir) return { ok: false, error: 'no_dir' };
    mkdirSync(dir, { recursive: true });
    pruneOld(dir, options.keepDays || 14);
    return { ok: true, dir };
  } catch (e) {
    dir = null;
    return { ok: false, error: String((e && e.message) || e) };
  }
}

function pruneOld(d, keepDays) {
  try {
    const files = readdirSync(d).filter((n) => /^app-\d{8}\.log$/.test(n)).sort();
    for (const f of files.slice(0, Math.max(0, files.length - keepDays))) {
      try { unlinkSync(join(d, f)); } catch { /* 占用就留到下次 */ }
    }
  } catch { /* ignore */ }
}

function toFile(entry) {
  if (!dir) return;
  try {
    const day = dayKey(new Date(entry.ts));
    if (day !== currentDay) { currentDay = day; fileLines = 0; }
    appendFileSync(join(dir, 'app-' + day + '.log'), entry.ts + ' [' + entry.level + '] [' + entry.tag + '] ' + entry.msg + (entry.extra ? ' ' + JSON.stringify(entry.extra) : '') + '\n', 'utf8');
    fileLines += 1;
  } catch { /* 落盘失败不挡内存 */ }
}

/** 写一条日志：push('info', 'host.apply', 'applied 79/83', { ms: 812 }) */
export function push(level, tag, msg, extra) {
  const lv = LEVELS.includes(level) ? level : 'info';
  const entry = {
    id: ++seq,
    ts: Date.now(),
    at: fmtTs(Date.now()),
    level: lv,
    tag: String(tag || 'app'),
    msg: String(msg ?? ''),
    ...(extra && typeof extra === 'object' ? { extra } : {}),
  };
  buffer.push(entry);
  if (buffer.length > CAP) buffer.splice(0, buffer.length - CAP);
  toFile(entry);
  for (const fn of subs) {
    try { fn(entry); } catch { /* 单个订阅者坏了不影响其它 */ }
  }
  return entry;
}

export function info(tag, msg, extra) { return push('info', tag, msg, extra); }
export function warn(tag, msg, extra) { return push('warn', tag, msg, extra); }
export function error(tag, msg, extra) { return push('error', tag, msg, extra); }
export function debug(tag, msg, extra) { return push('debug', tag, msg, extra); }

/** 历史查询：since=id 之后；level 为该级别及以上；q 命中 msg/tag */
export function query({ since = 0, limit = 500, level = '', q = '', tag = '' } = {}) {
  const minRank = LEVEL_RANK[level] || 0;
  const needle = String(q || '').trim().toLowerCase();
  const out = [];
  for (let i = buffer.length - 1; i >= 0; i -= 1) {
    const e = buffer[i];
    if (e.id <= since) break;
    if (minRank && LEVEL_RANK[e.level] < minRank) continue;
    if (tag && e.tag !== tag) continue;
    if (needle && !(e.msg.toLowerCase().includes(needle) || e.tag.toLowerCase().includes(needle))) continue;
    out.push(e);
    if (out.length >= limit) break;
  }
  return out.reverse();
}

export function stats() {
  const byLevel = { debug: 0, info: 0, warn: 0, error: 0 };
  for (const e of buffer) byLevel[e.level] = (byLevel[e.level] || 0) + 1;
  return { total: seq, buffered: buffer.length, cap: CAP, byLevel, dir, fileLines, subs: subs.size };
}

export function tags() {
  const s = new Set();
  for (const e of buffer) s.add(e.tag);
  return [...s].sort();
}

export function clear() {
  const n = buffer.length;
  buffer.length = 0;
  return { cleared: n, seq };
}

export function exportText({ limit = 3000 } = {}) {
  return buffer.slice(-limit).map((e) => e.at + ' [' + e.level + '] [' + e.tag + '] ' + e.msg + (e.extra ? ' ' + JSON.stringify(e.extra) : '')).join('\n') + '\n';
}

export function subscribe(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}

/** 把 console.* / stdout / stderr 镜像进日志（幂等） */
export function mirrorStdio() {
  if (wrapped) return;
  wrapped = true;
  const wrap = (name, level, tag) => {
    const orig = console[name] ? console[name].bind(console) : null;
    console[name] = (...args) => {
      try {
        push(level, tag, args.map((a) => (typeof a === 'string' ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })())).join(' '));
      } catch { /* ignore */ }
      if (orig) orig(...args);
    };
  };
  wrap('log', 'info', 'console');
  wrap('info', 'info', 'console');
  wrap('warn', 'warn', 'console');
  wrap('error', 'error', 'console');
  const hook = (stream, level, tag) => {
    if (!stream || typeof stream.write !== 'function') return;
    const orig = stream.write.bind(stream);
    stream.write = (chunk, ...rest) => {
      try {
        const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
        for (const line of text.split(/\r?\n/)) {
          if (line.trim()) push(level, tag, line.slice(0, 2000));
        }
      } catch { /* ignore */ }
      return orig(chunk, ...rest);
    };
  };
  hook(process.stdout, 'info', 'stdout');
  hook(process.stderr, 'error', 'stderr');
}

/** 请求日志中间件：方法 / 路径 / 状态 / 耗时；静态资源走 debug */
export function requestLogger(req, res) {
  const start = Date.now();
  const url = String(req.url || '/');
  const isStatic = /\.(js|css|png|ico|svg|woff2?|map)(\?|$)/.test(url);
  res.on('finish', () => {
    const ms = Date.now() - start;
    const path = url.split('?')[0];
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : isStatic ? 'debug' : 'info';
    push(level, 'http', req.method + ' ' + path + ' → ' + res.statusCode, { ms });
  });
  return res;
}

export function fileSizeInfo() {
  if (!dir) return null;
  try {
    const files = readdirSync(dir).filter((n) => /^app-\d{8}\.log$/.test(n));
    return { files: files.length, bytes: files.reduce((a, n) => a + statSync(join(dir, n)).size, 0) };
  } catch { return null; }
}
