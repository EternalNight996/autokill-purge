// MCP 服务器管理：本机 ~/.dsh/mcp-servers.json（Claude / Cursor 兼容结构），可管可测。
//
// 结构（enabled 是我们自己的扩展字段，导出给别人时可忽略）：
//   { "mcpServers": { "<name>": { "command": "npx", "args": [...], "env": {...}, "enabled": true } } }
//   HTTP/SSE 传输写成 { "url": "http://127.0.0.1:3000/mcp", "enabled": true }
//
// 测试是**真的握手**：spawn 进程 → initialize → notifications/initialized → tools/list，
// 把 serverInfo / protocolVersion / 工具名都带回来；HTTP 的则探一次 POST initialize。
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';

const NAME_RE = /^[a-zA-Z0-9_.-]{1,64}$/;

export function mcpConfigPath() {
  const home = process.env.DSH_HOME || join(process.env.USERPROFILE || '', '.dsh');
  return join(home, 'mcp-servers.json');
}

function emptyConfig() {
  return { mcpServers: {} };
}

export async function readMcpConfig() {
  const file = mcpConfigPath();
  if (!existsSync(file)) return { ok: true, path: file, exists: false, servers: [] };
  try {
    const raw = JSON.parse(await readFile(file, 'utf8'));
    const map = (raw && raw.mcpServers) || {};
    const servers = Object.keys(map).sort().map((name) => {
      const s = map[name] || {};
      return {
        name: name,
        transport: s.url ? 'http' : 'stdio',
        command: s.command || '',
        args: Array.isArray(s.args) ? s.args : [],
        env: s.env && typeof s.env === 'object' ? s.env : {},
        url: s.url || '',
        enabled: s.enabled !== false,
        note: s.note || '',
      };
    });
    return { ok: true, path: file, exists: true, servers: servers };
  } catch (e) {
    return { ok: false, path: file, exists: true, error: 'parse_failed', detail: String((e && e.message) || e), servers: [] };
  }
}

async function writeMcpConfig(servers) {
  const file = mcpConfigPath();
  mkdirSync(dirname(file), { recursive: true });
  if (existsSync(file)) {
    try { copyFileSync(file, file + '.bak-' + Date.now()); } catch { /* 备份失败不阻断 */ }
  }
  const map = {};
  for (const s of servers) {
    if (!s || !s.name) continue;
    const item = {};
    if (s.url) item.url = s.url;
    else {
      item.command = s.command;
      if (Array.isArray(s.args) && s.args.length) item.args = s.args;
      if (s.env && Object.keys(s.env).length) item.env = s.env;
    }
    if (s.note) item.note = s.note;
    if (s.enabled === false) item.enabled = false;
    map[s.name] = item;
  }
  const body = JSON.stringify({ mcpServers: map }, null, 2) + '\n';
  await writeFile(file, body, 'utf8');
  return { ok: true, path: file, count: Object.keys(map).length };
}

