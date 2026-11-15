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
const stub = spawn(process.execPath, [join(import.meta.dirname, 'stub-memory.mjs'), '8013', 'upsertfail'], { stdio: 'ignore' });
let ready = false;
for (let i = 0; i < 20 && !ready; i++) { await wait(200); try { const r = await fetch('http://127.0.0.1:8013/memory-eternal/api/health'); ready = r.ok; } catch {} }
const out = { stub_ready: ready };
if (!ready) { console.log(JSON.stringify(out)); stub.kill(); process.exit(1); }
setCfg({ base: 'http://127.0.0.1:8013', discovery: false });
await wait(250);
const s = await (await fetch('http://127.0.0.1:8793/api/status')).json();
out.guard = { canWrite: s.guard.canWrite, source: s.discovery.source, base: s.base };
const up = await fetch('http://127.0.0.1:8793/api/upload', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'purge.gear.rank_check_candidates' }) });
out.upload = { status: up.status, body: await up.json() };
out.writes_log_tail = existsSync(LOG) ? readFileSync(LOG, 'utf8').trim().split('\n').slice(-1) : 'missing';
setCfg({ port: 7999, discovery: true });
await wait(250);
const back = await (await fetch('http://127.0.0.1:8793/api/status')).json();
out.restored = { base: back.base, source: back.discovery.source, canWrite: back.guard.canWrite };
console.log(JSON.stringify(out, null, 2));
stub.kill();
