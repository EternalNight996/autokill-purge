// web/ops/instruction-inject.mjs —— 指令层注入（<dshHome>/AGENTS.md · 免重启）
//
// 为什么是这条路：DSH 原生 dsh-agent-instructions 在每个 agent step 之前读
//   <dshHome>/AGENTS.md（用户全局）与项目的 AGENTS.md / CLAUDE.md，
// 以 source.kind='agent-instructions' 的用户消息注入模型上下文。写文件即生效，
// 不改宿主、不重启客户端 —— 这是「不重启 dsh」的注入通道。
// 预算：dsh-base 的 agent-instructions 配了 maxBytes=65536（UTF-8），超了会被截断，这里先挡。
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, statSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const BEGIN = '<!-- autokill-purge:agents:begin -->';
const END = '<!-- autokill-purge:agents:end -->';
const MAX_BYTES = 65536;

export const META = {
  id: 'instruction-inject',
  zh: '指令层注入（AGENTS.md · 免重启）',
  en: 'Instruction-layer injection (AGENTS.md, no restart)',
  kind: 'write',
  requires: ['dsh-home'],
  note: '写 <dshHome>/AGENTS.md 的注入块：DSH 每个 agent step 前读取并以 agent-instructions 消息注入，不重启客户端即生效。',
};

function targetPath(ctx, opts = {}) {
  const home = String((opts && opts.dshHome) || (ctx && ctx.dshHome) || '');
  return home ? join(home, 'AGENTS.md') : '';
}

function readText(file) {
  try { return readFileSync(file, 'utf8'); } catch { return null; }
}

/** 默认模板：仓库里那份破甲模板（和「载荷」用的是同一份文本） */
function defaultTemplate() {
  const t = readText(join(ROOT, 'web', 'prompts', 'sauce-1171.md'));
  return t == null ? '' : t;
}

/** 摘掉我们自己的块，保留用户原有内容（幂等：没有块就原样返回） */
function stripBlock(text) {
  const src = String(text || '');
  const i = src.indexOf(BEGIN);
  if (i < 0) return { text: src, found: false };
  const j = src.indexOf(END, i);
  if (j < 0) return { text: src, found: false, broken: true };
  const rest = src.slice(0, i) + src.slice(j + END.length);
  return { text: rest.replace(/\n{3,}/g, '\n\n').trimEnd(), found: true };
}

function blockOf(text) {
  return BEGIN + '\n' + String(text || '').replace(/\r\n/g, '\n').trim() + '\n' + END;
}

function backupOf(ctx, file) {
  const src = readText(file);
  if (src == null) return null;
  const stamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
  const dir = join(String(ctx.dataDir || '.'), 'instruction-backups', stamp);
  mkdirSync(dir, { recursive: true });
  const dst = join(dir, 'AGENTS.md');
  copyFileSync(file, dst);
  return dst;
}

export async function status(ctx) {
  const file = targetPath(ctx);
  const home = String((ctx && ctx.dshHome) || '');
  const text = file ? readText(file) : null;
  const exists = text != null;
  const hasBlock = exists && text.includes(BEGIN) && text.includes(END);
  let blockBytes = 0;
  if (hasBlock) {
    const i = text.indexOf(BEGIN), j = text.indexOf(END, i) + END.length;
    blockBytes = Buffer.byteLength(text.slice(i, j), 'utf8');
  }
  const tpl = defaultTemplate();
  const summary = !home
    ? '找不到 dshHome'
    : hasBlock
      ? 'AGENTS.md 已含注入块（下一步生效，免重启）· ' + blockBytes + 'B'
      : exists
        ? 'AGENTS.md 存在，但还没有注入块'
        : 'AGENTS.md 未创建';
  return {
    ok: true,
    available: !!home && existsSync(home),
    summary,
    detail: {
      path: file || null,
      exists,
      hasBlock,
      bytes: exists ? Buffer.byteLength(text, 'utf8') : 0,
      blockBytes,
      templateBytes: Buffer.byteLength(tpl, 'utf8'),
      limitBytes: MAX_BYTES,
      form: 'AGENTS.md · agent-instructions · 免重启',
    },
  };
}

