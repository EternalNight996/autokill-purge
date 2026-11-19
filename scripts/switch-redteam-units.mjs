#!/usr/bin/env node
// scripts/switch-redteam-units.mjs —— 在「dsh-purge 主 bundle」与「autokill-purge 插件挂 redteam 单元」之间切换
//
// 背景：58 个 redteam_* 工具 + 演练台 UI 是 dsh-purge 包里的 cordis 单元。
// autokill-purge 的插件 bundle 直接 insert 它们（见 plugin/cordis.patch.yml），
// 但**必须把 dsh-purge 自己的 bundle 条目从 dsh.profile.bundles 移除**，
// 否则它的 host-patch 单元会和控制台的 83 条引擎抢同一批宿主文件。
//
// 用法：
//   node scripts/switch-redteam-units.mjs --status
//   node scripts/switch-redteam-units.mjs --apply      # 移除 dsh-purge bundle（包保留，作为代码库）
//   node scripts/switch-redteam-units.mjs --restore    # 加回 dsh-purge bundle
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

const HOME = process.env.USERPROFILE || process.env.HOME || '';
const PROFILE = join(HOME, '.dsh', 'profiles', 'desktop');
const RES = 'C:/Users/Administrator/AppData/Local/Programs/DeepSeek Harness/resources';
const BOOT = join(RES, 'app', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-app-boot', 'lib', 'index.js');
const INSTALL_ANCHOR = join(RES, 'app', 'dsh', 'package.json');

const args = process.argv.slice(2);
const mode = args.includes('--apply') ? 'apply' : args.includes('--restore') ? 'restore' : 'status';

function readManifest() { return JSON.parse(readFileSync(join(PROFILE, 'package.json'), 'utf8')); }

async function boot() { return import(pathToFileURL(BOOT).href); }

if (!existsSync(BOOT)) { console.error('找不到 dsh-app-boot：' + BOOT); process.exit(2); }
const b = await boot();
const manifest = readManifest();
const bundles = (manifest.dsh && manifest.dsh.profile && manifest.dsh.profile.bundles) || [];

if (mode === 'status') {
  const p = b.loadProfileDirectory('dsh', PROFILE, INSTALL_ANCHOR, {});
  console.log(JSON.stringify({
    profile: PROFILE,
    bundles,
    hasDshPurgeBundle: bundles.includes('dsh-purge'),
    dshPurgePackage: existsSync(join(PROFILE, 'node_modules', 'dsh-purge', 'package.json')),
    autokillPlugin: bundles.includes('autokill-purge-plugin'),
    layers: (p.layers || []).map((l) => l.packageName),
    skipped: p.skippedBundles || [],
  }, null, 2));
  process.exit(0);
}

const want = mode === 'apply'
  ? bundles.filter((x) => x !== 'dsh-purge')
  : (bundles.includes('dsh-purge') ? bundles : [...bundles, 'dsh-purge']);

if (want.length === bundles.length && want.every((v, i) => v === bundles[i])) {
  console.log('[switch] 已经是目标状态：' + mode);
  process.exit(0);
}
b.writeProfileBundles(PROFILE, manifest, want);
console.log(JSON.stringify({ mode, before: bundles, after: want }, null, 2));
console.log('[switch] 重启 DSH 后生效');
