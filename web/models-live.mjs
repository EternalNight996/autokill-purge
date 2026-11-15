// 实时识别本机有哪些模型：不靠硬编码清单，读 DSH 自己的配置 + 实际用量账本 + 本机 Ollama。
//
// 三类来源（都可实时变化，前端可点「重新识别」重扫）：
//   1. DSH 配置：~/.dsh/profiles/<profile>/cordis.patch.yml
//      - llm-pi-ai.config.providers.<provider>.models[]  （第三方 provider 的模型清单）
//      - llm-deepseek.config.models[]                    （DeepSeek 官方模型清单）
//      - agent-default-model.config.provider/model        （当前默认模型）
//   2. 用量账本：~/.dsh/.dsh-usage-stats.json / .dsh-usage-ledger.json（实际跑过的模型名）
//   3. 本机 Ollama：~/.dsh/ollama-service.json 里的 port → GET /api/tags（本地模型）
//
// 只读：不写任何配置，不读 .credentials.yaml。
import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh');

/** 极简 YAML 扫描：只认这份配置用到的三种形状（providers.<p>.models[] / models[] / provider+model） */
export function parseCordisModels(text) {
  const lines = String(text || '').split(/\r?\n/);
  const models = [];
  const defaults = [];
  let moduleId = null;
  let provider = null;
  let inProviders = false;
  let lastModel = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const indent = raw.length - raw.trimStart().length;

    // 顶层模块：- id: llm-pi-ai（缩进 0）
    const mModule = line.match(/^-\s*id:\s*["']?([^"'\s]+)["']?/);
    if (mModule && indent <= 2) {
      moduleId = mModule[1];
      provider = null;
      inProviders = false;
      lastModel = null;
      continue;
    }

    if (/^providers:\s*$/.test(line)) { inProviders = true; provider = null; continue; }

    if (inProviders) {
      const mProv = line.match(/^([A-Za-z0-9._-]+):\s*$/);
      if (mProv && indent >= 4 && indent <= 8) {
        // `models:` / `config:` 这类关键字不是 provider 名
        if (!/^(models|config|providers|api|headers|options)$/.test(mProv[1])) provider = mProv[1];
        continue;
      }
      if (indent <= 4) { inProviders = false; provider = null; }
    }

    // 模型列表项：- id: glm-4.6v-flash（pi-ai provider 下缩进 10，llm-deepseek 下缩进 6）
    const mModel = line.match(/^-\s*id:\s*["']?([^"'\s]+)["']?/);
    if (mModel && indent >= 6) {
      lastModel = { id: mModel[1], name: null, provider: provider, module: moduleId, contextWindow: null, maxTokens: null };
      models.push(lastModel);
      continue;
    }

    if (lastModel) {
      const mName = line.match(/^name:\s*["']?(.+?)["']?\s*$/);
      if (mName && indent >= 10 && !lastModel.name) { lastModel.name = mName[1]; continue; }
      const mCtx = line.match(/^contextWindow:\s*(\d+)/);
      if (mCtx) { lastModel.contextWindow = Number(mCtx[1]); continue; }
      const mMax = line.match(/^maxTokens:\s*(\d+)/);
      if (mMax) { lastModel.maxTokens = Number(mMax[1]); continue; }
    }

    // 默认模型：provider + model 成对出现
    const mProvKey = line.match(/^provider:\s*["']?([A-Za-z0-9._-]+)["']?/);
    if (mProvKey) { defaults.push({ kind: 'provider', value: mProvKey[1], module: moduleId }); continue; }
    const mModelKey = line.match(/^model:\s*["']?([A-Za-z0-9._-]+)["']?/);
    if (mModelKey) { defaults.push({ kind: 'model', value: mModelKey[1], module: moduleId }); continue; }
  }

  // provider/model 配对：同一个模块里相邻的 provider + model 视为一组
  const pairs = [];
  for (let i = 0; i < defaults.length; i++) {
    const d = defaults[i];
    if (d.kind !== 'provider') continue;
    const next = defaults[i + 1];
    if (next && next.kind === 'model' && next.module === d.module) {
      pairs.push({ provider: d.value, model: next.value, module: d.module });
    }
  }
  return { models, pairs };
}

async function readIfExists(p) {
  try { return await readFile(p, 'utf8'); } catch { return null; }
}

/** 1) DSH 配置里的模型 */
async function fromDshConfig() {
  const out = [];
  const sources = [];
  const profilesDir = join(DSH_HOME, 'profiles');
  if (!existsSync(profilesDir)) return { models: out, sources, defaults: [] };
  let profiles = [];
  try { profiles = await readdir(profilesDir); } catch { return { models: out, sources, defaults: [] }; }
  const defaults = [];
  for (const profile of profiles) {
    const file = join(profilesDir, profile, 'cordis.patch.yml');
    if (!existsSync(file)) continue;
    const text = await readIfExists(file);
    if (!text) continue;
    const st = await stat(file).catch(() => null);
    const parsed = parseCordisModels(text);
    sources.push({ kind: 'dsh-config', path: file, profile: profile, models: parsed.models.length, mtime: st ? st.mtime.toISOString() : null });
    for (const m of parsed.models) {
      out.push({
        id: m.id,
        name: m.name || m.id,
        provider: m.provider || (m.module === 'llm-deepseek' ? 'deepseek' : null),
        module: m.module,
        contextWindow: m.contextWindow,
        source: `profiles/${profile}/cordis.patch.yml`,
        sourceType: 'dsh-config',
        profile: profile,
        live: true,
      });
    }
    for (const p of parsed.pairs) {
      if (p.module === 'agent-default-model') defaults.push({ provider: p.provider, model: p.model, profile: profile, source: `profiles/${profile}/cordis.patch.yml` });
    }
  }
  // 默认模型（agent-default-model 的 provider/model）也进清单：它是当前真正在用的那个
  for (const d of defaults) {
    out.push({
      id: d.model, name: d.model, provider: d.provider, module: 'agent-default-model',
      source: d.source, sourceType: 'dsh-default', profile: d.profile, live: true, isDefault: true,
    });
  }
  return { models: out, sources: sources, defaults: defaults };
}

/** 2) 用量账本里出现过的模型（= 实际跑过的） */
async function fromUsageLedger() {
  const out = [];
  const sources = [];
  const files = ['.dsh-usage-stats.json', '.dsh-usage-ledger.json'];
  const known = /^(deepseek|glm|qwen|kimi|moonshot|doubao|ernie|hunyuan|minimax|mimo|step|spark|yi|baichuan|llama|gpt|claude|gemini|o[34])[A-Za-z0-9._-]{2,}$/i;
  for (const name of files) {
    const file = join(DSH_HOME, name);
    if (!existsSync(file)) continue;
    const text = await readIfExists(file);
    if (!text) continue;
    let data;
    try { data = JSON.parse(text); } catch { continue; }
    const ids = new Set();
    const walk = (node, depth) => {
      if (!node || depth > 6) return;
      if (typeof node === 'string') { if (known.test(node)) ids.add(node); return; }
      if (Array.isArray(node)) { for (const x of node) walk(x, depth + 1); return; }
      if (typeof node === 'object') {
        for (const [k, v] of Object.entries(node)) {
          if (/^model/i.test(k) && typeof v === 'string' && known.test(v)) ids.add(v);
          walk(v, depth + 1);
        }
      }
    };
    walk(data, 0);
    sources.push({ kind: 'usage-ledger', path: file, models: ids.size });
    for (const id of ids) out.push({ id: id, name: id, provider: null, module: null, source: name, sourceType: 'usage-ledger', live: true });
  }
  return { models: out, sources: sources };
}

/** 3) 本机 Ollama（服务端口从它的状态文件读，实时探 /api/tags） */
async function fromOllama() {
  const stateFile = join(DSH_HOME, 'ollama-service.json');
  if (!existsSync(stateFile)) return { models: [], sources: [] };
  let port = 7997;
  try {
    const st = JSON.parse(await readFile(stateFile, 'utf8'));
    if (st && st.port) port = Number(st.port);
  } catch { /* 用默认端口 */ }
  const base = `http://127.0.0.1:${port}`;
  try {
    const r = await fetch(base + '/api/tags', { signal: AbortSignal.timeout(1200) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    const models = (data.models || []).map((m) => ({
      id: m.name || m.model, name: m.name || m.model, provider: 'ollama', module: 'ollama',
      sizeBytes: m.size, modifiedAt: m.modified_at, source: `ollama:${port}/api/tags`, sourceType: 'ollama', live: true,
    }));
    return { models: models, sources: [{ kind: 'ollama', path: base + '/api/tags', models: models.length }] };
  } catch (e) {
    return { models: [], sources: [{ kind: 'ollama', path: base + '/api/tags', models: 0, error: String((e && e.message) || e) }] };
  }
}

/** 汇总：去重（同一 id 保留来源更权威的那条：dsh-config > usage-ledger > ollama） */
export async function detectLiveModels() {
  const [cfg, usage, ollama] = await Promise.all([fromDshConfig(), fromUsageLedger(), fromOllama()]);
  const rank = { 'dsh-default': -1, 'dsh-config': 0, 'usage-ledger': 1, ollama: 2 };
  const byId = new Map();
  for (const m of [...cfg.models, ...usage.models, ...ollama.models]) {
    const prev = byId.get(m.id);
    if (!prev) { byId.set(m.id, Object.assign({}, m)); continue; }
    // 同 id 多来源：保留更权威的一条，但「是不是当前默认模型」要合并进去，不能被去重吃掉
    const keepNew = (rank[m.sourceType] ?? 9) < (rank[prev.sourceType] ?? 9);
    const winner = keepNew ? Object.assign({}, m) : prev;
    const loser = keepNew ? prev : m;
    winner.alsoSeenIn = [...(winner.alsoSeenIn || []), loser.source];
    if (loser.isDefault) winner.isDefault = true;
    byId.set(m.id, winner);
  }
  const models = Array.from(byId.values()).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return {
    ok: true,
    detectedAt: new Date().toISOString(),
    dshHome: DSH_HOME,
    count: models.length,
    default: cfg.defaults[0] || null,
    defaults: cfg.defaults,
    sources: [...cfg.sources, ...usage.sources, ...ollama.sources],
    models: models,
  };
}
