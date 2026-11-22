// web/persona-selection.mjs —— 人格选择文件（控制台写，插件读）
//
// 三个文件都在 ~/.dsh/autokill-purge/：
//   persona-current.json   全局默认（新会话默认用；可为空）
//   persona-sessions.json  { "<sessionId>": { ids, names, block, at } } 每会话独立
//   persona-active.json    { sid, at } 最近活跃会话（由插件写入，控制台读取后把选择落到该会话）
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { dshHome } from './platform.mjs';

function dir() { return join(dshHome(), 'autokill-purge'); }
export function personaSelectionFile() { return join(dir(), 'persona-current.json'); }
export function personaSessionsFile() { return join(dir(), 'persona-sessions.json'); }
export function personaActiveFile() { return join(dir(), 'persona-active.json'); }

async function readJson(f) {
  if (!existsSync(f)) return null;
  try { return JSON.parse(await readFile(f, 'utf8')); } catch { return null; }
}
async function writeJson(f, obj) {
  await mkdir(dir(), { recursive: true });
  await writeFile(f, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  return f;
}

/** 最近活跃会话（插件每轮 assemble 写入） */
export async function readActiveSession() {
  const j = await readJson(personaActiveFile());
  if (!j || !j.sid) return null;
  return j;
}

export async function readPersonaSelection() { return readJson(personaSelectionFile()); }

/** 写全局默认 */
export async function writePersonaSelection(_dataDir, { ids, block }) {
  return writeJson(personaSelectionFile(), {
    ids: Array.isArray(ids) ? ids : [],
    block: String(block || ''),
    at: new Date().toISOString(),
  });
}

export async function clearPersonaSelection() {
  const f = personaSelectionFile();
  if (existsSync(f)) { try { await rm(f, { force: true }); } catch { /* ignore */ } }
  return f;
}

// ---------------------------------------------------------------- 会话级

export async function readPersonaSessions() { return (await readJson(personaSessionsFile())) || {}; }

export async function writePersonaSession(sid, { ids, names, block }) {
  if (!sid) return null;
  const all = await readPersonaSessions();
  all[sid] = {
    ids: Array.isArray(ids) ? ids : [],
    names: Array.isArray(names) ? names : [],
    block: String(block || ''),
    at: new Date().toISOString(),
  };
  await writeJson(personaSessionsFile(), all);
  return sid;
}

export async function clearPersonaSession(sid) {
  if (!sid) return null;
  const all = await readPersonaSessions();
  if (all[sid]) { delete all[sid]; await writeJson(personaSessionsFile(), all); }
  return sid;
}
