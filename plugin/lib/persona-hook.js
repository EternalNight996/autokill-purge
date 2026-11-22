// plugin/lib/persona-hook.js —— 人格层的「每轮实时注入」+「按会话隔离」
//
// 数据布局（都在 $DSH_HOME/autokill-purge/ 下）：
//   persona-current.json  { ids, block, at }                 —— 全局默认（新会话用，可按需留空）
//   persona-sessions.json { "<sessionId>": { ids, block, at } } —— 每个会话自己的选择（优先）
//   persona-active.json   { sid, at }                         —— 最近活跃会话（控制台据此把选择写进该会话）
//
// 注入优先级：sessions[sid] ＞ persona-current.json ＞ 无人格（默认对话不注入任何人格）。
// 去重：assembled 里已经有 persona:begin（宿主通过 AGENTS.md 注入）就不再补。
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import os from 'node:os';

const MARK = 'persona:begin';

function dataDir() {
  const home = process.env.DSH_HOME || join(os.homedir(), '.dsh');
  return join(home, 'autokill-purge');
}
function readJson(name) {
  try {
    const f = join(dataDir(), name);
    if (!existsSync(f)) return null;
    return JSON.parse(readFileSync(f, 'utf8'));
  } catch { return null; }
}
function writeJson(name, obj) {
  try {
    const f = join(dataDir(), name);
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  } catch { /* ignore */ }
}

export function personaSelectionFile() { return join(dataDir(), 'persona-current.json'); }

/** 当前会话的选择（没有就回落全局），返回 null 表示这个会话不该有人格 */
export function resolvePersonaBlock(sid, fallbackSid) {
  const sessions = readJson('persona-sessions.json') || {};
  const keys = [sid, fallbackSid].filter(Boolean);
  for (const k of keys) {
    if (sessions[k] && typeof sessions[k].block === 'string' && sessions[k].block.includes(MARK)) {
      return { block: sessions[k].block, ids: sessions[k].ids || [], scope: 'session', sid: k };
    }
  }
  const global = readJson('persona-current.json');
  if (global && typeof global.block === 'string' && global.block.includes(MARK)) {
    return { block: global.block, ids: global.ids || [], scope: 'global' };
  }
  return null;
}

function hasPersonaSection(assembled) {
  try {
    return (assembled.sections || []).some((s) => String((s && s.text) || '').includes(MARK));
  } catch { return false; }
}

/** 会话 id 的多种可能位置：不同宿主版本把它放在不同层 */
function sessionIdOf(session) {
  if (!session) return '';
  const tries = [
    session.id,
    session.sessionId,
    session.header && session.header.id,
    session.header && session.header.sessionId,
    session.meta && session.meta.id,
    session.record && session.record.id,
    session.key,
  ];
  for (const t of tries) {
    const v = String(t || '').trim();
    if (v && v.length > 3) return v;
  }
  return '';
}

/** 用 session.header 的稳定字段拼一个降级 id（拿不到真 id 时不至于全退化成全局） */
function fallbackIdOf(session) {
  const h = (session && session.header) || {};
  const parts = [h.cwd, h.createdAt || h.created || h.startedAt, h.origin].filter(Boolean);
  if (!parts.length) return '';
  const raw = parts.join('|');
  let hash = 0;
  for (let i = 0; i < raw.length; i++) hash = (hash * 31 + raw.charCodeAt(i)) >>> 0;
  return 'h' + hash.toString(36);
}

export function injectPersonaInto(assembled, context) {
  if (!assembled || !Array.isArray(assembled.sections)) return assembled;
  let session = null;
  try { session = context && context.agent && context.agent.session; } catch { session = null; }
  const picked = resolvePersonaBlock(sessionIdOf(session), fallbackIdOf(session));
  if (!picked) return assembled;
  if (hasPersonaSection(assembled)) return assembled;   // 宿主已通过 AGENTS.md 注入同一块
  const sections = assembled.sections.slice();
  sections.push({ name: 'autokill-purge:persona', text: picked.block });
  return { ...assembled, sections };
}

export function installPersonaAssemble(ctx, log = () => {}) {
  try {
    ctx.on('system-prompt/assemble', async (...args) => {
      const [assembly, context] = args;
      const next = args.length >= 3 ? args[args.length - 1] : null;
      let session = null;
      try { session = context && context.agent && context.agent.session; } catch { session = null; }
      const sid = sessionIdOf(session);
      // 记录"最近活跃会话"：控制台/下拉据此把人格写进这个会话，而不是全局
      const fb = fallbackIdOf(session);
      if (sid) writeJson('persona-active.json', { sid, fallback: fb || null, at: new Date().toISOString() });
      else if (session) {
        // 拿不到 id 时把结构写下来，方便定位（只写一次）
        const probeFile = join(dataDir(), 'persona-probe.json');
        if (!existsSync(probeFile)) {
          try {
            mkdirSync(dataDir(), { recursive: true });
            writeFileSync(probeFile, JSON.stringify({
              at: new Date().toISOString(),
              sessionKeys: Object.keys(session || {}),
              headerKeys: Object.keys((session && session.header) || {}),
              header: (session && session.header) || null,
            }, null, 2) + '\n', 'utf8');
          } catch { /* ignore */ }
        }
      }
      let assembled = assembly;
      if (typeof next === 'function') {
        try { assembled = await next(); } catch { assembled = assembly; }
      }
      try {
        const before = hasPersonaSection(assembled);
        const out = injectPersonaInto(assembled, context);
        const after = hasPersonaSection(out);
        if (!before && after) log('persona: injected for session ' + (sid || '(unknown)'));
        return out;
      } catch { return assembled; }
    }, { global: true });
    return true;
  } catch { return false; }
}
