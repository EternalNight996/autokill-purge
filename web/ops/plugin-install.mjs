// web/ops/plugin-install.mjs —— 插件注入（与内核补丁同一事务）
//
// 为什么要这一层：宿主补丁（83 条）改的是 resources/app 里的内核文件，插件装的是 profile 的
// node_modules + dsh.profile.bundles。两件事必须**一起成功或一起回滚**，否则就会出现
// 「补丁生效了但插件没装」「插件装到一半 profile 被 pnpm 清掉」这类半成品状态。
//
// 只用官方通道（这是上一轮踩坑的教训）：
//   · profile 依赖：pnpm add（唯一正确方式；绝不手放 node_modules —— pnpm 会把它移进 .ignored）
//   · profile bundles：app-boot 的 writeProfileBundles（官方 API；绝不手写 JSON）
//   · 安装后校验：app-boot 的 loadProfileDirectory → skippedBundles 必须为空
//
// 回滚：安装前整份备份 package.json + pnpm-lock.yaml；任一步失败先恢复声明，再 pnpm install --frozen-lockfile。
import { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const META = {
  id: 'plugin-install',
  zh: '插件注入（与内核补丁同一事务）',
  en: 'Plugin injection (same transaction as kernel patches)',
  kind: 'write',
  requires: ['profile', 'pnpm', 'local-pkgs'],
  note: '只走 pnpm + writeProfileBundles；安装后必须过 loadProfileDirectory 校验（skippedBundles 为空）。',
};

const PROFILE_NAME = 'desktop';

function profileDir(ctx) {
  return join(ctx.dshHome || '', 'profiles', PROFILE_NAME);
}

function pnpmEntry(ctx) {
  return join(ctx.resourcesDir || '', 'runtime', 'primary-runtime', 'dependencies', 'pnpm', 'bin', 'pnpm.mjs');
}

function bootEntry(ctx) {
  return join(ctx.resourcesDir || '', 'app', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-app-boot', 'lib', 'index.js');
}

function installAnchor(ctx) {
  return join(ctx.resourcesDir || '', 'app', 'dsh', 'package.json');
}

async function loadBoot(ctx) {
  const entry = bootEntry(ctx);
  if (!existsSync(entry)) throw new Error('找不到 dsh-app-boot：' + entry);
  return import(pathToFileURL(entry).href);
}

function readManifest(dir) {
  return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
}

function installedVersion(dir, name) {
  try {
    return JSON.parse(readFileSync(join(dir, 'node_modules', name, 'package.json'), 'utf8')).version || null;
  } catch { return null; }
}

/** 本地 tgz 优先（版本可钉死、离线可装），其次目录（pnpm 会 symlink，仅开发用）。 */
function resolveSpec(ctx, name) {
  const pkgs = join(ctx.dshHome || '', 'local-pkgs');
  const candidates = [];
  if (name === 'autokill-purge-plugin') {
    candidates.push(join(ctx.rootDir || '', 'plugin'));
    if (existsSync(pkgs)) {
      // 版本从高到低：避免目录里留着旧 tgz 时误装旧版
      const t = readdirSync(pkgs).filter((f) => f.startsWith('autokill-purge-plugin-') && f.endsWith('.tgz')).sort().reverse();
      // 一次 unshift 整个数组：保持「高版本在前」，逐个 unshift 会把顺序倒过来（曾经因此装到旧版）
      if (t.length) candidates.unshift(...t.map((f) => join(pkgs, f)));
    }
  }
  if (name === 'dsh-purge' && existsSync(pkgs)) {
    for (const f of readdirSync(pkgs)) {
      if (f.startsWith('dsh-purge-') && f.endsWith('.tgz')) candidates.unshift(join(pkgs, f));
    }
  }
  const hit = candidates.find((p) => existsSync(p));
  if (!hit) return null;
  const norm = hit.replace(/\\/g, '/');
  return statSync(hit).isDirectory() ? 'file:' + norm : 'file:' + norm;
}

export const DEFAULT_PLUGINS = ['autokill-purge-plugin'];

function runNode(ctx, args, { cwd, timeoutMs = 300000 } = {}) {
  return new Promise((resolve) => {
    let out = '';
    let err = '';
    let done = false;
    const finish = (code, extra) => {
      if (done) return;
      done = true;
      resolve(Object.assign({ code, stdout: out.slice(-4000), stderr: err.slice(-4000) }, extra || {}));
    };
    let child;
    try {
      child = spawn(process.execPath, args, { cwd, windowsHide: true });
    } catch (e) {
      return finish(-1, { error: String((e && e.message) || e) });
    }
    const timer = setTimeout(() => { try { child.kill(); } catch { /* ignore */ } finish(-2, { error: 'timeout' }); }, timeoutMs);
    child.stdout.on('data', (d) => { out += String(d); });
    child.stderr.on('data', (d) => { err += String(d); });
    child.on('error', (e) => { clearTimeout(timer); finish(-1, { error: String((e && e.message) || e) }); });
    child.on('close', (code) => { clearTimeout(timer); finish(code); });
  });
}

function pnpmAdd(ctx, profile, spec) {
  return runNode(ctx, [pnpmEntry(ctx), 'add', spec], { cwd: profile });
}

function pnpmInstallFrozen(ctx, profile) {
  return runNode(ctx, [pnpmEntry(ctx), 'install', '--frozen-lockfile'], { cwd: profile });
}

export async function status(ctx) {
  const profile = profileDir(ctx);
  const pnpm = pnpmEntry(ctx);
  const hasProfile = existsSync(join(profile, 'package.json'));
  const hasPnpm = existsSync(pnpm);
  const manifest = hasProfile ? (() => { try { return readManifest(profile); } catch { return null; } })() : null;
  const bundles = (manifest && manifest.dsh && manifest.dsh.profile && manifest.dsh.profile.bundles) || [];
  const rows = [];
  for (const name of [...DEFAULT_PLUGINS, 'memory-eternal', 'dsh-purge']) {
    const spec = resolveSpec(ctx, name);
    rows.push({
      name,
      spec: spec || null,
      installed: installedVersion(profile, name),
      inBundles: bundles.includes(name),
      needed: name === 'autokill-purge-plugin' && (!installedVersion(profile, name) || !bundles.includes(name)),
    });
  }
  let skipped = [];
  let layers = [];
  if (hasProfile && existsSync(bootEntry(ctx))) {
    try {
      const boot = await loadBoot(ctx);
      const p = boot.loadProfileDirectory('dsh', profile, installAnchor(ctx), {});
      skipped = p.skippedBundles || [];
      layers = (p.layers || []).map((l) => l.packageName);
    } catch (e) { skipped = [{ packageName: '(load)', reason: String(e.message || e) }]; }
  }
  const ready = hasProfile && hasPnpm && skipped.length === 0;
  return {
    ok: true,
    available: ready,
    summary: ready
      ? 'profile 就绪 · bundles ' + bundles.length + ' 项 · 跳过 ' + skipped.length
      : (!hasProfile ? '找不到 profile' : !hasPnpm ? '找不到 pnpm' : '有 bundle 被跳过：' + skipped.length),
    detail: {
      profile,
      pnpm,
      hasProfile,
      hasPnpm,
      bundles,
      layers,
      skipped,
      plugins: rows,
      bootEntry: bootEntry(ctx),
    },
  };
}

export async function plan(ctx, opts = {}) {
  const wanted = Array.isArray(opts.plugins) && opts.plugins.length ? opts.plugins : DEFAULT_PLUGINS;
  const st = await status(ctx);
  const d = st.detail || {};
  const steps = [];
  for (const name of wanted) {
    const row = (d.plugins || []).find((p) => p.name === name);
    if (!row) { steps.push({ id: 'unknown', name, note: '不在候选清单' }); continue; }
    if (!row.spec) { steps.push({ id: 'missing-source', name, note: '找不到安装源（tgz/目录）' }); continue; }
    if (!row.installed) steps.push({ id: 'add', name, spec: row.spec, note: 'pnpm add' });
    else if (!row.inBundles) steps.push({ id: 'register', name, note: 'package 已在，补 bundles' });
    else steps.push({ id: 'skip', name, note: '已装且已登记' });
  }
  steps.push({ id: 'verify', note: 'loadProfileDirectory 校验 skippedBundles' });
  return { ok: true, plan: { plugins: wanted, steps, sealedProfile: d.skipped || [] } };
}

/**
 * 依赖版本基线：pnpm add 会重算整树，`github:` 这类浮动源可能被顺手升级。
 * 装完之后对比一遍，**没被请求却变了的包**就是副作用，默认拒绝（可 allowDrift 放行）。
 */
function versionBaseline(profile) {
  const out = {};
  let manifest = null;
  try { manifest = readManifest(profile); } catch { return out; }
  const names = new Set([
    ...Object.keys((manifest && manifest.dependencies) || {}),
    ...(((manifest && manifest.dsh && manifest.dsh.profile && manifest.dsh.profile.bundles) || [])),
  ]);
  for (const name of names) out[name] = installedVersion(profile, name);
  return out;
}

function driftOf(baseline, after, requested) {
  const drifted = [];
  for (const [name, before] of Object.entries(baseline)) {
    if (requested.includes(name)) continue;
    const now = after[name];
    if (before && now && before !== now) drifted.push({ name, before, after: now });
  }
  return drifted;
}

function backupProfile(ctx, profile) {
  const dir = join(ctx.dataDir || '.', 'plugin-install-backups', new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14));
  mkdirSync(dir, { recursive: true });
  for (const f of ['package.json', 'pnpm-lock.yaml']) {
    const src = join(profile, f);
    if (existsSync(src)) copyFileSync(src, join(dir, f));
  }
  return dir;
}

function restoreProfile(profile, backupDir) {
  let restored = 0;
  for (const f of ['package.json', 'pnpm-lock.yaml']) {
    const src = join(backupDir, f);
    if (existsSync(src)) { copyFileSync(src, join(profile, f)); restored += 1; }
  }
  return restored;
}

export async function run(ctx, opts = {}) {
  const dryRun = opts.dryRun === true;
  const wanted = Array.isArray(opts.plugins) && opts.plugins.length ? opts.plugins : DEFAULT_PLUGINS;
  const planned = await plan(ctx, { plugins: wanted });
  if (dryRun) {
    return { ok: true, changed: false, summary: 'dryRun：将处理 ' + wanted.join(', ') + '（未落盘）', detail: planned.plan };
  }

  const profile = profileDir(ctx);
  if (!existsSync(join(profile, 'package.json'))) return { ok: false, changed: false, error: 'profile_missing', summary: '找不到 profile' };
  if (!existsSync(pnpmEntry(ctx))) return { ok: false, changed: false, error: 'pnpm_missing', summary: '找不到 pnpm' };

  const backup = backupProfile(ctx, profile);
  const performed = [];
  const skipped = [];
  let changed = false;
  const baseline = versionBaseline(profile);

  try {
    for (const name of wanted) {
      const spec = resolveSpec(ctx, name);
      if (!spec) { skipped.push({ name, reason: 'no_source' }); continue; }
      const installed = installedVersion(profile, name);
      const wanted = opts.force === true ? null : installed;   // force=true 时即使已装也重装（升级路径）
      if (wanted) { skipped.push({ name, reason: 'already-installed', version: installed }); continue; }
      const r = await pnpmAdd(ctx, profile, spec);
      performed.push({ name, action: 'pnpm add', code: r.code, tail: (r.stdout || '').split('\n').filter(Boolean).slice(-3).join(' | ') });
      if (r.code !== 0) throw new Error('pnpm add ' + name + ' 失败：' + (r.stderr || r.stdout || 'code ' + r.code));
      changed = true;
    }

    // bundles：走官方 writeProfileBundles
    const boot = await loadBoot(ctx);
    const manifest = readManifest(profile);
    const current = (manifest.dsh && manifest.dsh.profile && manifest.dsh.profile.bundles) || [];
    const next = current.slice();
    for (const name of wanted) if (existsSync(join(profile, 'node_modules', name, 'package.json')) && !next.includes(name)) next.push(name);
    if (next.length !== current.length) {
      boot.writeProfileBundles(profile, manifest, next);
      performed.push({ name: '(bundles)', action: 'writeProfileBundles', added: next.length - current.length });
      changed = true;
    }

    // 副作用闸门：没被请求却变了版本的依赖 → 默认回滚
    const drifted = driftOf(baseline, versionBaseline(profile), wanted);
    if (drifted.length && opts.allowDrift !== true) {
      throw new Error('安装顺带改动了未请求的依赖：' + drifted.map((d) => d.name + ' ' + d.before + '→' + d.after).join(', ') + '（要放行请传 allowDrift:true）');
    }

    const check = boot.loadProfileDirectory('dsh', profile, installAnchor(ctx), {});
    const skippedBundles = check.skippedBundles || [];
    const bad = skippedBundles.filter((s) => wanted.includes(s.packageName));
    if (bad.length) throw new Error('安装后校验失败：' + bad.map((b) => b.packageName + ' → ' + b.reason).join('; '));

    return {
      ok: true,
      changed,
      summary: (changed ? '插件已注入' : '插件已是最新') + '：' + wanted.join(', ') + (skipped.length ? '（跳过 ' + skipped.length + '）' : ''),
      detail: { backup, performed, skipped, drifted, bundles: next, skippedBundles, layers: (check.layers || []).map((l) => l.packageName) },
    };
  } catch (e) {
    const restored = restoreProfile(profile, backup);
    const re = await pnpmInstallFrozen(ctx, profile);
    return {
      ok: false,
      changed: true,
      error: String((e && e.message) || e),
      summary: '插件注入失败，已回滚声明并尝试恢复依赖（restored=' + restored + ', install code=' + re.code + '）',
      detail: { backup, performed, skipped, rollback: { restored, installCode: re.code, tail: (re.stderr || re.stdout || '').split('\n').filter(Boolean).slice(-4) } },
    };
  }
}
