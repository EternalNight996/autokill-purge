// test/inject-summary.mjs —— 右侧栏聚合的「按宿主取数」契约
//
// 前置：控制台在跑（默认 http://127.0.0.1:8792；PURGE_WEB_PORT 可改，与其他验收脚本一致）。
// 断言重点：host 参数真的换数据源、不适用段带原因、fresh/cache 语义、非法 host 400。
import process from 'node:process';

const PORT = Number(process.env.PURGE_WEB_PORT || 8792);
const BASE = 'http://127.0.0.1:' + PORT;
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('PASS  ' + name + (extra ? ' — ' + extra : '')); }
  else { fail++; console.log('FAIL  ' + name + (extra ? ' — ' + extra : '')); }
};
const get = async (q) => {
  const r = await fetch(BASE + '/api/inject/summary' + q, { signal: AbortSignal.timeout(30000) });
  const text = await r.text();
  let j = null;
  try { j = JSON.parse(text); } catch { j = { raw: text.slice(0, 200) }; }
  return { status: r.status, j };
};

// 0) 服务可达
const ping = await fetch(BASE + '/api/ping', { signal: AbortSignal.timeout(5000) }).then((r) => r.json()).catch(() => null);
ok('0. 控制台可达', !!ping && ping.ok === true, 'version=' + (ping && ping.version));
if (!ping || ping.ok !== true) {
  console.log('\nsummary: ' + pass + ' PASS / ' + fail + ' FAIL（服务不可达，先起 node web/server.mjs）');
  process.exit(1);
}

// 1) DSH：83 条补丁 + 插件 + 7 项能力都适用
const dsh = await get('?host=dsh&fresh=1');
ok('1. dsh 200', dsh.status === 200);
ok('1a. hostId=dsh', dsh.j.hostId === 'dsh');
ok('1b. 补丁段适用且 total=83', dsh.j.patches && dsh.j.patches.applicable === true && dsh.j.patches.total === 83, 'total=' + (dsh.j.patches && dsh.j.patches.total));
ok('1c. 插件段适用且 bundles 有值', dsh.j.plugins && dsh.j.plugins.applicable === true && Array.isArray(dsh.j.plugins.bundles), 'bundles=' + ((dsh.j.plugins && dsh.j.plugins.bundles) || []).length);
ok('1d. 能力段适用且 7 项', dsh.j.capabilities && dsh.j.capabilities.applicable === true && dsh.j.capabilities.total === 7, 'total=' + (dsh.j.capabilities && dsh.j.capabilities.total));
ok('1e. host.rows 有 DSH 版本行', (dsh.j.host.rows || []).some((r) => r.k === 'DSH'));
ok('1f. 注入探针字段齐全', !!dsh.j.injection && typeof dsh.j.injection.ready === 'boolean' && Array.isArray(dsh.j.injection.sessions));
ok('1g. 探针给出每请求 token 估算', Number(dsh.j.injection.estTokensPerRequest) > 4000, 'est=' + (dsh.j.injection && dsh.j.injection.estTokensPerRequest));
const newest = (dsh.j.injection.sessions || [])[0] || null;
ok('1i. 指令层字段齐全', !!dsh.j.injection.instructions && typeof dsh.j.injection.instructions.hasBlock === 'boolean', 'hasBlock=' + (dsh.j.injection.instructions && dsh.j.injection.instructions.hasBlock));
ok('1j. 指令层给 inRecentSessions', !!dsh.j.injection.instructions && typeof dsh.j.injection.instructions.inRecentSessions === 'boolean');
ok('1h. effective = 最新会话是否注入', dsh.j.injection.effective === !!(newest && newest.hasInjection), 'eff=' + dsh.j.injection.effective + ' newest=' + (newest && newest.hasInjection));

// 2) MengBot：没有补丁层/插件层 → applicable=false + 说明，不许留空
const mb = await get('?host=mengbot&fresh=1');
ok('2. mengbot 200', mb.status === 200);
ok('2a. hostId=mengbot', mb.j.hostId === 'mengbot');
ok('2b. 补丁段不适用但有说明', mb.j.patches.applicable === false && String(mb.j.patches.note || '').length > 10, mb.j.patches.note ? mb.j.patches.note.slice(0, 34) : '');
ok('2c. 补丁段给出该宿主真实计数', Array.isArray(mb.j.patches.stats) && mb.j.patches.stats.length > 0);
ok('2d. 插件段不适用但有说明', mb.j.plugins.applicable === false && String(mb.j.plugins.note || '').length > 10);
ok('2e. 能力段不适用并指明只对 DSH', mb.j.capabilities.applicable === false && /DSH/.test(String(mb.j.capabilities.note || '')));
ok('2f. 无摘要错误', (mb.j.errors || []).length === 0, (mb.j.errors || []).join('; '));
ok('2g. 非 DSH 不给注入探针', mb.j.injection === undefined);

// 3) AutoKill：梦神破甲 9 项 + 进程/config
const ak = await get('?host=autokill&fresh=1');
ok('3. autokill 200', ak.status === 200);
ok('3a. hostId=autokill', ak.j.hostId === 'autokill');
ok('3b. 补丁段适用且 9 项', ak.j.patches.applicable === true && ak.j.patches.total === 9, 'applied=' + ak.j.patches.applied + '/' + ak.j.patches.total);
ok('3c. 补丁项带 label/applied', Array.isArray(ak.j.patches.items) && ak.j.patches.items.length === 9 && 'applied' in ak.j.patches.items[0]);
ok('3d. host.rows 有 config 与 CLI', (ak.j.host.rows || []).some((r) => r.k === 'config') && (ak.j.host.rows || []).some((r) => r.k === 'CLI'));
ok('3e. 能力段不适用', ak.j.capabilities.applicable === false);

// 4) 非法 host → 400（不是 200 里塞错误，也不是 500）
const bad = await get('?host=evil');
ok('4. 非法 host → 400', bad.status === 400, 'status=' + bad.status);
ok('4a. 错误码 unknown_host', bad.j && bad.j.error === 'unknown_host');

// 5) 缓存语义：fresh 之后普通请求命中缓存；再 fresh 又是不缓存的结果
const warm = await get('?host=dsh');
ok('5. 15s 内命中缓存', warm.j.cached === true, 'ageMs=' + warm.j.ageMs);
const fresh = await get('?host=dsh&fresh=1');
ok('5a. fresh=1 绕过缓存', fresh.j.cached === undefined || fresh.j.cached === false);

// 6) 三宿主同一套骨架（前端 renderInjectRail 只认这几个键）
for (const [label, j] of [['dsh', dsh.j], ['mengbot', mb.j], ['autokill', ak.j]]) {
  const shape = j && j.host && Array.isArray(j.host.rows) && j.patches && typeof j.patches.applicable === 'boolean'
    && j.plugins && typeof j.plugins.applicable === 'boolean' && j.capabilities && typeof j.capabilities.applicable === 'boolean'
    && Array.isArray(j.capabilities.items);
  ok('6.' + label + ' 骨架字段齐全', !!shape);
}

console.log('\nsummary: ' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
