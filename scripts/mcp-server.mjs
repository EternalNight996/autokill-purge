#!/usr/bin/env node
// autokill-purge · MCP server（stdio）
// 让 AutoKill（或任何 MCP 宿主）能查到本机 autokill-purge 的记忆库、装备与破甲状态。
// 零依赖：JSON-RPC 2.0 over stdio，一行一个消息。
import { createInterface } from 'node:readline';

const BASE = process.env.PURGE_WEB_BASE || 'http://127.0.0.1:8792';

// AutoKill 构建时把 build.gear 以 --toolset <id> 传给插件；预设 id 就是装备模式
const EQUIP_MODE_IDS = ['redteam', 'recon', 'lateral', 'radio', 're', 'custom'];
const ARGV = process.argv.slice(2);
const TOOLSETS = [];
for (let i = 0; i < ARGV.length; i++) {
  if (ARGV[i] === '--toolset' && ARGV[i + 1]) TOOLSETS.push(String(ARGV[i + 1]).trim().toLowerCase());
  else if (ARGV[i].startsWith('--toolset=')) TOOLSETS.push(ARGV[i].slice('--toolset='.length).trim().toLowerCase());
}
const ACTIVE_MODE = TOOLSETS.find((t) => EQUIP_MODE_IDS.includes(t)) || '';

const TOOLS = [
  {
    name: 'purge_search',
    description: '查 autokill-purge 的隔离记忆库（mem-purge）：渗透 / 破甲 / 装备类知识卡。只返回已审核通过的卡。',
    inputSchema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: '关键词，例如 webshell / suo5 / 破甲' },
        limit: { type: 'number', description: '返回条数，默认 5' },
      },
      required: ['q'],
    },
  },
  {
    name: 'purge_equipment',
    description: '列出本机 autokill-purge 已发放的装备记录（预设、能力项、目标宿主、时间）。',
    inputSchema: { type: 'object', properties: { agents: { type: 'string', description: '只看某个宿主，如 autokill' } } },
  },
  {
    name: 'purge_breach',
    description: '查看破甲状态：本机识别到的宿主、各自版本与是否在支持矩阵内、梦神破甲各项是否已生效。',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'purge_modes',
    description: '列出可选的装备模式（红队全装 / 侦察刀 / 内网横向 / 无线电 IoT / 逆向研究），含每项能力与技能清单。',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'purge_use_mode',
    description: '选择一个装备模式并引入它的工作流：登记一次装备记录，返回按阶段组织的工作流（阶段 → 能力 → 技能 → 执行约定），agent 直接照它干。',
    inputSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', description: '模式 id，先用 purge_modes 看有哪些' },
        host: { type: 'string', description: '目标宿主，默认 autokill' },
      },
      required: ['mode'],
    },
  },
  {
    name: 'purge_context',
    description: '构建开始时一次性取上下文：按 token 预算从 autokill-purge 记忆库拉卡片与技能索引，超预算的丢弃并报告 dropped。返回 JSON：{cards:[{id,title,kind,score,excerpt,tokens}], skills:[{id,name}], used_tokens, dropped}',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '主题，例如 webshell / suo5 / 内网横向' },
        budget_tokens: { type: 'number', description: 'token 预算，默认 2000（上限 8000）' },
        kinds: { type: 'array', items: { type: 'string' }, description: '只要这些类型：skill / knowledge / finding / check / mistake / project' },
      },
      required: ['query'],
    },
  },
  {
    name: 'purge_absorb',
    description: '构建结束后回灌新知识。落 pending 等人工审核（不会自动通过），按 hash 去重：重复提交返回 deduped=true。',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['finding', 'skill', 'check', 'mistake', 'knowledge', 'project'], description: '卡类型，默认 finding' },
        title: { type: 'string' },
        body: { type: 'string', description: '正文：做了什么、结论、可复现步骤' },
        evidence: { type: 'array', items: { type: 'string' }, description: '证据引用（文件路径、命令输出摘要、URL）' },
        tags: { type: 'array', items: { type: 'string' } },
        project_id: { type: 'string', description: '项目标识，便于按项目聚合' },
        hash: { type: 'string', description: '自定义去重键；不填则按 kind+title+body+project_id 计算' },
      },
      required: ['title', 'body'],
    },
  },
  {
    name: 'purge_skill_get',
    description: '按名字取一条技能卡：返回参数表与可复跑脚本（代码块）。用于复现某个技能。',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', description: '技能名，例如 suo5-tunnel / webshell-toolkit' } },
      required: ['name'],
    },
  },
];