/** 新增/覆盖一个 server。args 支持逗号或换行分隔；env 支持 "K=V" 每行一个 */
export async function saveMcpServer(input) {
  const name = String(input.name || '').trim();
  if (!NAME_RE.test(name)) throw new Error('名字只能字母数字 _ . -，最长 64');
  const url = String(input.url || '').trim();
  const command = String(input.command || '').trim();
  if (!url && !command) throw new Error('要么给 command（stdio），要么给 url（http）');
  const rawArgs = input.args;
  const args = Array.isArray(rawArgs)
    ? rawArgs.map((x) => String(x))
    : String(rawArgs || '').split(/[\n,]/).map((x) => x.trim()).filter(Boolean);
  const env = {};
  if (input.env && typeof input.env === 'object' && !Array.isArray(input.env)) {
    for (const [k, v] of Object.entries(input.env)) env[k] = String(v);
  } else {
    for (const line of String(input.env || '').split(/\r?\n/)) {
      const i = line.indexOf('=');
      if (i > 0) env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  }
  const cur = await readMcpConfig();
  const servers = (cur.servers || []).filter((s) => s.name !== name);
  servers.push({ name, url, command, args, env, enabled: input.enabled !== false, note: String(input.note || '').trim() });
  const w = await writeMcpConfig(servers);
  return { ok: true, name: name, path: w.path, count: w.count };
}

export async function deleteMcpServer(name) {
  const cur = await readMcpConfig();
  const before = (cur.servers || []).length;
  const servers = (cur.servers || []).filter((s) => s.name !== name);
  if (servers.length === before) return { ok: false, error: 'not_found', name: name };
  const w = await writeMcpConfig(servers);
  return { ok: true, name: name, count: w.count, path: w.path };
}

function tail(s, n = 1200) {
  const t = String(s || '');
  return t.length > n ? t.slice(t.length - n) : t;
}

/** Windows 上裸命令要补扩展名（npx → npx.cmd、node → node.exe），否则 ENOENT */
function commandCandidates(command) {
  if (process.platform !== 'win32') return [command];
  if (/\.(exe|cmd|bat|com)$/i.test(command)) return [command];
  return [command + '.cmd', command + '.exe', command];
}

/** stdio：真握手 initialize → notifications/initialized → tools/list */
async function testStdio(cfg, timeoutMs = 20000) {
  const cands = commandCandidates(cfg.command);
  let last = null;
  for (const cmd of cands) {
    const r = await spawnAndHandshake(cmd, cfg.args || [], cfg.env || {}, timeoutMs);
    if (r.ok || r.error !== 'spawn_failed') return r;
    last = r;
  }
  return last || { ok: false, error: 'spawn_failed' };
}

function spawnAndHandshake(command, args, env, timeoutMs) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, {
        env: Object.assign({}, process.env, env || {}),
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (e) {
      return resolve({ ok: false, error: 'spawn_failed', detail: String((e && e.message) || e) });
    }
    let buf = '';
    let err = '';
    let settled = false;
    let gotInit = false;
    const tools = [];
    const settle = (r) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.kill(); } catch { /* 已退出 */ }
      resolve(r);
    };
    const timer = setTimeout(() => settle({ ok: false, error: 'timeout', stderr: tail(err), tools: tools }), timeoutMs);
    const write = (msg) => {
      try { child.stdin.write(JSON.stringify(msg) + '\n'); } catch { /* 进程已死 */ }
    };
    const handle = (obj) => {
      if (!obj || typeof obj !== 'object') return;
      if (obj.id === 1 && obj.result) {
        gotInit = true;
        write({ jsonrpc: '2.0', method: 'notifications/initialized' });
        write({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
      } else if (obj.id === 1 && obj.error) {
        settle({ ok: false, error: 'initialize_failed', detail: obj.error.message || JSON.stringify(obj.error), stderr: tail(err) });
      } else if (obj.id === 2 && obj.result) {
        for (const t of (obj.result.tools || [])) tools.push(t.name);
        settle({
          ok: true,
          transport: 'stdio',
          serverInfo: (initInfo && initInfo.serverInfo) || null,
          protocolVersion: (initInfo && initInfo.protocolVersion) || null,
          toolCount: tools.length,
          tools: tools.slice(0, 50),
          stderr: tail(err, 400),
        });
      } else if (obj.id === 2 && obj.error) {
        settle({ ok: false, error: 'tools_list_failed', detail: obj.error.message || JSON.stringify(obj.error), stderr: tail(err) });
      }
    };
    let initInfo = null;
    child.stdout.on('data', (b) => {
      buf += b.toString('utf8');
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line || line[0] !== '{') continue;
        try {
          const obj = JSON.parse(line);
          if (obj.id === 1 && obj.result) initInfo = obj.result;
          handle(obj);
        } catch { /* 非 JSON 行忽略（有些 server 会先打日志） */ }
      }
    });
    child.stderr.on('data', (b) => { err += b.toString('utf8'); });
    child.on('error', (e) => settle({ ok: false, error: 'spawn_failed', detail: String((e && e.message) || e) }));
    child.on('close', (code) => {
      if (!settled && !gotInit) settle({ ok: false, error: 'exited', code: code, stderr: tail(err) });
    });
    write({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'autokill-purge', version: '1.0.0' } },
    });
  });
}

/** http：POST 一次 initialize，能拿到 result 就算通 */
async function testHttp({ url }, timeoutMs = 12000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'autokill-purge', version: '1.0.0' } },
      }),
      signal: ctl.signal,
    });
    const text = await r.text();
    let info = null;
    try {
      const j = JSON.parse(text.replace(/^data:\s*/m, ''));
      info = j.result || null;
    } catch { /* 不是 JSON */ }
    return {
      ok: r.ok && !!info,
      transport: 'http',
      status: r.status,
      serverInfo: info ? info.serverInfo : null,
      protocolVersion: info ? info.protocolVersion : null,
      detail: r.ok ? '' : text.slice(0, 200),
    };
  } catch (e) {
    return { ok: false, error: 'http_failed', detail: String((e && e.message) || e) };
  } finally {
    clearTimeout(timer);
  }
}

export async function testMcpServer(payload) {
  if (payload && payload.url) return testHttp(payload);
  if (!payload || !payload.command) return { ok: false, error: 'missing_command' };
  return testStdio({ command: payload.command, args: payload.args || [], env: payload.env || {} });
}

/** 拿已保存的某个 server 去测 */
export async function testSavedServer(name) {
  const cur = await readMcpConfig();
  const s = (cur.servers || []).find((x) => x.name === name);
  if (!s) return { ok: false, error: 'not_found', name: name };
  return testMcpServer(s);
}

/** 导出成 Claude Desktop / Cursor 可直接吃的片段 */
export async function exportMcpConfig() {
  const cur = await readMcpConfig();
  const map = {};
  for (const s of cur.servers || []) {
    if (s.enabled === false) continue;
    if (s.url) map[s.name] = { url: s.url };
    else {
      const item = { command: s.command };
      if (s.args && s.args.length) item.args = s.args;
      if (s.env && Object.keys(s.env).length) item.env = s.env;
      map[s.name] = item;
    }
  }
  return { ok: true, json: JSON.stringify({ mcpServers: map }, null, 2), count: Object.keys(map).length };
}
