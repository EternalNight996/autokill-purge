// lib/mem-runtime.mjs —— autokill-purge 自己维护的 memory-eternal 运行时副本
//
// 为什么要有这一层：控制台的记忆库（隔离库 mem-purge）以前直接借用 DSH profile 里那份
// `~/.dsh/profiles/desktop/node_modules/memory-eternal`。那份归 DSH 插件管理器管：
// 它随插件升级改版本、随 pnpm 重算被换掉，控制台的 7989/7990 就跟着抖。
//
// 现在改成：控制台在自己的目录里装一份**钉死版本**的副本，端口/db/vault 全独立：
//   runtime 目录  ~/.dsh/autokill-purge/runtime/memory-eternal/<version>/
//   端口          7989（data/deploy.json，可改）
//   db 名         mem-purge
//   vault         ~/.dsh/memory-vault-mem-purge
// profile 里那份只作为**最后回退**（老用户没网、没装副本时仍能用）。
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';

/** 钉死版本：跟 DSH 插件版本解耦，升级只由 autokill-purge 自己决定。 */
export const MEM_RUNTIME_VERSION = '0.49.21';

const HOME = process.env.USERPROFILE || process.env.HOME || '';
export const RUNTIME_ROOT = join(HOME, '.dsh', 'autokill-purge', 'runtime', 'memory-eternal');

export function runtimeDir(version = MEM_RUNTIME_VERSION) {
  return join(RUNTIME_ROOT, version);
}

function hasWebJs(dir) {
  return !!dir && existsSync(join(dir, 'lib', 'web.js'));
}

/**
 * 解析该用哪份运行时。
 * 顺序：AUTOKILL_MEM_ROOT（显式覆盖）→ 自维护副本 → DSH profile 副本（回退）
 * @returns {{root:string|null, source:'env'|'runtime'|'profile'|'missing', version:string|null}}
 */
export function resolveMemRoot({ version = MEM_RUNTIME_VERSION, profileFallback = true } = {}) {
  const env = String(process.env.AUTOKILL_MEM_ROOT || '').trim();
  if (env && hasWebJs(env)) return { root: env, source: 'env', version: readVersion(env) };
  const rt = runtimeDir(version);
  if (hasWebJs(rt)) return { root: rt, source: 'runtime', version: readVersion(rt) };
  if (profileFallback) {
    const prof = join(HOME, '.dsh', 'profiles', 'desktop', 'node_modules', 'memory-eternal');
    if (hasWebJs(prof)) return { root: prof, source: 'profile', version: readVersion(prof) };
  }
  return { root: null, source: 'missing', version: null };
}

export function readVersion(dir) {
  try { return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version || null; } catch { return null; }
}

function runTar(args) {
  return new Promise((resolve) => {
    try {
      execFile('tar', args, { windowsHide: true, timeout: 120000 }, (e, so, se) => {
        resolve({ ok: !e, code: e ? (e.code || -1) : 0, stdout: String(so || '').slice(-800), stderr: String(se || '').slice(-800) });
      });
    } catch (e) { resolve({ ok: false, error: String((e && e.message) || e) }); }
  });
}

/**
 * 确保自维护副本存在（幂等）。
 * 用 registry tarball + 系统 tar 解压，不依赖 npm/pnpm 的依赖树行为。
 */
export async function ensureMemRuntime({ version = MEM_RUNTIME_VERSION, force = false, fromProfile = true } = {}) {
  const dir = runtimeDir(version);
  const marker = join(dir, '.autokill-runtime.json');
  if (!force && existsSync(marker)) {
    try {
      const m = JSON.parse(readFileSync(marker, 'utf8'));
      if (m && m.version === version && hasWebJs(dir)) return { ok: true, installed: false, dir, version, source: 'runtime' };
    } catch { /* marker 坏了就重装 */ }
  }

  // 先试「从 DSH profile 复制同版本」：离线、快、UI 与用户当前看到的一致。
  // 只有版本不一致或 profile 没有时才回落到 registry 下载。
  if (fromProfile) {
    const prof = join(HOME, '.dsh', 'profiles', 'desktop', 'node_modules', 'memory-eternal');
    const pv = readVersion(prof);
    if (hasWebJs(prof) && (!version || pv === version)) {
      mkdirSync(dir, { recursive: true });
      cpSync(prof, dir, { recursive: true, force: true, filter: (src) => !/[\\/](node_modules|\.git)$/.test(src) });
      if (hasWebJs(dir)) {
        writeFileSync(marker, JSON.stringify({ version: pv, at: new Date().toISOString(), source: 'profile-copy' }, null, 2) + '\n', 'utf8');
        return { ok: true, installed: true, dir, version: pv, source: 'profile-copy' };
      }
    }
  }

  const tmp = join(RUNTIME_ROOT, '.tmp-' + Date.now());
  mkdirSync(tmp, { recursive: true });
  const tgz = join(tmp, 'memory-eternal-' + version + '.tgz');
  const url = 'https://registry.npmjs.org/memory-eternal/-/memory-eternal-' + version + '.tgz';
  let bytes = 0;
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 180000);
    const res = await fetch(url, { signal: ac.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error('registry ' + res.status);
    const buf = Buffer.from(await res.arrayBuffer());
    bytes = buf.length;
    writeFileSync(tgz, buf);
  } catch (e) {
    try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
    return { ok: false, error: 'download_failed', detail: String((e && e.message) || e), url };
  }

  mkdirSync(dir, { recursive: true });
  const ex = await runTar(['-xzf', tgz, '-C', dir, '--strip-components=1']);
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  if (!ex.ok || !hasWebJs(dir)) {
    return { ok: false, error: 'extract_failed', detail: ex.stderr || ex.error || 'no lib/web.js', bytes };
  }
  writeFileSync(marker, JSON.stringify({ version, at: new Date().toISOString(), bytes, source: 'registry' }, null, 2) + '\n', 'utf8');
  return { ok: true, installed: true, dir, version, bytes };
}

/** 列出已装副本（给 status/UI 用）。 */
export function listRuntimes() {
  if (!existsSync(RUNTIME_ROOT)) return [];
  const out = [];
  for (const name of readdirSync(RUNTIME_ROOT)) {
    if (name.startsWith('.')) continue;
    const dir = join(RUNTIME_ROOT, name);
    if (!hasWebJs(dir)) continue;
    out.push({ version: name, dir, installed: readVersion(dir), pinned: name === MEM_RUNTIME_VERSION });
  }
  return out.sort((a, b) => String(b.version).localeCompare(String(a.version)));
}
