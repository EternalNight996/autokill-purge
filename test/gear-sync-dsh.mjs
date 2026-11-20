// 装备 → DSH 同步契约：控制台给「本次装备」段，宿主内插件每 step 取一次并拼到注入末尾。
// 守两件事：(1) 插件侧接线还在（gearSync / /api/gear/current / mergedInject）；
//           (2) 控制台实际返回的段是可识别的（首尾 marker + 能力项）。
// 用法：node test/gear-sync-dsh.mjs   （需要控制台在 8792 跑着）
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
const BASE = process.env.PURGE_WEB_BASE || 'http://127.0.0.1:8792';
const PROFILE_PLUGIN = 'C:/Users/Administrator/.dsh/profiles/desktop/node_modules/autokill-purge-plugin';

let pass = 0;
let fail = 0;
const ok = (cond, name, extra = '') => {
  if (cond) { pass += 1; console.log('PASS  ' + name + (extra ? '  — ' + extra : '')); }
  else { fail += 1; console.log('FAIL  ' + name + (extra ? '  — ' + extra : '')); }
};

// 1) 插件侧接线
const plugin = readFileSync(join(ROOT, 'plugin', 'lib', 'index.js'), 'utf8');
ok(plugin.includes('gearSync: true'), '插件默认开启 gearSync');
ok(plugin.includes("'/api/gear/current'"), '插件会取控制台 /api/gear/current');
ok(plugin.includes('mergedInject'), '装备段拼进注入文本（mergedInject）');
ok(plugin.includes('await readGearBlock(cfg)'), 'assemble 里调用 readGearBlock');

// 2) 服务端渲染
const hints = readFileSync(join(ROOT, 'web', 'stage-hints.mjs'), 'utf8');
ok(hints.includes('renderGearSyncBlock'), 'stage-hints 导出 renderGearSyncBlock');
const server = readFileSync(join(ROOT, 'web', 'server.mjs'), 'utf8');
ok(server.includes("p === '/api/gear/current'"), 'server 暴露 /api/gear/current');
ok(server.includes('gear-sync.json'), '装备落盘 gear-sync.json（离线兜底）');

// 3) profile 里的插件版本 = 源码版本
try {
  const repo = JSON.parse(readFileSync(join(ROOT, 'plugin', 'package.json'), 'utf8')).version;
  const prof = existsSync(join(PROFILE_PLUGIN, 'package.json'))
    ? JSON.parse(readFileSync(join(PROFILE_PLUGIN, 'package.json'), 'utf8')).version
    : null;
  ok(prof === repo, 'profile 插件版本 = 源码版本', prof + ' vs ' + repo);
  const profClient = readFileSync(join(PROFILE_PLUGIN, 'lib', 'index.js'), 'utf8');
  ok(profClient.includes('readGearBlock'), 'profile 里那份插件也带 readGearBlock');
} catch (e) {
  ok(false, 'profile 插件可读', String(e && e.message ? e.message : e));
}

// 4) 控制台实际返回
try {
  const r = await fetch(BASE + '/api/gear/current', { signal: AbortSignal.timeout(8000) });
  const j = await r.json();
  ok(r.ok && j.ok === true, 'GET /api/gear/current 200', 'equipment=' + (j.equipment && j.equipment.id));
  ok(typeof j.block === 'string' && j.block.includes('<!-- autokill-purge:gear:begin -->'), '段首 marker');
  ok(typeof j.block === 'string' && j.block.includes('<!-- autokill-purge:gear:end -->'), '段尾 marker');
  ok(typeof j.block === 'string' && j.block.includes('本次装备'), '段内含「本次装备」标题');
  ok(typeof j.block === 'string' && j.block.includes('purge_search'), '段内给出取卡指令');
} catch (e) {
  ok(false, '控制台可达（8792）', String(e && e.message ? e.message : e));
}

console.log('\nsummary: ' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
