import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
const CFG_DIR = join(homedir(), '.autokill-purge');
const CFG = join(CFG_DIR, 'config.json');
const LOG = join(CFG_DIR, 'writes.log');
mkdirSync(CFG_DIR, { recursive: true });
const setCfg = (o) => writeFileSync(CFG, JSON.stringify(o, null, 2));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const stubs = [
  spawn(process.execPath, [join(import.meta.dirname, 'stub-memory.mjs'), '8011', 'schema1']),
  spawn(process.execPath, [join(import.meta.dirname, 'stub-memory.mjs'), '8012', 'readonly']),
  spawn(process.execPath, [join(import.meta.dirname, 'stub-memory.mjs'), '8013', 'upsertfail']),
];
await wait(1200);
const status = async () => (await (await fetch('http://127.0.0.1:8793/api/status')).json());
const upload = async (id) => { const r = await fetch('http://127.0.0.1:8793/api/upload', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) }); return { status: r.status, body: await r.json() }; };
const out = {};
setCfg({ base: 'http://127.0.0.1:8011' }); await wait(200);
let s = await status();
out.schema1 = { canWrite: s.guard.canWrite, reason: s.guard.reason, source: s.discovery.source };
out.schema1_upload = await upload('purge.gear.plan_unpack');
setCfg({ base: 'http://127.0.0.1:8012' }); await wait(200);
s = await status();
out.readonly = { canWrite: s.guard.canWrite, reason: s.guard.reason };
out.readonly_upload = await upload('purge.gear.plan_unpack');
setCfg({ base: 'http://127.0.0.1:8099', discovery: false }); await wait(200);
s = await status();
out.unreachable = { canWrite: s.guard.canWrite, reason: s.guard.reason, source: s.discovery.source, tried: s.discovery.tried.map((t) => t.source + ':' + t.ok) };
setCfg({ base: 'http://127.0.0.1:8013' }); await wait(200);
s = await status();
out.upsertfail_guard = { canWrite: s.guard.canWrite };
out.upsertfail_upload = await upload('purge.gear.audit_claims');
out.writes_log = existsSync(LOG) ? readFileSync(LOG, 'utf8').trim().split('\n').slice(-2) : 'missing';
setCfg({ port: 7999, discovery: true }); await wait(200);
s = await status();
out.restored = { base: s.base, source: s.discovery.source, canWrite: s.guard.canWrite, version: s.health && s.health.data && s.health.data.version };
console.log(JSON.stringify(out, null, 2));
for (const p of stubs) p.kill();