// 每个能力项 → 「查库关键词 + AutoKill 自己的工具」。
// 不列 DSH 的 skill 名：AutoKill 没有那些 skill，列了它也用不了。
import { STAGE_HINTS } from '../web/stage-hints.mjs';


async function api(path) {
  const r = await fetch(BASE + path, { method: 'GET' });
  return r.json();
}

async function post(path, body) {
  const r = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  return r.json();
}

async function callTool(name, args) {
  if (name === 'purge_search') {
    const q = String(args.q || '').trim();
    if (!q) return text('需要 q（关键词）。');
    const d = await api('/api/memory/search?q=' + encodeURIComponent(q) + '&limit=' + (Number(args.limit) || 5));
    const cards = d.cards || d.results || [];
    if (!cards.length) return text('记忆库里没有命中「' + q + '」。');
    return text(cards.map((c, i) => (i + 1) + '. ' + (c.title || c.key) + '\n   ' + String(c.body || c.summary || '').slice(0, 400)).join('\n\n'));
  }
  if (name === 'purge_equipment') {
    const d = await api('/api/state');
    let eq = d.state && Array.isArray(d.state.equipment) ? d.state.equipment : (Array.isArray(d.equipment) ? d.equipment : []);
    const want = String(args.agents || '').trim();
    if (want) eq = eq.filter((e) => (e.agents || []).includes(want));
    if (!eq.length) return text('还没有装备记录。');
    return text(eq.slice(-20).map((e) => e.id + ' · ' + e.preset + ' → ' + (e.agents || []).join('+') + ' · ' + (e.items || []).join(',') + ' · ' + e.at).join('\n'));
  }
  if (name === 'purge_breach') {
    const h = await api('/api/hosts');
    const lines = (h.hosts || []).map((x) => '- ' + x.name + ' ' + (x.version || '(无版本)') + ' · ' + (x.support && x.support.status) + ' · ' + x.detail);
    let ak = '';
    try {
      const p = await api('/api/autokill/patches');
      ak = '\n梦神破甲：' + p.applied + '/' + p.total + ' 已生效（AutoKill ' + (p.version || '?') + '）';
    } catch { /* 未安装 AutoKill */ }
    return text('宿主：\n' + lines.join('\n') + ak);
  }
  if (name === 'purge_modes') {
    const d = await api('/api/presets');
    const list = d.presets || [];
    if (!list.length) return text('没有可用的装备模式。');
    return text(list.map((p) => [
      '- ' + p.id + ' · ' + p.name + '（宿主：' + ((p.agents || []).join(' / ') || '任意') + '）',
      '  ' + (p.desc || ''),
      '  能力：' + ((p.items || []).map((i) => i.name).join('、') || '（无）'),
      '  技能：' + ((p.items || []).flatMap((i) => i.skills || []).join(', ') || '（无）'),
    ].join('\n')).join('\n\n'));
  }
  if (name === 'purge_use_mode') {
    // 没传 mode 就用 AutoKill 构建时传进来的 --toolset（即 UI 里选的装备模式）
    const mode = String(args.mode || ACTIVE_MODE || '').trim();
    const host = String(args.host || 'autokill').trim();
    if (!mode) return text('没指定模式，也没有 --toolset。可用：redteam / recon / lateral / radio / re / custom');
    const d = await api('/api/presets');
    const p = (d.presets || []).find((x) => x.id === mode);
    if (!p) return text('没有这个模式：' + mode + '。可用：' + ((d.presets || []).map((x) => x.id).join(', ') || '（空）'));
    const items = (p.items || []).map((i) => p.id + ':' + i.id);
    let rec = null;
    try {
      const r = await fetch(BASE + '/api/equipment', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ preset: p.id, agents: [host], items, permissions: 'read-only', notes: 'MCP purge_use_mode', absorb: false }),
      });
      rec = await r.json();
    } catch (e) { rec = { ok: false, error: String(e && e.message || e) }; }
    // 每阶段给「查库关键词 + AutoKill 自己能用的工具」，不列 DSH 的 skill 名
    const stages = (p.items || []).map((it, i) => {
      const hint = STAGE_HINTS[p.id + ':' + it.id] || ['', ''];
      return [
        '### 阶段 ' + (i + 1) + ' · ' + it.name,
        '目标：' + (it.desc || ''),
        hint[0] ? '查库：purge_search q="' + hint[0] + '" limit=5' : '查库：purge_search q="' + it.name + '" limit=5',
        hint[1] ? '工具：' + hint[1] : '',
      ].filter(Boolean).join('\n');
    }).join('\n\n');
    const recLine = rec && rec.ok
      ? '（已登记：' + (rec.equipment && rec.equipment.id) + '）'
      : '（登记失败：' + String((rec && rec.error) || '?') + '）';
    return text([
      '# 装备模式：' + p.name + '（' + p.id + '）',
      '适用宿主：' + ((p.agents || []).join(' / ') || '任意') + '　本次登记到：' + host + recLine,
      '',
      p.desc || '',
      '',
      stages || '（这个模式没有配置能力项）',
      '',
      '## 通用约定',
      '1. 每阶段先 `purge_search` 取细节（命令/参数/易错点），不要凭记忆编命令。',
      '2. 宿主状态用 `purge_breach` 核对（补丁 / 梦神破甲是否真的生效），别假设已破甲。',
      '3. 装备清单用 `purge_equipment` 复核，避免重复登记。',
      '4. 阶段结论写进 evidence；需要沉淀时调 `POST /api/memory/absorb`（落 pending，等审核）。',
    ].join('\n'));
  }
  if (name === 'purge_context') {
    const q = String(args.query || '').trim();
    if (!q) return text('需要 query（主题关键词）。');
    const d = await post('/api/memory/context', {
      query: q,
      budget_tokens: Number(args.budget_tokens) || 2000,
      kinds: Array.isArray(args.kinds) ? args.kinds : [],
    });
    if (!d || d.ok === false) return text('取上下文失败：' + String((d && (d.error || d.detail)) || '记忆库不可达'));
    return text(JSON.stringify({
      query: d.query,
      budget_tokens: d.budget_tokens,
      used_tokens: d.used_tokens,
      dropped: d.dropped,
      cards: d.cards || [],
      skills: d.skills || [],
    }, null, 1));
  }
  if (name === 'purge_absorb') {
    const title = String(args.title || '').trim();
    const body = String(args.body || '').trim();
    if (!title || !body) return text('需要 title 与 body。');
    const d = await post('/api/memory/absorb', {
      kind: String(args.kind || 'finding'),
      title,
      body,
      evidence: Array.isArray(args.evidence) ? args.evidence : [],
      tags: Array.isArray(args.tags) ? args.tags : [],
      project_id: String(args.project_id || ''),
      hash: String(args.hash || ''),
    });
    if (!d || d.ok === false) return text('回灌失败：' + String((d && (d.error || d.detail)) || '未知'));
    return text(JSON.stringify({
      id: d.id,
      hash: d.hash,
      deduped: !!d.deduped,
      status: d.status || 'pending',
      note: d.deduped ? '已存在同 hash 的卡，未重复写入' : '已写入，等待人工审核通过后才可被检索',
    }, null, 1));
  }
  if (name === 'purge_skill_get') {
    const n = String(args.name || '').trim();
    if (!n) return text('需要 name（技能名）。');
    const d = await api('/api/memory/skill?name=' + encodeURIComponent(n));
    if (!d || d.ok === false) return text('没找到技能：' + n + (d && d.error ? '（' + d.error + '）' : ''));
    return text(JSON.stringify({
      id: d.id,
      name: d.name,
      params: d.params || [],
      scripts: d.scripts || [],
      body_preview: String(d.body || '').slice(0, 600),
    }, null, 1));
  }
  return text('未知工具：' + name);
}

function text(s) {
  return { content: [{ type: 'text', text: String(s) }] };
}

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', async (line) => {
  const s = line.trim();
  if (!s) return;
  let req;
  try { req = JSON.parse(s); } catch { return; }
  const id = req.id;
  const method = req.method;
  try {
    if (method === 'initialize') {
      return send({ jsonrpc: '2.0', id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'autokill-purge', version: '1.1.5' } } });
    }
    if (method === 'notifications/initialized' || method === 'initialized') return;
    if (method === 'tools/list') {
      return send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
    }
    if (method === 'tools/call') {
      const name = req.params && req.params.name;
      const args = (req.params && req.params.arguments) || {};
      const out = await callTool(name, args);
      return send({ jsonrpc: '2.0', id, result: out });
    }
    if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} });
    return send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'method not found: ' + method } });
  } catch (e) {
    return send({ jsonrpc: '2.0', id, error: { code: -32603, message: String(e && e.message || e) } });
  }
});
