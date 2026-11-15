import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cli = "F:/MyApp/eternal/AutoKill/target/release/autokill-cli.exe";
const project = mkdtempSync(join(tmpdir(), "akproj-"));
const child = spawn(cli, ['mcp', '--project', project, '--deep', '--all-tools'], { stdio: ['pipe', 'pipe', 'pipe'] });
let buf = '';
const replies = [];
child.stdout.on('data', (d) => {
  buf += d.toString('utf8');
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    try { replies.push(JSON.parse(line)); } catch (e) { replies.push({ raw: line.slice(0, 120) }); }
  }
});
child.stderr.on('data', () => {});

const send = (m) => child.stdin.write(JSON.stringify(m) + '\n');
send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'purge-selftest', version: '0.1' } } });
send({ jsonrpc: '2.0', method: 'notifications/initialized' });
setTimeout(() => send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }), 400);

setTimeout(() => {
  child.stdin.end();
  const init = replies.find((r) => r.id === 1);
  const list = replies.find((r) => r.id === 2);
  const tools = list && list.result && Array.isArray(list.result.tools) ? list.result.tools : [];
  const out = {
    server: init && init.result && init.result.serverInfo ? init.result.serverInfo : (init && init.result ? 'ok' : 'no initialize reply'),
    protocol: init && init.result ? init.result.protocolVersion : null,
    tools: tools.length,
    sample: tools.slice(0, 6).map((t) => t.name),
    has_deep_only: tools.some((t) => /^native_|^js_/.test(t.name || '')),
    has_plugins: tools.some((t) => /^plugins_/.test(t.name || '')),
    errors: replies.filter((r) => r.error).length,
  };
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}, 2500);
