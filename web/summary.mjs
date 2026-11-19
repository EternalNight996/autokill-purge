// web/summary.mjs —— 「注入了什么」的一屏聚合（只读）
//
// 为什么单独做：状态散在 hostStatus（补丁/宿主）、catalog（分层）、listOps（6 个能力）、
// plugin-install（插件与 bundles）、redteam-pack（技能/角色/工具）里。右侧栏要一屏看全，
// 让前端只打一个接口，避免 5 个请求各失败一半。
import os from 'node:os';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hostStatus, patchCatalog } from './host.mjs';
import { listOps } from './ops/index.mjs';

function localIPv4() {
  try {
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const n of nets[name] || []) {
        if (!n || n.internal) continue;
        if (n.family === 'IPv4' || n.family === 4) return n.address;
      }
    }
  } catch { /* ignore */ }
  return null;
}

function layerOf(p) {
  const raw = p.layer || p.raw?.layer || '未分层';
  return String(raw || '未分层');
}

export async function injectSummary(dataDir) {
  const out = {
    ok: true,
    at: new Date().toISOString(),
    device: {
      hostname: os.hostname(),
      ip: localIPv4(),
      platform: process.platform + ' ' + os.release(),
      node: process.version,
      pid: process.pid,
    },
    host: null,
    patches: null,
    plugins: null,
    capabilities: null,
    errors: [],
  };

  // ---- 宿主 + 补丁 ----
  try {
    const st = await hostStatus(dataDir);
    const counts = st.counts || {};
    // 宿主版本：从 resources/app/dsh/package.json 读（app.asar 已让位时这是权威来源）
    let dshVersion = null;
    try {
      const asarPath = (st.baseline && st.baseline.asarPath) || 'C:/Users/Administrator/AppData/Local/Programs/DeepSeek Harness/resources/app.asar';
      const resDir = join(asarPath, '..');
      dshVersion = JSON.parse(readFileSync(join(resDir, 'app', 'dsh', 'package.json'), 'utf8')).version || null;
    } catch { dshVersion = null; }
    out.host = {
      surface: st.surface,
      dshVersion,
      dshHome: st.dshHome,
      desktopSealed: !!st.desktopSealed,
      effective: !!st.effective,
      baseline: st.baseline || null,
      hosts: (st.hosts || []).map((h) => ({
        aiBase: h.aiBase,
        kind: h.kind,
        applied: h.applied,
        pending: h.pending,
        failed: h.failed,
        na: h.na,
        hostWritten: h.hostWritten,
      })),
      primaryHost: st.primaryHost ? { aiBase: st.primaryHost.aiBase, kind: st.primaryHost.kind } : null,
      files: (st.files || []).length,
    };

    let catalog = null;
    try { catalog = await patchCatalog(); } catch { catalog = null; }
    const byLayer = {};
    const byLayerApplied = {};
    for (const p of (st.patches || [])) {
      const l = layerOf(p);
      byLayer[l] = (byLayer[l] || 0) + 1;
      if (p.tone === 'ok') byLayerApplied[l] = (byLayerApplied[l] || 0) + 1;
    }
    out.patches = {
      total: counts.total || 0,
      applied: counts.applied || 0,
      pending: counts.pending || 0,
      failed: counts.failed || 0,
      na: counts.na || 0,
      byLayer,
      byLayerApplied,
      catalog: catalog && catalog.ok ? { count: catalog.count, digest: String(catalog.digest || '').slice(0, 12), upstream: catalog.upstream || null } : null,
      notable: (st.patches || [])
        .filter((p) => p.tone === 'fail' || p.tone === 'wait')
        .slice(0, 6)
        .map((p) => ({ id: p.id, name: p.name, nameZh: p.nameZh, status: p.status, tone: p.tone })),
    };
  } catch (e) {
    out.errors.push('host: ' + String((e && e.message) || e));
  }

  // ---- 插件 / 能力 ----
  try {
    const ops = await listOps(dataDir);
    const byId = {};
    for (const o of (ops.ops || [])) byId[o.id] = o;
    out.capabilities = {
      total: (ops.ops || []).length,
      available: (ops.ops || []).filter((o) => o.available).length,
      items: (ops.ops || []).map((o) => ({ id: o.id, zh: o.zh, available: !!o.available, summary: o.summary || '' })),
    };
    const pi = byId['plugin-install'];
    const rt = byId['redteam-pack'];
    const idn = byId['identity'];
    const d = (pi && pi.detail) || {};
    out.plugins = {
      bundles: d.bundles || [],
      bundleCount: (d.bundles || []).length,
      skipped: d.skipped || [],
      profile: d.profile || null,
      installed: (d.plugins || []).map((p) => ({ name: p.name, version: p.installed, inBundles: p.inBundles, spec: p.spec ? String(p.spec).split(/[\\/]/).pop() : null })),
      redteam: rt ? { summary: rt.summary, detail: rt.detail || null } : null,
      identity: idn ? { summary: idn.summary, detail: idn.detail || null } : null,
    };
  } catch (e) {
    out.errors.push('ops: ' + String((e && e.message) || e));
  }

  out.ok = out.errors.length === 0;
  return out;
}
