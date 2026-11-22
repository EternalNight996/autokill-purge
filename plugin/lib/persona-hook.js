// plugin/lib/persona-hook.js —— 人格层的「实时注入」通路
//
// 为什么要这一层：
//   AGENTS.md 是宿主的 project_instructions 通道，可靠但**只在会话开始/重挂时读取**，
//   用户选完人格后当前这一轮还是旧提示 → 看起来「没换上」。
//   这里在 system-prompt/assemble 钩子里，每轮组装前再检查一次选择文件：
//     · 选择文件里有人格块 → 若 assembled 还没有 persona:begin（说明 AGENTS.md 没被读到），就补进去
//     · assembled 已经有（AGENTS.md 生效）→ 什么都不做，避免重复
//   这样「选完 → 下一句就是」不依赖宿主读文件时机，也不会写任何宿主文件。
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';

const MARK = 'persona:begin';

function dshHome() {
  return process.env.DSH_HOME || join(os.homedir(), '.dsh');
}

/** 人格选择文件：与控制台共用（控制台 apply 时写，插件每轮读） */
export function personaSelectionFile() {
  return join(dshHome(), 'autokill-purge', 'persona-current.json');
}

export function readPersonaSelection() {
  try {
    const f = personaSelectionFile();
    if (!existsSync(f)) return null;
    const j = JSON.parse(readFileSync(f, 'utf8'));
    if (!j || typeof j.block !== 'string' || !j.block.includes(MARK)) return null;
    return j;
  } catch { return null; }
}

function hasPersonaSection(assembled) {
  try {
    return (assembled.sections || []).some((s) => String((s && s.text) || '').includes(MARK));
  } catch { return false; }
}

/** 把人格块补进 assembled（已经是新对象，不改原对象） */
export function injectPersonaInto(assembled, context) {
  const sel = readPersonaSelection();
  if (!sel) return assembled;
  if (!assembled || !Array.isArray(assembled.sections)) return assembled;
  if (hasPersonaSection(assembled)) return assembled;   // AGENTS.md 那条路已经注入了
  // 会话级：选择文件里可用 sessions[sessionId] 覆盖全局
  let block = sel.block;
  try {
    const sid = context && context.agent && context.agent.session && context.agent.session.id;
    if (sid && sel.sessions && typeof sel.sessions[sid] === 'string' && sel.sessions[sid].includes(MARK)) {
      block = sel.sessions[sid];
    }
  } catch { /* 拿不到 session 就用全局 */ }
  const sections = assembled.sections.slice();
  sections.push({ name: 'autokill-purge:persona', text: block });
  return { ...assembled, sections };
}

/** 注册 assemble 钩子；返回 disposer 由 ctx.effect 管 */
export function installPersonaAssemble(ctx, log = () => {}) {
  try {
    ctx.on('system-prompt/assemble', async (...args) => {
      const [assembly, context] = args;
      const next = args.length >= 3 ? args[args.length - 1] : null;
      let assembled = assembly;
      if (typeof next === 'function') {
        try { assembled = await next(); } catch { assembled = assembly; }
      }
      try {
        const before = hasPersonaSection(assembled);
        const out = injectPersonaInto(assembled, context);
        const after = hasPersonaSection(out);
        if (!before && after) log('persona: injected into system prompt');
        return out;
      } catch { return assembled; }
    }, { global: true });
    return true;
  } catch { return false; }
}
