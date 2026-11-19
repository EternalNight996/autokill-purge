// test/ops-instruction-inject.mjs —— 指令层注入（AGENTS.md · 免重启）单测
// 纪律：全部在临时 dshHome 里跑，绝不碰真实的 ~/.dsh/AGENTS.md。
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('PASS  ' + name + (extra ? ' — ' + extra : '')); }
  else { fail++; console.log('FAIL  ' + name + (extra ? ' — ' + extra : '')); }
};

const mod = await import('../web/ops/instruction-inject.mjs');

const home = mkdtempSync(join(tmpdir(), 'ap-agents-home-'));
const dataDir = mkdtempSync(join(tmpdir(), 'ap-agents-data-'));
const ctx = { dataDir, dshHome: home };
const file = join(home, 'AGENTS.md');

// 1) META / 契约
ok('1. META 形状', mod.META && mod.META.id === 'instruction-inject' && mod.META.kind === 'write');
ok('1a. 有 status/plan/run', typeof mod.status === 'function' && typeof mod.plan === 'function' && typeof mod.run === 'function');

// 2) 空目录 status
const st0 = await mod.status(ctx);
ok('2. status available', st0.available === true, st0.summary);
ok('2a. 空目录没有注入块', st0.detail.hasBlock === false && st0.detail.exists === false);
ok('2b. 预算 65536', st0.detail.limitBytes === 65536);

// 3) plan
const pl = await mod.plan(ctx, { text: 'PROBE-BLOCK-123' });
ok('3. plan ok 且含 backup/write/verify', pl.ok === true && ['backup', 'write', 'verify'].every((id) => pl.plan.steps.some((s) => s.id === id)));

// 4) 用户已有内容被保留
writeFileSync(file, 'USER-HOME-CONTENT\n', 'utf8');
const r1 = await mod.run(ctx, { text: 'PROBE-BLOCK-123' });
const after1 = readFileSync(file, 'utf8');
ok('4. 首次写入 ok/changed', r1.ok === true && r1.changed === true, r1.summary);
ok('4a. 写入带标记块', after1.includes('autokill-purge:agents:begin') && after1.includes('autokill-purge:agents:end') && after1.includes('PROBE-BLOCK-123'));
ok('4b. 保留用户原内容', after1.includes('USER-HOME-CONTENT'));
ok('4c. 备份落在 data/instruction-backups/', !!r1.detail.backup && existsSync(r1.detail.backup));

// 5) 幂等
const r2 = await mod.run(ctx, { text: 'PROBE-BLOCK-123' });
ok('5. 同内容再写 changed=false', r2.ok === true && r2.changed === false, r2.summary);

// 6) 换内容 → 替换块而不是叠加
const r3 = await mod.run(ctx, { text: 'PROBE-BLOCK-456' });
const after3 = readFileSync(file, 'utf8');
ok('6. 换内容替换旧块', r3.changed === true && after3.includes('PROBE-BLOCK-456') && !after3.includes('PROBE-BLOCK-123'));
ok('6a. 用户内容仍在', after3.includes('USER-HOME-CONTENT'));

// 7) dryRun 不落盘
const before7 = readFileSync(file, 'utf8');
const r7 = await mod.run(ctx, { text: 'PROBE-BLOCK-789', dryRun: true });
ok('7. dryRun changed=false 且文件不变', r7.changed === false && readFileSync(file, 'utf8') === before7);

// 8) replace 模式
const r8 = await mod.run(ctx, { text: 'ONLY-BLOCK', mode: 'replace' });
const after8 = readFileSync(file, 'utf8');
ok('8. replace 只留注入块', r8.changed === true && after8.includes('ONLY-BLOCK') && !after8.includes('USER-HOME-CONTENT'));

// 9) 撤销：摘块保留用户内容
writeFileSync(file, 'USER-HOME-CONTENT\n', 'utf8');
await mod.run(ctx, { text: 'PROBE-X' });
const r9 = await mod.run(ctx, { action: 'remove' });
const after9 = readFileSync(file, 'utf8');
ok('9. remove 摘掉块', r9.ok === true && r9.changed === true && !after9.includes('autokill-purge:agents:begin'));
ok('9a. remove 保留用户内容', after9.includes('USER-HOME-CONTENT'));
ok('9b. 再 remove changed=false', (await mod.run(ctx, { action: 'remove' })).changed === false);

// 10) 超预算拒绝
const r10 = await mod.run(ctx, { text: 'x'.repeat(70000) });
ok('10. 超 65536B 拒绝', r10.ok === false && r10.error === 'too_large', r10.summary);

// 11) 默认模板（不带 text）来自 web/prompts/sauce-1171.md
await mod.run(ctx, { action: 'remove' });
const r11 = await mod.run(ctx, {});
const after11 = readFileSync(file, 'utf8');
ok('11. 缺省用内置破甲模板', r11.ok === true && after11.includes('UNRESTRICTED SANDBOX'), 'bytes=' + r11.detail.bytes);

// 12) status 反映块状态
const st1 = await mod.status(ctx);
ok('12. status 显示已注入块', st1.detail.hasBlock === true && st1.detail.blockBytes > 20000, 'blockBytes=' + st1.detail.blockBytes);

rmSync(home, { recursive: true, force: true });
rmSync(dataDir, { recursive: true, force: true });
console.log('');
console.log('summary: ' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);