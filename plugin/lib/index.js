// autokill-purge 宿主内薄插件 v2
//
// 定位：把「外部控制台做不到」的三件事接进来，**不重写上游实现**：
//   ① 组装期身份改写  → 复用 dsh-purge/lib/identity.js 的 rewritePromptAssembly
//   ② 58 个 redteam_* → 复用 dsh-purge 的 redteam 单元（在 cordis.patch.yml 里 insert）
//   ③ 控制台能力给模型 → autokill_* 工具，HTTP 转调 127.0.0.1:8792
//
// 三大纪律：
//   1) 每个钩子都 try/catch + logger.warn，一个坏了不影响会话；
//   2) 与 dsh-purge 主单元并存时把 assembleEnable 关掉（两套改写会叠加）；
//   3) 写类工具默认拒绝（allowWriteTools=false），必须在控制台点确认。
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const name = 'autokill-purge';
export const inject = ['systemPrompt', 'tools'];

const DEFAULTS = {
  toolsEnable: true,
  assembleEnable: true,
  sessionEnable: false,
  consoleUrl: 'http://127.0.0.1:8792',
  allowWriteTools: false,
  verbose: false,
};

function log(cfg, msg) {
  if (cfg && cfg.verbose) {
    try { console.warn('[autokill-purge] ' + msg); } catch { /* ignore */ }
  }
}

async function api(cfg, path, options = {}) {
  const base = String((cfg && cfg.consoleUrl) || DEFAULTS.consoleUrl).replace(/\/+$/, '');
  const res = await fetch(base + path, {
    method: options.method || 'GET',
    headers: options.body ? { 'content-type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(options.timeoutMs || 20000),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 2000) }; }
  return { status: res.status, json };
}

/** identity.js 用本包内化的 vendor 版本（不依赖 dsh-purge 包）。 */
async function loadUpstreamIdentity() {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    return await import(pathToFileURL(join(here, '..', 'vendor', 'lib', 'identity.js')).href);
  } catch (e) {
    return { __error: String((e && e.message) || e) };
  }
}

/** 当前注入正文：DSH 原生就读这个文件，组装期改写以它为 fallbackInject。 */
function readInjectText() {
  try {
    const home = process.env.DSH_HOME || join(process.env.USERPROFILE || process.env.HOME || '', '.dsh');
    return readFileSync(join(home, 'prompt-inject.md'), 'utf8');
  } catch { return ''; }
}

const textOut = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: { text: { type: 'string' }, ok: { type: 'boolean' } },
  },
  render: (_args, value) => [{ type: 'text', text: String(value && value.text ? value.text : '') }],
};

const emptyParams = { type: 'object', additionalProperties: false, properties: {} };

