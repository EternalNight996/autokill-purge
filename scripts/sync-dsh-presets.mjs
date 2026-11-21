// 装备 → DSH 预设：勾了几个装备，就在 ~/.dsh/.agent-presets 下装几个预设。
//
// 之前只往 redteam 一个预设里塞 gear 段落，所以无论勾几个，DSH 预设列表永远只有「梦神破甲」。
// 现在按每次勾选的装备逐个建目录：目录名 = 装备 id，preset.yml.name = 装备名，
// agent.cordis.yml 从 redteam 骨架复制后再注入该装备专属段落；取消勾选的整目录删掉。
//
// 用法：node scripts/sync-dsh-presets.mjs [--presets redteam,recon] [--dry]
import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { EQUIP_PRESETS } from '../web/presets.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]+$/, '');
const HOME = process.env.USERPROFILE || process.env.HOME;
const PRESET_ROOT = join(HOME, '.dsh', '.agent-presets');
const BASE = 'redteam';
const args = process.argv.slice(2);
const dry = args.includes('--dry');
const pi = args.indexOf('--presets');
let wanted = pi > -1 ? args[pi + 1].split(',').map((s) => s.trim()).filter(Boolean) : null;

if (!wanted) {
  try {
    const st = JSON.parse(readFileSync(join(ROOT, 'data', 'state.json'), 'utf8'));
    const eq = Array.isArray(st.equipment) ? st.equipment : [];
    for (let i = eq.length - 1; i >= 0; i--) {
      const notes = String(eq[i].notes || '');
      if (/^MCP\b/.test(notes)) continue;
      const ps = Array.isArray(eq[i].presets) ? eq[i].presets : (eq[i].preset ? [eq[i].preset] : []);
      if (ps.length) { wanted = ps; break; }
    }
  } catch { /* 下面报错 */ }
}

if (!wanted || !wanted.length) {
  console.log(JSON.stringify({ ok: false, error: 'no-selection', hint: '先到破甲台「一并装备」勾选装备' }));
  process.exit(0);
}

const chosen = wanted.map((id) => EQUIP_PRESETS.find((p) => p.id === id)).filter(Boolean);
if (!chosen.length) {
  console.log(JSON.stringify({ ok: false, error: 'unknown-ids', ids: wanted }));
  process.exit(0);
}

const baseYml = join(PRESET_ROOT, BASE, 'agent.cordis.yml');
const baseGate = join(PRESET_ROOT, BASE, 'anchor-gate.mjs');
if (!existsSync(baseYml)) {
  console.log(JSON.stringify({ ok: false, error: 'base-preset-missing', path: baseYml }));
  process.exit(1);
}

const actions = [];
for (const gear of chosen) {
  const dir = join(PRESET_ROOT, gear.id);
  const yml = join(dir, 'agent.cordis.yml');
  const meta = join(dir, 'preset.yml');
  let created = false;
  if (!existsSync(yml)) {
    if (!dry) {
      mkdirSync(dir, { recursive: true });
      copyFileSync(baseYml, yml);
      if (existsSync(baseGate)) copyFileSync(baseGate, join(dir, 'anchor-gate.mjs'));
    }
    created = true;
  }
  const metaBody = `name: ${gear.name}\ndescription: ${gear.desc || ''}\norder: ${60 + EQUIP_PRESETS.indexOf(gear)}\n`;
  if (!dry) {
    copyFileSync(yml, yml + '.bak-sync-' + Date.now());
    // redteam 是底座，preset.yml 的「梦神破甲」名字是产品名，不要被装备名覆盖
    if (gear.id !== BASE) writeFileSync(meta, metaBody, 'utf8');
  }
  // 该预设里只注入它自己的装备段落
  if (!dry) {
    const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'inject-dsh-gear.mjs'), '--preset', gear.id, '--presets', gear.id], { encoding: 'utf8' });
    actions.push({ id: gear.id, name: gear.name, created, injected: r.status === 0, out: String(r.stdout || '').trim().split('\n').slice(-1)[0] });
  } else {
    actions.push({ id: gear.id, name: gear.name, created, dry: true });
  }
}

// 取消勾选的装备：整目录删掉（redteam 是底座，永不删）
const removed = [];
if (existsSync(PRESET_ROOT)) {
  for (const d of readdirSync(PRESET_ROOT, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const id = d.name;
    if (id === BASE || wanted.includes(id)) continue;
    if (!EQUIP_PRESETS.some((p) => p.id === id)) continue;
    if (!dry) rmSync(join(PRESET_ROOT, id), { recursive: true, force: true });
    removed.push(id);
  }
}

console.log(JSON.stringify({ ok: true, dry, chosen: chosen.map((p) => p.id), actions, removed }, null, 2));