export async function plan(ctx, opts = {}) {
  const file = targetPath(ctx, opts);
  const action = opts.action === 'remove' ? 'remove' : 'apply';
  const text = String(opts.text || '').trim() ? String(opts.text) : defaultTemplate();
  const steps = [];
  steps.push({ id: 'backup', zh: '备份现有 AGENTS.md 到 data/instruction-backups/', runnable: true });
  if (action === 'remove') steps.push({ id: 'strip', zh: '摘掉 autokill-purge 注入块（用户内容保留）', runnable: true });
  else {
    steps.push({ id: 'write', zh: '写注入块（保留用户原有内容；mode=' + (opts.mode === 'replace' ? 'replace' : 'append') + '）', runnable: true });
    steps.push({ id: 'verify', zh: '读回核对标记与字节数', runnable: true });
  }
  return { ok: true, plan: { action, path: file || null, textBytes: Buffer.byteLength(text, 'utf8'), limitBytes: MAX_BYTES, steps } };
}

export async function run(ctx, opts = {}) {
  const file = targetPath(ctx, opts);
  if (!file) return { ok: false, changed: false, summary: '找不到 dshHome，无法确定 AGENTS.md 路径', error: 'no_dsh_home' };
  const action = opts.action === 'remove' ? 'remove' : 'apply';
  const dryRun = opts.dryRun === true;
  const mode = opts.mode === 'replace' ? 'replace' : 'append';
  const cur = readText(file);
  const stripped = stripBlock(cur == null ? '' : cur);
  let next = '';
  if (action === 'remove') {
    if (!stripped.found) return { ok: true, changed: false, summary: 'AGENTS.md 里没有注入块，什么都没改', detail: { path: file } };
    next = stripped.text ? stripped.text + '\n' : '';
  } else {
    const text = String(opts.text || '').trim() ? String(opts.text) : defaultTemplate();
    if (!text.trim()) return { ok: false, changed: false, summary: '没有可写的注入文本（模板读不到）', error: 'empty_text' };
    const block = blockOf(text);
    const bytes = Buffer.byteLength(block, 'utf8') + Buffer.byteLength(stripped.text || '', 'utf8');
    if (bytes > MAX_BYTES) {
      return { ok: false, changed: false, summary: '注入块 ' + Buffer.byteLength(block, 'utf8') + 'B 超出 DSH 指令预算 ' + MAX_BYTES + 'B（会被截断）', error: 'too_large', detail: { bytes, limitBytes: MAX_BYTES } };
    }
    if (mode === 'replace') next = block + '\n';
    else next = stripped.text && stripped.text.trim() ? stripped.text.trimEnd() + '\n\n' + block + '\n' : block + '\n';
  }
  const unchanged = cur != null && next === cur;
  if (unchanged) return { ok: true, changed: false, summary: '内容未变，跳过写入', detail: { path: file } };
  if (dryRun) return { ok: true, changed: false, summary: '预览：将' + (action === 'remove' ? '移除注入块' : '写入注入块') + '（未落盘）', detail: { path: file, bytes: Buffer.byteLength(next, 'utf8') } };
  const backup = backupOf(ctx, file);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, next, 'utf8');
  const check = readText(file);
  const ok = action === 'remove'
    ? !(check || '').includes(BEGIN)
    : (check || '').includes(BEGIN) && (check || '').includes(END);
  const summary = action === 'remove'
    ? '已移除 AGENTS.md 注入块（' + Buffer.byteLength(next, 'utf8') + 'B 保留）· 下一步不再注入'
    : '已写入 AGENTS.md 指令层（' + Buffer.byteLength(next, 'utf8') + 'B）· 下一步 agent step 生效，无需重启';
  return { ok, changed: true, summary, detail: { path: file, bytes: Buffer.byteLength(next, 'utf8'), backup, verified: ok, action, mode } };
}
