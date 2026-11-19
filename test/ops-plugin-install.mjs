// test/ops-plugin-install.mjs —— 插件注入（与内核补丁同一事务）的契约验收
//
// 纪律：真机上插件已装好，所以 run() 会走「already-installed 跳过」分支，不会触发 pnpm。
// 断言重点：status/plan/dryRun 只读、run 幂等、安装后校验（skippedBundles 空、layers 含插件）。
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DATA = 'F:/MyApp/eternal/autokill-purge/data';
const PROFILE = 'C:/Users/Administrator/.dsh/profiles/desktop';
const READONLY = process.argv.includes('--readonly');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('PASS  ' + name + (extra ? ' — ' + extra : '')); }
  else { fail++; console.log('FAIL  ' + name + (extra ? ' — ' + extra : '')); }
};
const mtime = (p) => { try { return statSync(p).mtimeMs; } catch { return 0; } };

const mod = await import('../web/ops/plugin-install.mjs');
const { makeCtx } = await import('../web/ops/index.mjs');
const ctx = makeCtx(DATA);
ctx.rootDir = 'F:/MyApp/eternal/autokill-purge';

// 1) META
ok('1. META 形状', mod.META && mod.META.id === 'plugin-install' && mod.META.kind === 'write');
ok('1b. 有 status/plan/run', typeof mod.status === 'function' && typeof mod.plan === 'function' && typeof mod.run === 'function');

// 2) status 只读
const pkgPath = join(PROFILE, 'package.json');
const lockPath = join(PROFILE, 'pnpm-lock.yaml');
const b1 = { pkg: mtime(pkgPath), lock: mtime(lockPath) };
const st = await mod.status(ctx);
const b2 = { pkg: mtime(pkgPath), lock: mtime(lockPath) };
ok('2. status available', st.available === true, st.summary);
ok('2b. status 不改 profile 声明', b1.pkg === b2.pkg && b1.lock === b2.lock);
ok('2c. 候选插件齐全', ['autokill-purge-plugin', 'memory-eternal', 'dsh-purge'].every((n) => (st.detail.plugins || []).some((p) => p.name === n)));
ok('2d. 校验无跳过', Array.isArray(st.detail.skipped) && st.detail.skipped.length === 0);
ok('2e. layers 含 autokill-purge-plugin', (st.detail.layers || []).includes('autokill-purge-plugin'));

// 3) plan
const pl = await mod.plan(ctx, { plugins: ['autokill-purge-plugin'] });
ok('3. plan ok', pl.ok === true);
ok('3b. plan 含 verify 步骤', (pl.plan.steps || []).some((s) => s.id === 'verify'));
ok('3c. 已装 → 步骤为 skip/register', (pl.plan.steps || []).every((s) => s.id !== 'missing-source'), JSON.stringify(pl.plan.steps.map((s) => s.id)));

// 4) dryRun 不改盘
const b3 = { pkg: mtime(pkgPath), lock: mtime(lockPath) };
const dry = await mod.run(ctx, { dryRun: true, plugins: ['autokill-purge-plugin'] });
const b4 = { pkg: mtime(pkgPath), lock: mtime(lockPath) };
ok('4. dryRun ok 且 changed=false', dry.ok === true && dry.changed === false);
ok('4b. dryRun 不改 profile', b3.pkg === b4.pkg && b3.lock === b4.lock);

if (!READONLY) {
// 5) run 幂等（已装 → 跳过 pnpm）
const b5 = { pkg: mtime(pkgPath), lock: mtime(lockPath) };
const run1 = await mod.run(ctx, { plugins: ['autokill-purge-plugin'] });
const b6 = { pkg: mtime(pkgPath), lock: mtime(lockPath) };
ok('5. run ok', run1.ok === true, run1.summary);
ok('5b. 已装 → changed=false', run1.changed === false);
ok('5c. 未触发 pnpm（声明未变）', b5.pkg === b6.pkg && b5.lock === b6.lock);
ok('5d. 返回 skipped 记录', Array.isArray(run1.detail.skipped) && run1.detail.skipped.length >= 1);
ok('5e. 安装后 skippedBundles 为空', Array.isArray(run1.detail.skippedBundles) && run1.detail.skippedBundles.length === 0);

// 6) 三个插件目录都在（没被 prune 掉）
for (const n of ['autokill-purge-plugin', 'dsh-purge', 'memory-eternal']) {
  ok('6.' + n + ' 目录在', existsSync(join(PROFILE, 'node_modules', n, 'package.json')));
}

// 7) bundles 含插件
const manifest = JSON.parse(readFileSync(pkgPath, 'utf8'));
ok('7. bundles 含插件', (manifest.dsh.profile.bundles || []).includes('autokill-purge-plugin'), (manifest.dsh.profile.bundles || []).length + ' 项');
} else {
  console.log('SKIP 5-7（--readonly：run() 会真的 pnpm add + 改 profile，跳过）');
}

console.log('\nsummary: ' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
