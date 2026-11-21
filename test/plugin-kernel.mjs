// test/plugin-kernel.mjs —— 「梦神破甲」插件（内核切片）静态验收
// 目标：一个包自带 58 个 redteam_* 工具内核，不依赖 dsh-purge；工具只挂预设、不全局挂。
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('PASS  ' + name + (extra ? ' — ' + extra : '')); }
  else { fail++; console.log('FAIL  ' + name + (extra ? ' — ' + extra : '')); }
};

const root = join('plugin');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const patch = readFileSync(join(root, 'cordis.patch.yml'), 'utf8');
const preset = readFileSync(join(root, 'vendor/presets/redteam/agent.cordis.yml'), 'utf8');
const presetMeta = readFileSync(join(root, 'vendor/presets/redteam/preset.yml'), 'utf8');
const tools = readFileSync(join(root, 'vendor/lib/redteam/tools.js'), 'utf8');
const redteamIndex = readFileSync(join(root, 'vendor/lib/redteam/index.js'), 'utf8');

ok('1. 版本 ≥ 0.3.0', (() => { const [maj, min] = String(pkg.version).split('.').map(Number); return maj > 0 || min >= 3; })(), pkg.version);
ok('1a. exports 暴露 redteam 三段', !!(pkg.exports && pkg.exports['./redteam'] && pkg.exports['./redteam/store'] && pkg.exports['./redteam/tools']));
ok('1b. files 含 vendor', Array.isArray(pkg.files) && pkg.files.includes('vendor'));

ok('2. bundle patch 挂 store/自举，用本包名', patch.includes("'autokill-purge-plugin/redteam/store'") && patch.includes("'autokill-purge-plugin/redteam'"));
ok('2a. bundle patch 无 dsh-purge 功能引用', !/name:\s*['"]dsh-purge/.test(patch));
ok('2b. 工具不全局挂（只走预设）', !/name: 'autokill-purge-plugin\/redteam\/tools'/.test(patch));

ok('3. 预设工具行指向本包', preset.includes('name: autokill-purge-plugin/redteam/tools'));
ok('3a. 预设显示名 = 梦神破甲', /^name:\s*梦神破甲/m.test(presetMeta));
ok('3b. 预设不再引用 dsh-purge', !preset.includes('dsh-purge'));

const names = new Set((tools.match(/redteam_[a-z_]+/g) || []));
ok('4. 工具名恰好 58 个', names.size === 58, 'found=' + names.size);
ok('4a. 旧包名修复逻辑覆盖 dsh-purge', redteamIndex.includes('dsh-purge/redteam/tools') && redteamIndex.includes('autokill-purge-plugin/redteam/tools'));

const moduleChecks = [
  ['vendor/lib/identity.js', ''],
  ['vendor/lib/redteam/index.js', 'autokill-purge-redteam'],
  ['vendor/lib/redteam/store.js', 'redteam-store'],
  ['vendor/lib/redteam/tools.js', 'autokill-purge-redteam-tools'],
];
for (const [rel, wantName] of moduleChecks) {
  if (rel.endsWith('redteam/tools.js')) {
    // tools.js 是宿主编排的一部分：它 import '@deepseek-ai/dsh-tools'，纯 Node 解析不到（设计如此）
    // 这里做静态契约检查：依赖宿主 defineTool + 默认导出 name 必须都在
    ok('5. 可独立 import：' + rel + '（依赖宿主包，静态检查）',
      tools.includes('@deepseek-ai/dsh-tools') && /export const name\s*=/.test(tools) && /export function apply/.test(tools),
      'static');
    continue;
  }
  try {
    const m = await import(pathToFileURL(join(root, rel)).href);
    ok('5. 可独立 import：' + rel, !wantName || m.name === wantName, wantName ? 'name=' + m.name : '');
  } catch (e) { ok('5. 可独立 import：' + rel, false, String(e && e.message || e).slice(0, 120)); }
}

const skillsDir = join(root, 'vendor/skills/redteam');
const skillCount = existsSync(skillsDir) ? readdirSync(skillsDir).filter((n) => n.endsWith('.md')).length : 0;
ok('6. 技能 48 篇随包', skillCount === 48, 'found=' + skillCount);

const tgz = readdirSync(root).filter((n) => /^autokill-purge-plugin-0\.[34]\.\d+\.tgz$/.test(n)).sort().pop();
ok('7. 已产出 0.3.x tgz', !!tgz && statSync(join(root, tgz)).size > 500 * 1024, tgz + ' · ' + (tgz ? Math.round(statSync(join(root, tgz)).size / 1024) + 'KB' : ''));

console.log('');
console.log('summary: ' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);