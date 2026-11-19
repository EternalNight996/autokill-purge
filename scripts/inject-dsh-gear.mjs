// 按行号插入/替换 DSH 预设里的装备段落（避免字节偏移把上一行咬断）
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EQUIP_PRESETS } from '../web/presets.mjs';
import { renderGearMarkdown } from '../web/stage-hints.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]+$/, '');
const HOME = process.env.USERPROFILE || process.env.HOME;
const args = process.argv.slice(2);
const remove = args.includes('--remove');
const pi = args.indexOf('--preset');
const presetName = pi > -1 ? args[pi + 1] : 'redteam';
const psi = args.indexOf('--presets');
let wanted = psi > -1 ? args[psi + 1].split(',').map((s) => s.trim()).filter(Boolean) : null;

const file = join(HOME, '.dsh', '.agent-presets', presetName, 'agent.cordis.yml');
if (!existsSync(file)) { console.log('找不到预设文件：' + file); process.exit(1); }

const MARK_S = '<!-- autokill-purge:gear:start -->';
const MARK_E = '<!-- autokill-purge:gear:end -->';
const IND = '      ';

if (!wanted) {
  try {
    const st = JSON.parse(readFileSync(join(ROOT, 'data', 'state.json'), 'utf8'));
    const eq = Array.isArray(st.equipment) ? st.equipment : [];
    for (let i = eq.length - 1; i >= 0; i--) {
      // 跳过 MCP 调 purge_use_mode 自动登记的记录，只认破甲台上手动勾选的那次
      const notes = String(eq[i].notes || '');
      if (/^MCP\b/.test(notes)) continue;
      const ps = Array.isArray(eq[i].presets) ? eq[i].presets : (eq[i].preset ? [eq[i].preset] : []);
      if (ps.length) { wanted = ps; break; }
    }
  } catch { /* 下面报错 */ }
}

const rows = readFileSync(file, 'utf8').split('\n');
const sIx = rows.findIndex((l) => l.includes(MARK_S));
const eIx = rows.findIndex((l) => l.includes(MARK_E));
const hasBlock = sIx >= 0 && eIx > sIx;

if (remove) {
  if (!hasBlock) { console.log('没有装备段落，无需移除'); process.exit(0); }
  rows.splice(sIx, eIx - sIx + 1);
  while (sIx < rows.length && rows[sIx].trim() === '') rows.splice(sIx, 1);
  copyFileSync(file, file + '.bak-gear-' + Date.now());
  writeFileSync(file, rows.join('\n'), 'utf8');
  console.log('已移除装备段落（' + sIx + ' 行起）');
  process.exit(0);
}

if (!wanted || !wanted.length) {
  console.log('没有勾选任何装备（state.json 里找不到 presets），先到破甲台「一并装备」勾一下');
  process.exit(1);
}
const chosen = wanted.map((id) => EQUIP_PRESETS.find((p) => p.id === id)).filter(Boolean);
if (!chosen.length) { console.log('这些 id 都不认识：' + wanted.join(', ')); process.exit(1); }

const body = renderGearMarkdown(chosen);
const block = [
  IND + MARK_S.replace(IND, ''), // 统一缩进 6 空格
  IND + '## 装备（按任务选用；动手前先 purge_search 查，不凭记忆编命令）',
  '',
  IND + `本次装配：${chosen.map((p) => p.name).join('、')}。任务只对上一两类能力时用对应的那套；跨度大的用红队全装。`,
  '',
  ...body.split('\n').map((l) => (l.trim() === '' ? '' : IND + l)),
  IND + '### 三条纪律',
  IND + '1. 每个阶段先查库取命令与易错点，命中就引用，别重复造轮子。',
  IND + '2. 查到的卡是**别的目标**上的经验，要拿本项目证据对一遍才能用。',
  IND + '3. 阶段结论用 `purge_absorb` 回灌（落 pending，等人工审核，不要当成已通过）。',
  IND + MARK_E.replace(IND, ''),
];

if (hasBlock) {
  // 按行替换：含标记的两行一起换掉，前后行原样保留
  rows.splice(sIx, eIx - sIx + 1, ...block);
} else {
  // 插到 persona.prefix 块内部末尾：最后一个缩进 >= 6 的非空行之后
  const personaIx = rows.findIndex((l) => /^- id: persona/.test(l));
  if (personaIx < 0) { console.log('找不到 persona 组件'); process.exit(1); }
  const prefixIx = rows.findIndex((l, i) => i > personaIx && /prefix: \|/.test(l));
  if (prefixIx < 0) { console.log('persona 里找不到 prefix 块'); process.exit(1); }
  let last = -1;
  for (let i = prefixIx + 1; i < rows.length; i++) {
    if (rows[i].trim() === '') continue;
    const indent = rows[i].length - rows[i].trimStart().length;
    if (indent >= 6) { last = i; continue; }
    break;
  }
  if (last < 0) { console.log('prefix 块是空的'); process.exit(1); }
  rows.splice(last + 1, 0, ...block);
}

copyFileSync(file, file + '.bak-gear-' + Date.now());
writeFileSync(file, rows.join('\n'), 'utf8');
console.log('已注入：' + chosen.map((p) => p.name).join('、') + ' → ' + file);
console.log('段落：' + block.length + ' 行，顶层组件：' + rows.filter((l) => /^- id: /.test(l)).length + ' 个');
