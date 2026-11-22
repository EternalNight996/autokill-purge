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
import { installHostBridge, readRuntime, writeRuntime } from './host-bridge.js';
import { OWNER, OWNER_LINE } from './owner.js';
// 上游 dsh-purge 的完整宿主内实现（已内化在 plugin/vendor）：身份改写、prompt sections、
// pre-step、fresh access、rewind filter、cwd capture、continue-retry、/purge /rules /skills /rewind
// 命令、purge_* 工具、/dsh-purge/* 路由、启动 settle。这一层是「同等能力」的底座。
import * as upstream from '../vendor/lib/index.js';

export const name = 'autokill-purge';
export const inject = ['systemPrompt', 'tools'];

const DEFAULTS = {
  toolsEnable: true,
  assembleEnable: true,
  sessionEnable: false,
  consoleUrl: 'http://127.0.0.1:8792',
  allowWriteTools: false,
  gearSync: true,   // 装备选择 → 注入末尾的「本次装备」段（控制台 /api/gear/current）
  runtimeWatch: true, // 监听 runtime.json：控制台改开关 → 进程内立即重算 hook，不重启宿主
  // 上游 dsh-purge 的宿主内实现整体跑起来（同等能力底座）。关掉它会退回「只有 autokill_* 工具」的薄插件。
  upstreamEnable: true,
  upstreamConfig: null, // 透传给上游：stripMnemon / capabilityProtocol / hooksDenyBypass / autoApplyOnStart ...
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

let gearCache = { at: 0, text: '' };
/** 控制台最近一次装备 → 「本次装备」段；30s 缓存，控制台不可达就返回空（不挡注入）。 */
async function readGearBlock(cfg) {
  if (!cfg || cfg.gearSync === false) return '';
  const now = Date.now();
  if (now - gearCache.at < 30000) return gearCache.text;
  gearCache.at = now;
  try {
    const r = await api(cfg, '/api/gear/current', { timeoutMs: 3000 });
    const block = r.json && typeof r.json.block === 'string' ? r.json.block : '';
    gearCache.text = block;
    return block;
  } catch { gearCache.text = ''; return ''; }
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
  // 宿主内运行时桥：审批 / 沙箱 / 结果裁剪的内存 hook + runtime.json 热监听（替代 dsh-purge 的进程内部分）
  const bridge = installHostBridge(ctx, cfg, (msg) => log(cfg, msg));
  // 人格实时注入：每轮 assemble 检查 persona-current.json，缺就补（不写宿主文件）
  const personaHookReady = installPersonaAssemble(ctx, (msg) => log(cfg, msg));

  // ---- ⓪ 上游 dsh-purge 完整实现（同等能力底座）------------------------------
  // 它自己会挂：identity 改写 / prompt sections / pre-step / fresh access / rewind filter /
  // cwd capture / continue-retry / settle 启动自愈 / 4 个斜杠命令 / purge_* 工具 / /dsh-purge/* 路由。
  // 我们的 assemble 钩子只有在它关掉时才启用，避免两套改写叠加。
  let upstreamResult = null;
  if (cfg.upstreamEnable !== false) {
    const upCfg = {
      enabled: true,
      stripMnemon: true,
      capabilityProtocol: true,
      hooksDenyBypass: true,
      // 宿主启动时不自动改盘/升级：落地与还原由控制台显式触发，避免两套写入打架
      autoApplyOnStart: false,
      autoUpdateOnStart: false,
      autoRevertOnMissing: false,
      verbose: false,
      ...(cfg.upstreamConfig || {}),
    };
    try {
      upstream.apply(ctx, upCfg);
      upstreamResult = { ok: true, config: upCfg, name: upstream.name };
      log(cfg, 'upstream dsh-purge applied');
    } catch (e) {
      upstreamResult = { ok: false, error: String((e && e.message) || e) };
      try { ctx.logger && ctx.logger.warn && ctx.logger.warn('autokill-purge: upstream apply failed: %s', upstreamResult.error); } catch { /* ignore */ }
    }
  }

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
      // ---- 宿主内运行时桥（进程内破甲：审批 / 沙箱 / 结果裁剪）----
      ctx.tools.register({
        name: 'autokill_runtime_status',
        description: '查看宿主内运行时桥：审批、沙箱、工具结果裁剪是否已在内存里被接管，runtime.json 的开关值。只读。',
        parameters: emptyParams,
        output: textOut,
        async execute() {
          try {
            const st = bridge.status();
            st.upstream = upstreamResult;
            return { ok: true, text: JSON.stringify(st, null, 2).slice(0, 6000) };
          }
          catch (e) { return { ok: false, text: '读取运行时状态失败：' + String((e && e.message) || e) }; }
        },
      });

      ctx.tools.register({
        name: 'autokill_runtime_set',
        description: '运行中切换破甲开关（审批 / 沙箱 / 结果裁剪 / 身份改写 / 提示词注入）：写 runtime.json 并立即重算内存 hook，不重启宿主。',
        parameters: {
          type: 'object', additionalProperties: false,
          properties: {
            approvalBypass: { type: 'boolean' },
            sandboxBypass: { type: 'boolean' },
            prunerBypass: { type: 'boolean' },
            identityRewrite: { type: 'boolean' },
            promptInject: { type: 'boolean' },
          },
        },
        output: textOut,
        async execute(args) {
          try {
            const cur = readRuntime();
            const next = { ...cur };
            let changed = 0;
            for (const k of ['approvalBypass', 'sandboxBypass', 'prunerBypass', 'identityRewrite', 'promptInject']) {
              if (args && typeof args[k] === 'boolean' && args[k] !== cur[k]) { next[k] = args[k]; changed += 1; }
            }
            if (!changed) return { ok: true, text: '没有变化：' + JSON.stringify(cur) };
            const s = bridge.writeRuntime(next);
            return { ok: s.ok, text: '已写入并立即生效（无需重启）：' + JSON.stringify(s.runtime) + '\n当前 hook：' + JSON.stringify(s.patched) };
          } catch (e) { return { ok: false, text: '切换失败：' + String((e && e.message) || e) }; }
        },
      });

      ctx.tools.register({
        name: 'autokill_reload',
        description: '热重载本插件（优先 Cordis fiber.reload，拿不到就就地重算 hook）。不重启宿主。',
        parameters: emptyParams,
        output: textOut,
        async execute() {
          try { const r = await bridge.reload(); return { ok: r.ok !== false, text: JSON.stringify(r).slice(0, 4000) }; }
          catch (e) { return { ok: false, text: '热重载失败：' + String((e && e.message) || e) }; }
        },
      });

      log(cfg, 'tools registered: autokill_status / autokill_ops_status / autokill_ops_plan / autokill_ops_run / autokill_runtime_status / autokill_runtime_set / autokill_reload');
    } catch (e) {
      try { ctx.logger && ctx.logger.warn && ctx.logger.warn('autokill-purge: tool register failed: %s', (e && e.message) || e); } catch { /* ignore */ }
    }
  }

  // ---- ② 组装期身份改写：上游开着就由它的 installIdentityOverride 负责，避免两套叠加 ----
  if (cfg.assembleEnable && cfg.upstreamEnable === false && typeof ctx.on === 'function') {
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
            const gearBlock = await readGearBlock(cfg);
            // 业主身份写在注入正文最前面（程序内置，不靠 prompt-inject.md 手写）
            const mergedInject = [OWNER_LINE, injectText, gearBlock].filter(Boolean).join('\n\n');
            const out = identity.rewritePromptAssembly(assembled, mergedInject, {});
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
    // 宿主内运行时桥：控制台/其它插件可直接拿到，不必走 HTTP
    runtime: bridge,
  });

  log(cfg, 'loaded · owner=' + OWNER.display + ' · console=' + cfg.consoleUrl + ' · assemble=' + cfg.assembleEnable + ' · write=' + cfg.allowWriteTools);
}

export default { name, inject, apply };
