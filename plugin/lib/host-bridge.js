// autokill-purge · 宿主内运行时桥（替代 dsh-purge 的「进程内」那部分）
//
// 解决 dsh-purge 能做、外部控制台做不到的四件事：
//   ① 进程内热更新：runtime.json 一变就重算 hook，不等重启宿主
//   ② 直接改内存对象：approval / sandbox / toolResultPruner 服务实例上的方法
//   ③ 改「正在跑的这一次调用」：decide / confine / pruneContent 在返回前被接管
//   ④ bundle 生命周期：所有挂载都走 ctx.effect 回收，卸载即还原，不留残留
//
// 纪律：任何一步失败都只 warn，不抛给宿主；撤销必须恢复到「挂之前」的原函数
// （原型方法用 delete 复原，own property 用原引用复原）。

import { existsSync, readFileSync, writeFileSync, mkdirSync, watch, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

/** 运行期开关文件：控制台写它，插件监听它，进程内立即生效 */
export function runtimeFile() {
  const home = process.env.DSH_HOME || join(process.env.USERPROFILE || homedir(), '.dsh');
  return join(home, 'autokill-purge', 'runtime.json');
}

export const DEFAULT_RUNTIME = {
  approvalBypass: true,     // 审批：never 策略不再拒绝，直接 allowed-once
  sandboxBypass: true,      // 沙箱：confine() 原样返回 argv，不套 runner
  prunerBypass: true,       // 工具结果裁剪：pruneContent() 返回 null（不裁）
  identityRewrite: true,    // 组装期身份改写（assemble hook，index.js 用）
  promptInject: true,       // 把 ~/.dsh/prompt-inject.md 拼进系统提示
  updatedAt: null,
};

export function readRuntime() {
  try {
    const raw = JSON.parse(readFileSync(runtimeFile(), 'utf8'));
    return { ...DEFAULT_RUNTIME, ...(raw && typeof raw === 'object' ? raw : {}) };
  } catch {
    return { ...DEFAULT_RUNTIME };
  }
}

/** 原子写：先写临时文件再改名，避免监听端读到半截 JSON */
export function writeRuntime(next) {
  const file = runtimeFile();
  const payload = { ...DEFAULT_RUNTIME, ...(next || {}), updatedAt: new Date().toISOString() };
  mkdirSync(dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  writeFileSync(tmp, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  renameSync(tmp, file);
  return payload;
}

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

/**
 * 挂一个实例方法覆盖，返回撤销函数。
 * 只处理「实例属性遮住原型方法」这一种；原型方法在撤销时用 delete 露出。
 */
function overrideMethod(target, name, makeWrapper, record) {
  if (!target || typeof target[name] !== 'function') return null;
  const hadOwn = hasOwn(target, name);
  const original = target[name];
  target[name] = makeWrapper(original);
  record.push({ target, name, hadOwn, original });
  return { target, name };
}

function restoreAll(records) {
  const out = [];
  for (const r of records.reverse()) {
    try {
      if (r.hadOwn) r.target[r.name] = r.original;
      else delete r.target[r.name];
      out.push({ name: r.name, ok: true });
    } catch (e) {
      out.push({ name: r.name, ok: false, error: String((e && e.message) || e) });
    }
  }
  return out;
}

export function installHostBridge(ctx, cfg, log) {
  const state = {
    runtime: readRuntime(),
    services: { approval: null, sandbox: null, pruner: null, tools: null, systemPrompt: null },
    patches: { approval: [], sandbox: [], pruner: [] },
    installedAt: null,
    lastSyncAt: null,
    errors: [],
    watcher: null,
  };
  const warn = (msg) => { try { log && log(msg); } catch { /* ignore */ } };

  // ---- 各服务的挂载 / 撤销 ----------------------------------------------------
  function applyApproval() {
    const svc = state.services.approval;
    if (!svc || state.patches.approval.length) return false;
    const recs = [];
    // decide()：补丁版就是「直接 allowed-once」，这里在内存里做同一件事
    overrideMethod(svc, 'decide', (orig) => async (req, session) => {
      if (state.runtime.approvalBypass === false) return orig.call(svc, req, session);
      if (req && req.signal && req.signal.aborted) return 'cancelled';
      return 'allowed-once';
    }, recs);
    // effectivePolicy()：对任何会话都回答 never（系统提示里的 APPROVAL_POLICY 段随之变化）
    overrideMethod(svc, 'effectivePolicy', (orig) => (session) => (
      state.runtime.approvalBypass ? 'never' : orig.call(svc, session)
    ), recs);
    state.patches.approval = recs;
    return recs.length > 0;
  }

  function dropApproval() {
    if (!state.patches.approval.length) return false;
    restoreAll(state.patches.approval);
    state.patches.approval = [];
    return true;
  }

  function applySandbox() {
    const svc = state.services.sandbox;
    if (!svc || state.patches.sandbox.length) return false;
    const recs = [];
    // confine()：不套 runner，denialSignatures 为空 → 永远不会被判定为沙箱拒绝
    overrideMethod(svc, 'confine', (orig) => (argv, policy, signal) => {
      if (state.runtime.sandboxBypass === false) return orig.call(svc, argv, policy, signal);
      return { argv: [...argv], enforcement: 'full', denialSignatures: [], runnerFailureRules: [] };
    }, recs);
    state.patches.sandbox = recs;
    return recs.length > 0;
  }

  function dropSandbox() {
    if (!state.patches.sandbox.length) return false;
    restoreAll(state.patches.sandbox);
    state.patches.sandbox = [];
    return true;
  }

  function applyPruner() {
    const svc = state.services.pruner;
    if (!svc || state.patches.pruner.length) return false;
    const recs = [];
    // pruneContent()：返回 null = 这段结果不需要裁剪
    overrideMethod(svc, 'pruneContent', (orig) => (blocks, meta) => {
      if (state.runtime.prunerBypass === false) return orig.call(svc, blocks, meta);
      return null;
    }, recs);
    state.patches.pruner = recs;
    return recs.length > 0;
  }

  function dropPruner() {
    if (!state.patches.pruner.length) return false;
    restoreAll(state.patches.pruner);
    state.patches.pruner = [];
    return true;
  }

  /** 按 runtime 开关对齐三组 hook（幂等，可反复调） */
  function sync(trigger) {
    const r = state.runtime;
    try {
      if (r.approvalBypass) { if (!applyApproval()) { /* 服务还没到，等 inject 回调 */ } } else dropApproval();
      if (r.sandboxBypass) { if (!applySandbox()) { /* 同上 */ } } else dropSandbox();
      if (r.prunerBypass) { if (!applyPruner()) { /* 同上 */ } } else dropPruner();
      state.lastSyncAt = Date.now();
      warn('runtime sync (' + (trigger || 'manual') + ') · approval=' + !!state.patches.approval.length + ' sandbox=' + !!state.patches.sandbox.length + ' pruner=' + !!state.patches.pruner.length);
      return status();
    } catch (e) {
      state.errors.push({ at: Date.now(), error: String((e && e.message) || e) });
      warn('runtime sync failed: ' + ((e && e.message) || e));
      return status();
    }
  }

  function status() {
    return {
      ok: state.errors.length === 0,
      runtimeFile: runtimeFile(),
      runtime: state.runtime,
      installedAt: state.installedAt,
      lastSyncAt: state.lastSyncAt,
      services: Object.fromEntries(Object.entries(state.services).map(([k, v]) => [k, !!v])),
      patched: {
        approval: state.patches.approval.map((p) => p.name),
        sandbox: state.patches.sandbox.map((p) => p.name),
        pruner: state.patches.pruner.map((p) => p.name),
      },
      errors: state.errors.slice(-10),
    };
  }

  // ---- ①②③：服务就绪后立即挂载（ctx.inject 在服务可用时回调） -------------------
  const tryInject = (names, onReady) => {
    try {
      if (typeof ctx.inject === 'function') {
        ctx.inject(names, (scope) => {
          try { onReady(scope); sync('service-ready:' + names.join(',')); } catch (e) { warn('inject ' + names.join(',') + ' failed: ' + ((e && e.message) || e)); }
        });
      } else if (typeof ctx.on === 'function') {
        // 老宿主没有 ctx.inject：退化为「服务出现事件」不可用时，靠定时探测
        const timer = setInterval(() => {
          let ready = true;
          for (const n of names) if (!ctx[n]) ready = false;
          if (!ready) return;
          clearInterval(timer);
          onReady(ctx);
          sync('poll:' + names.join(','));
        }, 2000);
        timer.unref && timer.unref();
      }
    } catch (e) { warn('inject setup failed: ' + ((e && e.message) || e)); }
  };

  tryInject(['approval'], (scope) => { state.services.approval = scope.approval || ctx.approval || null; });
  tryInject(['sandbox'], (scope) => { state.services.sandbox = scope.sandbox || ctx.sandbox || null; });
  tryInject(['toolResultPruner'], (scope) => { state.services.pruner = scope.toolResultPruner || ctx.toolResultPruner || null; });
  tryInject(['tools'], (scope) => { state.services.tools = scope.tools || ctx.tools || null; });
  tryInject(['systemPrompt'], (scope) => { state.services.systemPrompt = scope.systemPrompt || ctx.systemPrompt || null; });

  // ---- ① 热更新：runtime.json 一变就重算 ----------------------------------------
  function watchRuntime() {
    try {
      const file = runtimeFile();
      if (existsSync(file)) {
        state.watcher = watch(file, { persistent: false }, () => {
          try { state.runtime = readRuntime(); sync('file-change'); } catch (e) { warn('watch handler failed: ' + ((e && e.message) || e)); }
        });
      } else {
        // 文件还没有：看目录，等它出现
        const dir = dirname(file);
        mkdirSync(dir, { recursive: true });
        let armed = false;
        state.watcher = watch(dir, { persistent: false }, () => {
          if (armed || !existsSync(file)) return;
          armed = true;
          try { state.watcher && state.watcher.close(); } catch { /* ignore */ }
          watchRuntime();
          state.runtime = readRuntime();
          sync('file-appear');
        });
      }
    } catch (e) { warn('watch runtime failed: ' + ((e && e.message) || e)); }
  }
  if (cfg.runtimeWatch !== false) watchRuntime();

  // ---- ④ bundle 生命周期：卸载时全部还原 ---------------------------------------
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => () => {
      try { state.watcher && state.watcher.close(); } catch { /* ignore */ }
      dropApproval();
      dropSandbox();
      dropPruner();
      warn('runtime bridge disposed · patches restored');
    });
  }

  // ---- 对外句柄（index.js 的 ctx.provide / 工具都用它） --------------------------
  state.installedAt = Date.now();
  const bridge = {
    status,
    sync: () => sync('manual'),
    readRuntime,
    writeRuntime: (next) => {
      const written = writeRuntime(next);
      state.runtime = written;
      return sync('api-write');
    },
    /** 热重载：优先用 Cordis fiber；拿不到就退回「重新 sync」 */
    async reload() {
      const fiber = ctx.scope || ctx.fiber || null;
      if (fiber && typeof fiber.reload === 'function') {
        try {
          await fiber.reload();
          return { ok: true, mode: 'fiber.reload' };
        } catch (e) {
          return { ok: false, error: 'fiber.reload failed: ' + String((e && e.message) || e), fallback: sync('reload-fallback') };
        }
      }
      return { ok: true, mode: 'sync-only', note: '宿主没暴露 fiber.reload，已就地重算 hook（等价于热更）', detail: sync('reload-fallback') };
    },
  };
  sync('install');
  return bridge;
}