export function apply(ctx, config) {
  const cfg = { ...DEFAULTS, ...(config || {}) };

  // ---- ① 控制台能力交给模型 ------------------------------------------------
  if (cfg.toolsEnable && ctx.tools && ctx.tools.register) {
    try {
      ctx.tools.register({
        name: 'autokill_status',
        description: '查看 autokill-purge 控制台状态：83 条宿主补丁 / 6 个能力 / 宿主是否已落地。只读。',
        parameters: emptyParams,
        output: textOut,
        async execute() {
          try {
            const [ops, host] = await Promise.all([api(cfg, '/api/ops'), api(cfg, '/api/host/status')]);
            const rows = ((ops.json && ops.json.ops) || []).map((o) => '- ' + o.id + ': ' + (o.available ? '可用' : '未就绪') + ' · ' + (o.summary || ''));
            const h = (host.json && host.json.available && host.json) || {};
            const c = h.counts || {};
            return { ok: true, text: '宿主补丁 ' + (c.applied || 0) + '/' + (c.total || 83) + ' · ' + (h.desktopSealed ? 'asar 仍密封（未生效）' : 'asar 已让位（生效）') + '\n' + rows.join('\n') };
          } catch (e) { return { ok: false, text: '控制台不可达：' + String((e && e.message) || e) }; }
        },
      });

      ctx.tools.register({
        name: 'autokill_ops_status',
        description: '查看某个补齐能力的详细状态（reapply / restart / plugin-install / identity / rewind / redteam-pack）。只读。',
        parameters: {
          type: 'object', additionalProperties: false, required: ['id'],
          properties: { id: { type: 'string', enum: ['reapply', 'restart', 'plugin-install', 'identity', 'rewind', 'redteam-pack'] } },
        },
        output: textOut,
        async execute(args) {
          try {
            const r = await api(cfg, '/api/ops/' + encodeURIComponent(String(args.id)) + '/status');
            const j = r.json || {};
            return { ok: j.ok !== false, text: (j.summary || '') + '\n' + JSON.stringify(j.detail || {}, null, 2).slice(0, 4000) };
          } catch (e) { return { ok: false, text: '读取失败：' + String((e && e.message) || e) }; }
        },
      });

      ctx.tools.register({
        name: 'autokill_ops_plan',
        description: '只读预览某个补齐能力将要做什么（不执行）。',
        parameters: {
          type: 'object', additionalProperties: false, required: ['id'],
          properties: { id: { type: 'string', enum: ['reapply', 'restart', 'plugin-install', 'identity', 'rewind', 'redteam-pack'] } },
        },
        output: textOut,
        async execute(args) {
          try {
            const r = await api(cfg, '/api/ops/' + encodeURIComponent(String(args.id)) + '/plan', { method: 'POST', body: {} });
            return { ok: r.json && r.json.ok !== false, text: JSON.stringify((r.json && r.json.plan) || r.json, null, 2).slice(0, 6000) };
          } catch (e) { return { ok: false, text: '预览失败：' + String((e && e.message) || e) }; }
        },
      });

      ctx.tools.register({
        name: 'autokill_ops_run',
        description: '执行某个补齐能力（会改盘/可能重启宿主）。默认被插件策略拒绝，需要 allowWriteTools=true。',
        parameters: {
          type: 'object', additionalProperties: false, required: ['id'],
          properties: { id: { type: 'string', enum: ['reapply', 'restart', 'identity', 'rewind', 'redteam-pack', 'plugin-install'] } },
        },
        output: textOut,
        async execute(args) {
          if (!cfg.allowWriteTools) return { ok: false, text: '插件策略拒绝：写类工具默认关闭（allowWriteTools=false）。请在控制台「能力补齐」里点执行。' };
          try {
            const r = await api(cfg, '/api/ops/' + encodeURIComponent(String(args.id)) + '/run', { method: 'POST', body: { confirm: true }, timeoutMs: 120000 });
            const j = r.json || {};
            return { ok: j.ok !== false, text: (j.summary || '') + (j.error ? ' · ' + j.error : '') };
          } catch (e) { return { ok: false, text: '执行失败：' + String((e && e.message) || e) }; }
        },
      });
      log(cfg, 'tools registered: autokill_status / autokill_ops_status / autokill_ops_plan / autokill_ops_run');
    } catch (e) {
      try { ctx.logger && ctx.logger.warn && ctx.logger.warn('autokill-purge: tool register failed: %s', (e && e.message) || e); } catch { /* ignore */ }
    }
  }

  // ---- ② 组装期身份改写：复用上游 rewritePromptAssembly ---------------------
  if (cfg.assembleEnable && typeof ctx.on === 'function') {
    (async () => {
      const identity = await loadUpstreamIdentity();
      if (identity.__error) {
        try { ctx.logger && ctx.logger.warn && ctx.logger.warn('autokill-purge: 上游 identity.js 不可用（%s），组装期改写关闭', identity.__error); } catch { /* ignore */ }
        return;
      }
      try {
        // 上游兼容写法：cordis 新签名 (assembly, context, next)，旧签名 (assembly, context)
        const off = ctx.on('system-prompt/assemble', async (...args) => {
          const [assembly, context] = args;
          const next = args.length >= 3 ? args[args.length - 1] : null;
          let assembled = assembly;
          if (typeof next === 'function') {
            try { assembled = await next(); } catch { assembled = assembly; }
          }
          try {
            const injectText = readInjectText();
            const out = identity.rewritePromptAssembly(assembled, injectText, {});
            return out || assembled;
          } catch (e) {
            try { ctx.logger && ctx.logger.warn && ctx.logger.warn('autokill-purge: assemble rewrite failed: %s', (e && e.message) || e); } catch { /* ignore */ }
            return assembled;
          }
        }, { global: true, prepend: true });
        if (typeof ctx.effect === 'function') ctx.effect(() => () => { try { typeof off === 'function' && off(); } catch { /* ignore */ } });
        log(cfg, 'assemble hook installed (upstream rewritePromptAssembly)');
      } catch (e) {
        try { ctx.logger && ctx.logger.warn && ctx.logger.warn('autokill-purge: assemble hook install failed: %s', (e && e.message) || e); } catch { /* ignore */ }
      }
    })();
  }

  // ---- ③ 会话钩子（默认关）-------------------------------------------------
  if (cfg.sessionEnable && typeof ctx.on === 'function') {
    try {
      const off = ctx.on('session/created', (session) => { log(cfg, 'session created: ' + String((session && session.id) || '?')); });
      if (typeof ctx.effect === 'function') ctx.effect(() => () => { try { typeof off === 'function' && off(); } catch { /* ignore */ } });
    } catch { /* ignore */ }
  }

  if (typeof ctx.provide === 'function') ctx.provide('autokillPurge', {
    async restart() {
      const runtime = typeof ctx.desktopRuntime === 'object' ? ctx.desktopRuntime : null;
      if (!runtime || typeof runtime.requestRestart !== 'function') return { ok: false, error: 'desktopRuntime 不可用' };
      try { await runtime.requestRestart(); return { ok: true }; } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
    },
  });

  log(cfg, 'loaded · console=' + cfg.consoleUrl + ' · assemble=' + cfg.assembleEnable + ' · write=' + cfg.allowWriteTools);
}

export default { name, inject, apply };
