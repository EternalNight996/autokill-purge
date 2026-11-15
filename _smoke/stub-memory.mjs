import { createServer } from 'node:http';
const port = Number(process.argv[2] || 8011);
const mode = process.argv[3] || 'schema1';
const base = { ok: true, vault: 'stub', version: '0.45.0', alive: true, writable: true, cards: 1, pending: 0, quarantined: 0, schema_version: 2 };
const health = {
  schema1: Object.assign({}, base, { schema_version: 1 }),
  readonly: Object.assign({}, base, { writable: false }),
  upsertfail: Object.assign({}, base),
}[mode] || base;
const upsertStatus = mode === 'upsertfail' ? 503 : 500;
createServer((req, res) => {
  if (req.url.endsWith('/health')) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(health)); }
  if (req.url.endsWith('/lookup')) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ ok: true, results: [], count: 0 })); }
  if (req.url.endsWith('/upsert')) { res.writeHead(upsertStatus, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ ok: false, error: 'stub refuses the write (' + mode + ')' })); }
  res.writeHead(404, { 'content-type': 'application/json' }); res.end('{"ok":false}');
}).listen(port, '127.0.0.1');
