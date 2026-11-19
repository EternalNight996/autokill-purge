// test/ops-acceptance.mjs —— 能力补齐层（/api/ops）契约验收
//
// 跑法：
//   node test/ops-acceptance.mjs            # 只读 + 预览（不动盘）
//   node test/ops-acceptance.mjs --dry-run  # 额外验证各能力的 dryRun（仍不改盘）
//
// 断言的是**契约**，不是各能力的业务细节（业务细节由 test/ops-<id>.mjs 负责）：
//   1) GET /api/ops 必须是 { ok, contract:1, ops:[5] }
//   2) 每个 op 都有 id/zh/kind/available；available 的必须有 summary
//   3) GET /api/ops/<id>/status 必须 200
//   4) POST /api/ops/<id>/plan 必须 200 且有 plan（没有 plan() 的返回 ok:false，允许）
//   5) POST /api/ops/<id>/run 不带 confirm 必须 400
//   6) --dry-run：run {confirm:true,dryRun:true} 必须 ok 且 changed=false（真执行就说明 dryRun 没实现）
const BASE = process.env.PURGE_BASE || 'http://127.0.0.1:8792';
const DRY = process.argv.includes('--dry-run');
const EXPECT = ['reapply', 'restart', 'identity', 'rewind', 'redteam-pack'];

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('PASS  ' + name + (extra ? ' — ' + extra : '')); }
  else { fail++; console.log('FAIL  ' + name + (extra ? ' — ' + extra : '')); }
};

async function call(path, opts = {}) {
  const res = await fetch(BASE + path, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'content-type': 'application/json' } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let json = null;
  const text = await res.text();
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, json };
}

const listed = await call('/api/ops');
ok('1. /api/ops 200', listed.status === 200, 'status=' + listed.status);
ok('1b. contract=1', listed.json.contract === 1);
const ops = (listed.json && listed.json.ops) || [];
ok('1c. 五个能力齐全', EXPECT.every((id) => ops.some((o) => o.id === id)), ops.map((o) => o.id).join(','));
ok('1d. 每项字段完整', ops.every((o) => o.id && o.zh && o.kind && typeof o.available === 'boolean'));
ok('1e. ctx 暴露 dshHome/appDir', !!(listed.json.ctx && listed.json.ctx.dshHome && listed.json.ctx.appDir));

for (const op of ops) {
  const st = await call('/api/ops/' + op.id + '/status');
  ok('2.' + op.id + ' status 200', st.status === 200, 'status=' + st.status);
  ok('2.' + op.id + ' status 有 available', typeof (st.json && st.json.available) === 'boolean');
  if (op.available) ok('2.' + op.id + ' summary 非空', !!(st.json && String(st.json.summary || '').length));

  const plan = await call('/api/ops/' + op.id + '/plan', { method: 'POST', body: {} });
  ok('3.' + op.id + ' plan 可调用', plan.status === 200, 'ok=' + (plan.json && plan.json.ok) + ' plan=' + !!(plan.json && plan.json.plan));

  const noConfirm = await call('/api/ops/' + op.id + '/run', { method: 'POST', body: {} });
  ok('4.' + op.id + ' run 缺 confirm → 400', noConfirm.status === 400, 'status=' + noConfirm.status);

  if (DRY && op.available && op.kind !== 'read') {
    // 需要入参的能力：从 status 的 detail 里取一个真实目标，取不到就记 SKIP（不算失败）
    const body = { confirm: true, dryRun: true };
    if (op.id === 'rewind') {
      const sessions = (st.json && st.json.detail && st.json.detail.sessions) || [];
      const first = sessions.find((s) => s && s.id);
      if (!first) { console.log('SKIP  5.rewind dryRun — status 没给可回退会话'); continue; }
      body.sessionId = first.id;
    }
    const dry = await call('/api/ops/' + op.id + '/run', { method: 'POST', body });
    const j = dry.json || {};
    ok('5.' + op.id + ' dryRun ok 且 changed=false', dry.status === 200 && j.ok !== false && j.changed === false,
      'status=' + dry.status + ' changed=' + j.changed + ' summary=' + String(j.summary || '').slice(0, 90));
  }
}

console.log('\nsummary: ' + pass + ' PASS / ' + fail + ' FAIL' + (DRY ? '（含 dryRun）' : '（只读）'));
process.exit(fail ? 1 : 0);
