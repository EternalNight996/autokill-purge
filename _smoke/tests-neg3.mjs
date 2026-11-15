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
const cases = [['schema1', 8011], ['readonly', 8012], ['upsertfail', 8013]];
const procs = cases.map(([mode, port]) => spawn(process.execPath, [join(import.meta.dirname, 'stub-memory.mjs'), String(port), mode], { stdio: 'ignore' }));
const ready = {};
for (const [mode, port] of cases) {
  ready[mode] = false;
  for (let i = 0; i < 25 && !ready[mode]; i++) { await wait(200); try { ready[mode] = (await fetch('http://127.0.0.1:' + port + '/memory-eternal/api/health')).ok; } catch {} }
}
const status = async () => (await (await fetch('http://127.0.0.1:8793/api/status')).json());
const upload = async (id) => { const r = await fetch('http://127.0.0.1:8793/api/upload', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) }); return { status: r.status, body: await r.json() }; };
const out = { ready };
for (const [mode, port] of cases) {
  setCfg({ base: 'http://127.0.0.1:' + port, discovery: false });
  await wait(250);
  const s = await status();
  out[mode] = { source: s.discovery.source, canWrite: s.guard.canWrite, reason: s.guard.reason };
  out[mode + '_upload'] = await upload('purge.gear.rank_check_candidates');
}
out.writes_log_tail = existsSync(LOG) ? readFileSync(LOG, 'utf8').trim().split('\n').slice(-1) : 'missing';
setCfg({ port: 7999, discovery: true });
await wait(250);
const back = await status();
out.restored = { base: back.base, source: back.discovery.source, canWrite: back.guard.canWrite };
console.log(JSON.stringify(out, null, 2));
for (const p of procs) p.kill();
