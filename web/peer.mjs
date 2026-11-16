// MEM Pair 对接（memory-eternal 0.49.x 的实例配对 / 互相传卡）。
//
// 我们不自己实现配对协议，只把它的 /peer/* 暴露给控制台：
//   GET  /peer/status    本机匹配码 + 已配对节点 + 待确认请求
//   POST /peer/discover  局域网广播找同类实例（UDP 7990）
//   POST /peer/pair/start    配对（首次要对方确认）
//   POST /peer/pair/accept   接受对方的配对请求
//   POST /peer/revoke    解除配对
//   POST /peer/upload    把本库已审卡推给对方（对方进待审）
//   POST /peer/download  把对方的卡拉进本库（进待审）
//
// 所有请求都带上控制台的匹配码头（x-memory-match），对端若校验可直接认。
import { join } from 'node:path';

function home() {
  return process.env.DSH_HOME || join(process.env.USERPROFILE || '', '.dsh');
}

async function call(state, path, opts = {}, timeoutMs = 15000) {
  const base = String(state.settings.memoryBase || '').replace(/\/+$/, '');
  if (!base) throw new Error('记忆地址没配置');
  const headers = Object.assign({ 'content-type': 'application/json' }, opts.headers || {});
  const code = String(state.settings.matchCode || '').trim();
  if (code) headers['x-memory-match'] = code;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(base + path, Object.assign({ signal: ctrl.signal, headers }, opts));
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { ok: false, raw: text.slice(0, 400) }; }
    return { status: r.status, ok: r.ok, data };
  } catch (e) {
    return { status: 0, ok: false, data: { ok: false, error: 'unreachable', detail: String((e && e.message) || e) } };
  } finally {
    clearTimeout(timer);
  }
}

export async function peerStatus(state) {
  const r = await call(state, '/peer/status');
  if (!r.ok) return Object.assign({ ok: false }, r.data);
  const d = r.data || {};
  const self = d.self || {};
  return {
    ok: true,
    self: {
      instanceId: self.id || '',
      name: self.name || '',
      fingerprint: self.fp || '',
      pairCode: self.pairCode || '',
      port: self.port || null,
      discoveryPort: self.discoveryPort || d.discoveryPort || null,
    },
    peers: (d.peers || []).map((p) => ({
      id: p.id || '', name: p.name || '', url: p.url || '',
      pairCode: p.pairCode || '', fingerprint: p.fp || '',
      pairedAt: p.pairedAt || p.at || null, lastSeen: p.lastSeen || null,
    })),
    pending: (d.pending || []).map((p) => ({
      id: p.id || '', name: p.name || '', url: p.url || '',
      pairCode: p.pairCode || '', fingerprint: p.fp || '', at: p.at || null,
    })),
  };
}

export async function peerDiscover(state) {
  const r = await call(state, '/peer/discover', { method: 'POST', body: JSON.stringify({}) }, 8000);
  if (!r.ok) return Object.assign({ ok: false }, r.data);
  const list = (r.data && (r.data.peers || r.data.list)) || [];
  return { ok: true, found: list };
}

export async function peerStart(state, { host, port, code, url }) {
  const body = {};
  if (url) body.url = String(url).trim();
  if (code) body.code = String(code).trim().toUpperCase();
  if (host) { body.host = String(host).trim(); body.port = Number(port) || 7989; }
  if (!body.url && !body.host && !body.code) return { ok: false, error: 'missing_target' };
  const r = await call(state, '/peer/pair/start', { method: 'POST', body: JSON.stringify(body) }, 25000);
  return Object.assign({ ok: r.ok && (r.data ? r.data.ok !== false : true) }, r.data);
}

export async function peerConnect(state, { code, url }) {
  const body = {};
  if (url) body.url = String(url).trim();
  if (code) body.code = String(code).trim().toUpperCase();
  if (!body.url && !body.code) return { ok: false, error: 'missing_target' };
  const r = await call(state, '/peer/pair/connect', { method: 'POST', body: JSON.stringify(body) }, 25000);
  return Object.assign({ ok: r.ok && (r.data ? r.data.ok !== false : true) }, r.data);
}

export async function peerAccept(state, { id }) {
  const r = await call(state, '/peer/pair/accept', { method: 'POST', body: JSON.stringify({ id: String(id || '') }) }, 20000);
  return Object.assign({ ok: r.ok && (r.data ? r.data.ok !== false : true) }, r.data);
}

export async function peerRevoke(state, { code, id }) {
  const body = {};
  if (code) body.code = String(code).trim().toUpperCase();
  if (id) body.id = String(id);
  const r = await call(state, '/peer/revoke', { method: 'POST', body: JSON.stringify(body) });
  return Object.assign({ ok: r.ok && (r.data ? r.data.ok !== false : true) }, r.data);
}

export async function peerUpload(state, { code, limit, status }) {
  if (!code) return { ok: false, error: 'missing_code' };
  const body = { code: String(code).toUpperCase(), limit: Number(limit) || 200, status: status || 'approved' };
  const r = await call(state, '/peer/upload', { method: 'POST', body: JSON.stringify(body) }, 60000);
  return Object.assign({ ok: r.ok && (r.data ? r.data.ok !== false : true) }, r.data);
}

export async function peerDownload(state, { code, since }) {
  if (!code) return { ok: false, error: 'missing_code' };
  const body = { code: String(code).toUpperCase() };
  if (since) body.since = Number(since);
  const r = await call(state, '/peer/download', { method: 'POST', body: JSON.stringify(body) }, 60000);
  return Object.assign({ ok: r.ok && (r.data ? r.data.ok !== false : true) }, r.data);
}

/** 我们的隔离库标识，给界面显示用 */
export function isolatedInfo() {
  return { dbName: 'mem-purge', port: 7989, vault: join(home(), 'memory-vault-mem-purge') };
}
