// mem-profile-guard —— 守住 profile 里的 memory-eternal：被依赖校正/自更新剪掉就用地
// 方 tgz 补回来（含 files、dependencies、bundles 三样），不需要重启宿主即可恢复下次启动的可用性。
//
// 为什么需要它：2026-11-21 一天内 profile 被重写三次，把 memory-eternal 从
// dependencies + bundles + node_modules 里一起抹掉。控制台侧已改用自维护副本
// (~/.dsh/autokill-purge/runtime/memory-eternal/<ver>)，但 DSH 会话里的记忆工具
// 仍然依赖 profile 这份，所以需要一层自愈。
//
// 用法：
//   node scripts/mem-profile-guard.mjs --once     单次巡检（幂等，可放计划任务）
//   node scripts/mem-profile-guard.mjs            常驻（默认 30s 一次）
//   node scripts/mem-profile-guard.mjs --interval 60000
//
// 关闭：删掉 ~/.dsh/autokill-purge/keep-plugins.json（或把 enabled 置 false）。
// 环境覆盖（测试用）：PURGE_PROFILE_DIR / PURGE_KEEP_PLUGINS / PURGE_GUARD_LOG
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const HOME = process.env.USERPROFILE || process.env.HOME || '';
const PROFILE = process.env.PURGE_PROFILE_DIR || join(HOME, '.dsh', 'profiles', 'desktop');
const KEEP = process.env.PURGE_KEEP_PLUGINS || join(HOME, '.dsh', 'autokill-purge', 'keep-plugins.json');
const LOG = process.env.PURGE_GUARD_LOG || join(HOME, '.dsh', 'autokill-purge-logs', 'mem-profile-guard.log');
const BOOT = 'C:/Users/Administrator/AppData/Local/Programs/DeepSeek Harness/resources/app/dsh/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js';

const args = process.argv.slice(2);
const ONCE = args.includes('--once');
const intervalArg = args.indexOf('--interval');
const INTERVAL = intervalArg >= 0 ? Math.max(5000, Number(args[intervalArg + 1]) || 30000) : 30000;

const DEFAULT_PIN = {
  enabled: true,
  plugins: {
    'memory-eternal': {
      spec: 'file:C:/Users/Administrator/.dsh/local-pkgs/memory-eternal-0.49.22.tgz',
      bundle: true,
    },
  },
};

function log(msg) {
  const line = '[' + new Date().toISOString() + '] ' + msg;
  try {
    mkdirSync(dirname(LOG), { recursive: true });
    writeFileSync(LOG, readFileSync(LOG, 'utf8') + line + '\n', 'utf8');
  } catch { /* 日志失败不影响守护 */ }
  console.log(line);
}

function readPin() {
  try {
    const raw = JSON.parse(readFileSync(KEEP, 'utf8'));
    if (raw && raw.plugins) return raw;
  } catch { /* 还没建 */ }
  try {
    mkdirSync(dirname(KEEP), { recursive: true });
    writeFileSync(KEEP, JSON.stringify(DEFAULT_PIN, null, 2) + '\n', 'utf8');
  } catch { /* ignore */ }
  return DEFAULT_PIN;
}

function tgzOf(spec) {
  const s = String(spec || '');
  return s.startsWith('file:') ? s.slice(5) : '';
}

function extractPackage(tgz, dst) {
  try {
    mkdirSync(dst, { recursive: true });
    execFileSync('tar.exe', ['-xzf', tgz, '-C', dst, '--strip-components=1'], { stdio: 'ignore', timeout: 120000 });
    return existsSync(join(dst, 'lib', 'web.js')) || existsSync(join(dst, 'package.json'));
  } catch (e) {
    log('extract failed: ' + ((e && e.message) || e));
    return false;
  }
}

function loadBoot() {
  try {
    if (!existsSync(BOOT)) return null;
    const require = createRequire(import.meta.url);
    delete require.cache[require.resolve(BOOT)];
    return require(BOOT);
  } catch { return null; }
}

export function tick() {
  const pin = readPin();
  if (!pin || pin.enabled === false) return { skipped: 'disabled' };
  const changed = [];
  let pkg;
  const pkgPath = join(PROFILE, 'package.json');
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  } catch (e) {
    log('profile package.json unreadable: ' + ((e && e.message) || e));
    return { error: 'pkg_unreadable' };
  }
  pkg.dependencies = pkg.dependencies || {};
  pkg.dsh = pkg.dsh || {};
  pkg.dsh.profile = pkg.dsh.profile || {};
  pkg.dsh.profile.bundles = Array.isArray(pkg.dsh.profile.bundles) ? pkg.dsh.profile.bundles : [];

  for (const [name, meta] of Object.entries(pin.plugins || {})) {
    const spec = String(meta.spec || '');
    const tgz = tgzOf(spec);
    const dir = join(PROFILE, 'node_modules', name);

    // 1) 文件
    if (!existsSync(join(dir, 'package.json')) || (name === 'memory-eternal' && !existsSync(join(dir, 'lib', 'web.js')))) {
      if (!tgz || !existsSync(tgz)) {
        log('MISSING source for ' + name + ' → ' + (tgz || spec));
        continue;
      }
      if (extractPackage(tgz, dir)) changed.push('files:' + name);
    }

    // 2) 依赖声明
    if (pkg.dependencies[name] !== spec) {
      pkg.dependencies[name] = spec;
      changed.push('dep:' + name);
    }

    // 3) bundles
    if (meta.bundle !== false && !pkg.dsh.profile.bundles.includes(name) && existsSync(join(dir, 'package.json'))) {
      pkg.dsh.profile.bundles.push(name);
      changed.push('bundle:' + name);
    }
  }

  if (!changed.length) return { ok: true, changed: [] };

  // bundles 优先走官方 API（它同时会把声明写回）；否则直接写 JSON
  const boot = loadBoot();
  try {
    if (boot && typeof boot.writeProfileBundles === 'function') {
      boot.writeProfileBundles(PROFILE, pkg, pkg.dsh.profile.bundles);
    } else {
      writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
    }
  } catch (e) {
    log('write failed: ' + ((e && e.message) || e));
    return { error: 'write_failed' };
  }
  log('repaired: ' + changed.join(', '));
  return { ok: true, changed };
}

if (ONCE) {
  const r = tick();
  console.log(JSON.stringify(r));
  process.exit(r.error ? 1 : 0);
} else {
  log('guard start · profile=' + PROFILE + ' · every ' + INTERVAL + 'ms');
  tick();
  setInterval(() => {
    try { tick(); } catch (e) { log('tick error: ' + ((e && e.message) || e)); }
  }, INTERVAL);
}
