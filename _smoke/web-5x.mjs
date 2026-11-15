// 5.x HTTP contract verification. Run against a live web/server.mjs (default port 8793).
//   node _smoke/web-5x.mjs
const BASE = process.env.BASE || 'http://127.0.0.1:8793';

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('PASS  ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('FAIL  ' + name + (detail ? '  [' + detail + ']' : '')); }
}
async function req(method, path, body) {
  const r = await fetch(BASE + path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await r.text();
  let j; try { j = JSON.parse(text); } catch { j = text; }
  return { status: r.status, j };
}

// 1. ping
let r = await req('GET', '/api/ping');
check('GET /api/ping', r.status === 200 && r.j.ok && r.j.version, 'version=' + r.j.version);

// 2. agreement gate (assume a fresh/unsigned state: report but don't fail hard if pre-signed)
r = await req('GET', '/api/memory/stats');
const gateBefore = r.status === 403 && r.j && r.j.error === 'agreement';
check('unsigned GET /api/memory/stats -> 403', gateBefore, 'status=' + r.status);

// 3. sign
r = await req('POST', '/api/agreement', { accepted: true, signer: 'qa' });
check('POST /api/agreement', r.status === 200 && r.j.ok && r.j.agreement.accepted === true, 'signer=' + r.j.agreement.signer);

// 4. signed stats
r = await req('GET', '/api/memory/stats');
check('signed GET /api/memory/stats -> 200', r.status === 200 && r.j.ok && typeof r.j.total === 'number', 'total=' + r.j.total);

// 5. state
r = await req('GET', '/api/state');
check('GET /api/state', r.status === 200 && r.j.ok && r.j.models.length >= 9 && r.j.layers.length === 3 && r.j.techniques.length >= 12, 'models=' + r.j.models.length + ' techniques=' + r.j.techniques.length);

// 6. memory cards
r = await req('GET', '/api/memory/cards?limit=3');
check('GET /api/memory/cards', r.status === 200 && r.j.ok && Array.isArray(r.j.cards), 'cards=' + (r.j.cards || []).length);
const cardPaths = (r.j.cards || []).map((c) => c.path);

// 7. memory card
if (cardPaths[0]) {
  r = await req('GET', '/api/memory/card?path=' + encodeURIComponent(cardPaths[0]));
  check('GET /api/memory/card', r.status === 200 && r.j.ok && typeof r.j.text === 'string', 'path=' + cardPaths[0]);
} else {
  check('GET /api/memory/card', false, 'no cards available to open');
}

// 8. memory lookup (four-state)
r = await req('GET', '/api/memory/lookup?q=purge.gear.plan_unpack');
check('GET /api/memory/lookup four-state', r.status === 200 && r.j.ok && ['present', 'pending', 'missing', 'stale'].includes(r.j.state), 'state=' + r.j.state);

// 9. catalog four-state (FR-10)
r = await req('GET', '/api/catalog');
const okStates = ['present', 'pending', 'missing', 'stale'];
const allFourState = r.status === 200 && r.j.ok && r.j.items.length >= 20 && r.j.items.every((i) => okStates.includes(i.state));
check('GET /api/catalog >=20 four-state', allFourState, 'items=' + (r.j.items || []).length);

// 10. assign
r = await req('POST', '/api/assign', { agent: 'dsh', cards: cardPaths.slice(0, 2), mode: { skillsOnly: false, autoSync: true } });
check('POST /api/assign', r.status === 200 && r.j.ok && r.j.assignments.dsh, 'cards=' + r.j.assignments.dsh.cards.length);
r = await req('GET', '/api/assign');
check('GET /api/assign', r.status === 200 && r.j.ok && r.j.assignments.dsh, '');
r = await req('GET', '/api/assign/dsh.md');
check('GET /api/assign/dsh.md', r.status === 200 && String(r.j).includes('# autokill-purge'), 'bytes=' + String(r.j).length);

// 11. breach build
r = await req('POST', '/api/breach/build', { model: 'gpt-4o', layer: 'prompt', techniques: ['persona', 'encoding', 'format'], task: '授权靶场的弱口令验证步骤', role: '安全研究员', output: '' });
check('POST /api/breach/build', r.status === 200 && r.j.ok && r.j.result.variants.length >= 3, 'variants=' + (r.j.result.variants || []).length + ' zero_wide=' + (r.j.result.zero_wide_sample ? 'yes' : 'no'));

// 12. breach attempt
r = await req('POST', '/api/breach/attempt', { model: 'gpt-4o', technique: 'persona', result: 'pass', note: 'smoke' });
check('POST /api/breach/attempt', r.status === 200 && r.j.ok && r.j.stats.total >= 1 && r.j.stats.passRate === 100, 'passRate=' + r.j.stats.passRate + '%');

// 13. equipment
r = await req('POST', '/api/equipment', { preset: 'recon', agents: ['dsh'], permissions: 'read-only', notes: 'smoke' });
check('POST /api/equipment', r.status === 200 && r.j.ok && r.j.equipment.id, 'id=' + r.j.equipment.id);

// 14. break run (whitelist + error mapping)
r = await req('POST', '/api/break/run', { command: 'info', file: '_smoke/sample.exe', args: [] });
check('break/run info', r.status === 200 && r.j.ok && r.j.sections.length > 0, 'sections=' + (r.j.sections || []).length);
r = await req('POST', '/api/break/run', { command: 'scan', file: '_smoke/sample.exe', args: ['--min-xrefs', '1'] });
check('break/run scan', r.status === 200 && r.j.ok && r.j.hits.length > 0, 'hits=' + (r.j.hits || []).length);
r = await req('POST', '/api/break/run', { command: 'info', file: '_smoke/note-for-403.txt', args: [] });
check('break/run non-PE -> 400', r.status === 400 && r.j.ok === false, 'status=' + r.status);
r = await req('POST', '/api/break/run', { command: 'rm', file: 'x', args: [] });
check('break/run forbidden -> 403', r.status === 403 && r.j.error === 'forbidden_command', 'status=' + r.status);
r = await req('POST', '/api/break/run', { command: 'patch', file: '_smoke/sample.exe', args: ['--at', '0xA5638', '--expect', '00000000000000', '--nop', '7'] });
check('break/run expect mismatch -> 409', r.status === 409 && r.j.ok === false, 'status=' + r.status + ' code=' + (r.j.error && r.j.error.code));

// 15. reset agreement -> gate returns
r = await req('POST', '/api/agreement/reset');
check('POST /api/agreement/reset', r.status === 200 && r.j.ok && r.j.agreement.accepted === false, '');
r = await req('GET', '/api/memory/stats');
check('after reset -> 403 again', r.status === 403 && r.j.error === 'agreement', 'status=' + r.status);

// re-sign to leave a usable state
await req('POST', '/api/agreement', { accepted: true, signer: 'qa' });

console.log('\n== ' + pass + ' passed / ' + fail + ' failed ==');
process.exit(fail ? 1 : 0);
