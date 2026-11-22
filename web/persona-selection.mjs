// web/persona-selection.mjs —— 人格选择文件（控制台写，插件读）
//
// 放在 ~/.dsh/autokill-purge/persona-current.json：
//   { ids: [...], block: "<!-- persona:begin ... -->...", at: "..." }
// 插件在 system-prompt/assemble 时读它补注入（AGENTS.md 要等宿主读文件，这条路是每轮即时）。
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { dshHome } from './platform.mjs';

export function personaSelectionFile() {
  return join(dshHome(), 'autokill-purge', 'persona-current.json');
}

export async function writePersonaSelection(dataDir, { ids, block }) {
  const f = personaSelectionFile();
  await mkdir(join(dshHome(), 'autokill-purge'), { recursive: true });
  await writeFile(f, JSON.stringify({
    ids: Array.isArray(ids) ? ids : [],
    block: String(block || ''),
    at: new Date().toISOString(),
  }, null, 2) + '\n', 'utf8');
  return f;
}

export async function readPersonaSelection() {
  const f = personaSelectionFile();
  if (!existsSync(f)) return null;
  try { return JSON.parse(await readFile(f, 'utf8')); } catch { return null; }
}

export async function clearPersonaSelection() {
  const f = personaSelectionFile();
  if (existsSync(f)) { try { await rm(f, { force: true }); } catch { /* ignore */ } }
  return f;
}
