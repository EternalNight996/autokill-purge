// Supplementary: settings, token redaction, memory 503, claim, catalog/submit.
const BASE = 'http://127.0.0.1:8793';
let pass = 0, fail = 0;
function check(n, c, d) { if (c) { pass++; console.log('PASS  ' + n + (d ? '  [' + d + ']' : '')); } else { fail++; console.log('FAIL  ' + n + (d ? '  [' + d + ']' : '')); } }
async function req(method, path, body) {
  const r = await fetch(BASE + path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  return { status: r.status, j };
}

// token redaction: set a token, then ensure /api/state does not echo it
await req('POST', '/api/settings', { memoryToken: 'secret-token-xyz', language: 'en' });
let r = await req('GET', '/api/state');
check('token redacted in /api/state', r.status === 200 && r.j.state.settings.memoryToken !== 'secret-token-xyz', 'token=' + r.j.state.settings.memoryToken);

// memory 503: point base at a dead port
await req('POST', '/api/settings', { memoryBase: 'http://127.0.0.1:9999/memory-eternal/api' });
r = await req('GET', '/api/memory/stats');
check('memory unreachable -> 503', r.status === 503 && r.j.ok === false, 'status=' + r.status + ' error=' + r.j.error);
r = await req('GET', '/api/catalog');
check('catalog unreachable -> still lists 4-state (missing)', r.status === 200 && r.j.items.length >= 20 && r.j.items.every((i) => i.state === 'missing'), 'items=' + r.j.items.length + ' allMissing=' + r.j.items.every((i) => i.state === 'missing'));
r = await req('GET', '/api/assign/dsh.md');
check('assign .md unreachable -> 503 服务不可用', r.status === 503, 'status=' + r.status);

// restore base
await req('POST', '/api/settings', { memoryBase: 'http://127.0.0.1:7999/memory-eternal/api' });

// claim
r = await req('POST', '/api/memory/claim', { title: 'smoke-claim-card', kind: 'tool', tags: ['smoke'], body: 'verification card' });
check('POST /api/memory/claim -> pending', r.status === 200 && r.j.ok && r.j.status === 'pending', 'status=' + r.j.status + ' key=' + r.j.key);

// catalog submit (a currently-missing item)
r = await req('POST', '/api/catalog/submit', { id: 'purge.break.info' });
check('POST /api/catalog/submit -> pending', r.status === 200 && r.j.ok && r.j.status === 'pending', 'state=' + r.j.state + ' path=' + r.j.path);

console.log('\n== ' + pass + ' passed / ' + fail + ' failed ==');
process.exit(fail ? 1 : 0);
