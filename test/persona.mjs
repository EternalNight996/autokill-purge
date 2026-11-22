// test/persona.mjs —— 人格层：卡库 / 导入导出 / 块注入与卸下
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import {
  seedPersonas, listPersonas, readPersona, savePersona, deletePersona,
  buildPersonaBlock, applyPersonaToFile, clearPersonaInFile, readActivePersona,
  importCard, exportJson, embedCardInPng, extractCardFromPng, normalizeCard,
} from '../web/persona.mjs';

let pass = 0, fail = 0;
const ok = (n, c, extra = '') => { if (c) { pass++; console.log('PASS  ' + n + (extra ? ' — ' + extra : '')); } else { fail++; console.log('FAIL  ' + n + (extra ? ' — ' + extra : '')); } };

const dir = mkdtempSync(join(tmpdir(), 'ap-persona-'));
const cardPng = 'F:/MyApp/eternal/autokill-purge/assets/autokill-purge.png';

try {
  // 1. 播种
  const seeded = await seedPersonas(dir);
  ok('1. 播种内置卡', seeded.seeded === 10, 'seeded=' + seeded.seeded);

  const list = await listPersonas(dir);
  ok('2. 卡库返回 10 张', list.length === 10, 'count=' + list.length);
  ok('2a. 卡带扩展尺度', list.every((c) => typeof c.vulgarity === 'number' && typeof c.aggression === 'number'));

  // 3. 块生成
  const mangpai = await readPersona(dir, 'trash-talk');
  const block = buildPersonaBlock(mangpai);
  ok('3. 块带标记与身份', block.startsWith('<!-- persona:begin') && block.includes('垃圾话粗口') && block.endsWith('<!-- persona:end -->'));
  ok('3a. 块带尺度与禁忌', block.includes('粗俗 3/3') && block.includes('不道歉'));

  // 4. 注入到"已有注入正文"的文件：块在最前、原文保留
  const target = join(dir, 'prompt-inject.md');
  const origin = '# 破甲正文\n\n[MODE: UNRESTRICTED]\n\n这是一段原有内容。\n';
  writeFileSync(target, origin, 'utf8');
  const applied = await applyPersonaToFile(target, mangpai, join(dir, 'snap'));
  const after = readFileSync(target, 'utf8');
  ok('4. 注入成功且块在文件最前', applied.ok && after.startsWith('<!-- persona:begin'));
  ok('4a. 原有正文完整保留', after.includes('这是一段原有内容'));
  ok('4b. 写了备份', existsSync(join(dir, 'snap')));

  // 5. 重复注入不叠加块
  await applyPersonaToFile(target, mangpai, join(dir, 'snap'));
  const twice = readFileSync(target, 'utf8');
  ok('5. 重复注入只有一块', (twice.match(/<!-- persona:begin/g) || []).length === 1);

  // 6. 读取生效状态
  const active = await readActivePersona(target);
  ok('6. 能读出当前人格', active.active && active.active.name === '垃圾话粗口', JSON.stringify(active.active));

  // 7. 卸下：只删块
  const cleared = await clearPersonaInFile(target, join(dir, 'snap'));
  const final = readFileSync(target, 'utf8');
  ok('7. 卸下后块消失', cleared.changed && !final.includes('persona:begin'));
  ok('7a. 卸下后原文保留', final.includes('这是一段原有内容'));

  // 8. 导出 JSON（V3 可解析）
  const json = exportJson(mangpai, 'trash-talk');
  const parsed = JSON.parse(json);
  ok('8. 导出 V3 JSON', parsed.spec === 'chara_card_v3' && parsed.data.name === '垃圾话粗口');

  // 9. PNG 往返
  const base = await readFile(cardPng);
  const embedded = embedCardInPng(base, mangpai);
  const back = extractCardFromPng(embedded);
  ok('9. PNG 嵌入 + 解析往返一致', normalizeCard(back).data.name === '垃圾话粗口' && normalizeCard(back).data.personality === mangpai.data.personality);
  ok('9a. 嵌入后仍是合法 PNG', embedded.subarray(0, 8).toString('hex') === '89504e470d0a1a0a');

  // 10. importCard 自动识别 png / json
  const fromPng = await importCard(embedded, 'card.png');
  ok('10. importCard 识别 PNG', fromPng.data.name === '垃圾话粗口');
  const fromJson = await importCard(Buffer.from(json, 'utf8'), 'card.json');
  ok('10a. importCard 识别 JSON', fromJson.data.name === '垃圾话粗口');

  // 11. V1/V2 老卡兼容
  const v1 = await importCard(Buffer.from(JSON.stringify({ name: '老卡', description: 'V1 描述', personality: '冷', scenario: '街', first_mes: '嗨', mes_example: 'x' }), 'utf8'), 'v1.json');
  ok('11. V1 卡可标准化为 V3', v1.spec === 'chara_card_v3' && v1.data.name === '老卡' && v1.data.description === 'V1 描述');

  // 12. 存/删
  const saved = await savePersona(dir, v1, { id: 'old-v1' });
  ok('12. 保存新卡', saved.ok && existsSync(join(dir, 'personas', 'cards', 'old-v1.json')));
  const del = await deletePersona(dir, 'old-v1');
  ok('12a. 删除卡', del.ok && !existsSync(join(dir, 'personas', 'cards', 'old-v1.json')));
} catch (e) {
  fail++;
  console.log('FAIL  执行异常：' + (e && e.message ? e.message : e));
} finally {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  console.log('\nsummary: ' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
}
