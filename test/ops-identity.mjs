// test/ops-identity.mjs —— web/ops/identity.mjs 的自测：编译幂等 / diff 行数 / dryRun 不写盘 /
// apply 后能读回且 hash 落进 override-state。
//
// 铁律：这里**一个字节都不许碰真宿主**。所有 ctx 都指向 os.tmpdir() 下的临时目录，
// dshHome 是假的，overridePath 永不等于 ~/.dsh/prompt-inject.md（模块因此也不会走
// host.writePromptFile，不会备份/写宿主）。测试结束打印 PASS/FAIL 计数，有 FAIL 就 exit 1。
import { mkdtemp, mkdir, readFile, writeFile, stat, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const mod = await import('../web/ops/identity.mjs');

let pass = 0;
let fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass += 1; console.log('PASS ' + name); return true; }
  fail += 1;
  console.log('FAIL ' + name + (extra === undefined ? '' : ' :: ' + String(extra)));
  return false;
}
function eq(actual, expected, name) {
  return ok(actual === expected, name, 'expected=' + JSON.stringify(expected) + ' actual=' + JSON.stringify(actual));
}

const root = await mkdtemp(join(tmpdir(), 'autokill-identity-test-'));
const dataDir = join(root, 'data');
const home = join(root, 'home');
await mkdir(dataDir, { recursive: true });
await mkdir(home, { recursive: true });

const CWDLIT = 'F:\\MyApp\\eternal\\autokill-purge';
const ctx = {
  dataDir,
  dshHome: home,
  resourcesDir: '',
  appDir: '',
  asarPath: '',
  asidePath: '',
  desktopExe: '',
  now: () => new Date().toISOString(),
  log() {},
  snapshot: async () => ({ id: 'noop-test' }),
};

async function listAll(dir) {
  try { return (await readdir(dir, { recursive: true })).map(String).sort(); } catch { return []; }
}
const shaFile = async (p) => createHash('sha256').update(await readFile(p)).digest('hex');
const lineCount = (t) => (String(t).endsWith('\n') ? String(t).slice(0, -1) : String(t)).split('\n').length;

try {
  // ---- 1) status：空夹具上只读，不造任何文件 --------------------------------------
  const before1 = await listAll(dataDir);
  const st0 = await mod.status(ctx);
  ok(st0.ok === true, 'status 空夹具 ok', JSON.stringify(st0.summary));
  ok(st0.available === true, 'status 空夹具 available');
  eq(st0.detail.library.source, 'builtin', 'status 无库时用内置默认片段集');
  eq(st0.detail.library.fragments, 6, '默认片段数 = 6');
  eq(st0.detail.override.exists, false, 'status 识别 override 不存在');
  eq(st0.detail.state.exists, false, 'status 识别 override-state 不存在');
  ok(Array.isArray(st0.detail.library.rows) && st0.detail.library.rows.length === 6, 'status 列出片段行');
  const after1 = await listAll(dataDir);
  eq(JSON.stringify(after1), JSON.stringify(before1), 'status() 不写盘（data 目录文件列表不变）');

  // ---- 2) plan：编译幂等 + 每段字符数 + 无 {{ }} 残留 -----------------------------
  const p1 = await mod.plan(ctx, { cwd: CWDLIT });
  const p2 = await mod.plan(ctx, { cwd: CWDLIT });
  eq(p1.compiled.sha256, p2.compiled.sha256, '同输入两次编译 sha256 相同');
  eq(p1.compiled.bytes, p2.compiled.bytes, '同输入两次编译字节数相同');
  ok(p1.compiled.lines > 20, '编译结果行数合理', p1.compiled.lines);
  eq(p1.compiled.hasPromptVariables, false, '编译结果不含 {{ }} 变量引用');
  ok(p1.library.fragments.every((f) => Number.isFinite(f.chars) && f.chars > 0), '每段都有字符数统计');
  eq(p1.library.fragments[0].id, 'identity-card', '身份卡排第一（最高优先级）');
  eq(p1.library.fragments[p1.library.fragments.length - 1].id, 'cwd-suffix', '工作目录后缀排最后');
  ok(p1.library.fragments.find((f) => f.id === 'cwd-suffix').chars === ('Working directory: ' + CWDLIT + '.').length,
    'cwd 片段按字面路径解析，不留 {{cwd}}');

  // ---- 3) dryRun：apply:true + dryRun:true 也不许写盘 -----------------------------
  const dry = await mod.run(ctx, { apply: true, dryRun: true, cwd: CWDLIT });
  ok(dry.ok === true, 'dryRun 返回 ok');
  eq(dry.changed, false, 'dryRun changed=false');
  eq(dry.detail.wrote.override, false, 'dryRun 不写 override');
  eq(dry.detail.wrote.library, false, 'dryRun 不写片段库');
  eq(existsSync(join(home, 'prompt-inject.md')), false, 'dryRun 后 override 仍不存在');
  eq(existsSync(join(dataDir, 'identity-patches.json')), false, 'dryRun 后片段库仍不存在');
  eq(dry.detail.compiled.sha256, p1.compiled.sha256, 'dryRun 编译结果与 plan 一致');

  // ---- 4) apply：落盘 + 读回 + hash 进 override-state -----------------------------
  const applied = await mod.run(ctx, { apply: true, cwd: CWDLIT });
  ok(applied.ok === true, 'apply 返回 ok', applied.error || '');
  eq(applied.changed, true, 'apply changed=true');
  eq(applied.detail.wrote.override, true, 'apply 写了 override');
  const overridePath = join(home, 'prompt-inject.md');
  ok(existsSync(overridePath), 'apply 后 override 存在');
  const readBack = await readFile(overridePath, 'utf8');
  eq(shaFileSync(readBack), p1.compiled.sha256, '读回的 override sha256 = 编译 sha256');
  eq(readBack, p1.compiled.text || readBack, '读回的 override 与编译文本逐字节一致');
  eq(lineCount(readBack), p1.compiled.lines, '读回行数 = 编译行数');

  const statePath = join(dataDir, 'identity-override-state.json');
  ok(existsSync(statePath), 'apply 后 override-state 存在');
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  eq(state.sha256, p1.compiled.sha256, 'override-state 落的是编译结果的 sha256');
  eq(state.bytes, p1.compiled.bytes, 'override-state 记字节数');
  eq(await shaFile(overridePath), state.sha256, 'override-state 的 hash = 磁盘文件的 hash');

  const st1 = await mod.status(ctx);
  eq(st1.detail.override.matchesCompiled, true, 'status: override 与片段库一致');
  eq(st1.detail.inSync, true, 'status: state 未过期');
  eq(st1.detail.state.sha256, p1.compiled.sha256, 'status 能读出 override-state 的 hash');

  // ---- 5) 幂等：同样入参第二次跑不写盘 -------------------------------------------
  const mtimeBefore = (await stat(overridePath)).mtimeMs;
  const again = await mod.run(ctx, { apply: true, cwd: CWDLIT });
  ok(again.ok === true, '重复 apply 返回 ok');
  eq(again.changed, false, '重复 apply changed=false（幂等）');
  eq(again.detail.wrote.override, false, '重复 apply 不重写 override');
  eq(again.detail.compiled.sha256, p1.compiled.sha256, '重复 apply 编译 sha 不变');
  eq((await stat(overridePath)).mtimeMs, mtimeBefore, '重复 apply 不动 mtime');

  // ---- 6) 删片段：diff 行数必须精确 ----------------------------------------------
  const prevText = readBack;
  const prevLines = lineCount(prevText);
  const pRemoved = await mod.plan(ctx, { cwd: CWDLIT, patches: [{ id: 'redteam-role', remove: true }] });
  const planRemovedLines = pRemoved.compiled.lines;
  ok(!pRemoved.library.fragments.some((f) => f.id === 'redteam-role'), '删片段后 plan 里没有该片段');
  eq(pRemoved.diff.added, 0, '纯删除：diff.added = 0');
  eq(pRemoved.diff.removed, prevLines - planRemovedLines, '纯删除：diff.removed = 行数差');
  eq(pRemoved.diff.unchanged, planRemovedLines, '纯删除：diff.unchanged = 新行数');
  eq(pRemoved.diff.same, false, '纯删除：same=false');

  // 真删 + apply：备份要把删之前的全文留住
  const removedApply = await mod.run(ctx, { apply: true, cwd: CWDLIT, patches: [{ id: 'redteam-role', remove: true }] });
  ok(removedApply.ok === true, '删片段 apply ok');
  eq(removedApply.detail.wrote.override, true, '删片段 apply 写了 override');
  const backupDir = removedApply.detail.backup;
  ok(!!backupDir && existsSync(backupDir), 'apply 前留下了备份目录', backupDir);
  const backupText = await readFile(join(backupDir, 'prompt-inject.md'), 'utf8');
  eq(backupText, prevText, '备份内容 = 写入前的 override 全文');
  const backupManifest = JSON.parse(await readFile(join(backupDir, 'manifest.json'), 'utf8'));
  eq(backupManifest.sha256, shaFileSync(prevText), '备份 manifest 的 sha256 = 旧内容 hash');
  const removedText = await readFile(overridePath, 'utf8');
  ok(!removedText.includes('红队角色'), '删除后 override 里没有红队角色段');
  eq(lineCount(removedText), planRemovedLines, '删除后磁盘行数 = plan 行数');
  eq(await shaFile(overridePath), removedApply.detail.compiled.sha256, '删除后磁盘 sha = 本次编译 sha');
  const libAfterRemove = JSON.parse(await readFile(join(dataDir, 'identity-patches.json'), 'utf8'));
  ok(!libAfterRemove.fragments.some((f) => f.id === 'redteam-role'), '片段库文件里已删掉该片段');

  // ---- 7) 加片段：diff 行数同样精确 ----------------------------------------------
  const beforeAddLines = lineCount(removedText);
  const extraText = 'EXTRA-LINE-1\nEXTRA-LINE-2\nEXTRA-LINE-3';
  const pAdded = await mod.plan(ctx, {
    cwd: CWDLIT,
    patches: [{ id: 'extra-probe', zh: '测试片段', text: extraText }],
  });
  eq(pAdded.diff.removed, 0, '纯新增：diff.removed = 0');
  eq(pAdded.diff.added, pAdded.compiled.lines - beforeAddLines, '纯新增：diff.added = 行数差');
  eq(pAdded.diff.unchanged, beforeAddLines, '纯新增：diff.unchanged = 旧行数');
  ok(pAdded.library.wouldChange === true, 'plan 报告片段库会变');
  const addedFrag = pAdded.library.fragments.find((f) => f.id === 'extra-probe');
  eq(addedFrag && addedFrag.chars, extraText.length, '新增片段字符数正确');

  // ---- 8) order：重排后首段/末尾按给定顺序 ---------------------------------------
  const pOrder = await mod.plan(ctx, { cwd: CWDLIT, order: ['identity-card', 'objective', 'ctf-contract', 'capability-protocol', 'cwd-suffix'] });
  eq(pOrder.library.fragments[0].id, 'identity-card', 'order 指定的首段生效');
  eq(pOrder.library.fragments[pOrder.library.fragments.length - 1].id, 'cwd-suffix', 'order 未列出的片段排在后面');

  // ---- 9) 变量净化：未注册变量清空、model 保留、cwd 折叠 --------------------------
  const pVar = await mod.plan(ctx, {
    cwd: CWDLIT,
    includeText: true,
    patches: [{ id: 'var-probe', text: 'A {{unknown_thing}} B {{model}} C {{cwd}} D' }],
  });
  const varText = pVar.compiled.text;
  // 只能剩 model/provider 这两个宿主真注册的变量；其它一律不许出现
  ok(!/\{\{(?!model\}\}|provider\}\})/.test(varText), '净化后没有未注册变量残留（只剩 model/provider）');
  ok(!varText.includes('{{cwd}}'), '净化后没有 {{cwd}}');
  ok(!varText.includes('unknown_thing'), '未注册变量被清空');
  ok(varText.includes('{{model}}'), 'model 变量保留（宿主会插值）');
  ok(varText.includes('Working directory: ' + CWDLIT), 'cwd 折叠成字面路径');

  // ---- 10) 全禁用 → 拒绝写入，且不动已有 override --------------------------------
  const allIds = p1.library.fragments.map((f) => f.id);
  const beforeText = await readFile(overridePath, 'utf8');
  const emptyRun = await mod.run(ctx, { apply: true, cwd: CWDLIT, patches: allIds.map((id) => ({ id, enabled: false })) });
  eq(emptyRun.ok, false, '全禁用时 run 拒绝执行');
  ok(typeof emptyRun.error === 'string' && emptyRun.error.length > 0, '全禁用返回 error 字段', emptyRun.error);
  eq(await readFile(overridePath, 'utf8'), beforeText, '全禁用时不覆盖已有 override');
  // 再开回来一个，确认 enabled:false 是可逆的
  const reEnable = await mod.plan(ctx, { cwd: CWDLIT, patches: [{ id: 'identity-card', enabled: true }] });
  ok(reEnable.compiled.bytes > 0, '片段可重新启用');

  // ---- 10.5) 自定义 overridePath（父目录还不存在）：要自己建目录 --------------------
  const nested = join(root, 'nested', 'deep', 'prompt-inject.md');
  const nestedRun = await mod.run(ctx, { apply: true, cwd: CWDLIT, overridePath: nested });
  ok(nestedRun.ok === true, '自定义 overridePath 写入成功', nestedRun.error || '');
  ok(existsSync(nested), '自定义 overridePath 的父目录被自动创建');
  eq(nestedRun.detail.writer, 'identity.mjs', '非宿主标准路径由本模块自己写（不碰宿主写入器）');
  eq(await shaFile(nested), nestedRun.detail.compiled.sha256, '自定义路径读回 sha = 编译 sha');

  // ---- 11) 异常必须被 catch 成 {ok:false}，不许抛裸异常 ---------------------------
  let threw = null;
  let bad;
  try {
    bad = await mod.run(ctx, { apply: true, cwd: CWDLIT, patches: [], overridePath: join(root, 'bad', 'x?y.md') });
  } catch (e) { threw = e; }
  eq(threw, null, '写失败不抛裸异常');
  if (bad) {
    eq(bad.ok, false, '写失败返回 ok:false');
    ok(typeof bad.error === 'string' && bad.error.length > 0, '写失败带回 error 文本', bad.error);
  }

  // ---- 12) status 依然只读（apply 之后再验一次） ---------------------------------
  const filesBefore = await listAll(dataDir);
  const ovMtime = (await stat(overridePath)).mtimeMs;
  const ovSha = await shaFile(overridePath);
  await mod.status(ctx);
  await mod.status(ctx);
  eq(JSON.stringify(await listAll(dataDir)), JSON.stringify(filesBefore), 'status() 不新增/删除 data 下文件');
  eq((await stat(overridePath)).mtimeMs, ovMtime, 'status() 不动 override mtime');
  eq(await shaFile(overridePath), ovSha, 'status() 不动 override 内容');

  // ---- 13) 自定义片段库能被读回（库文件优先于内置默认） --------------------------
  const libPath = join(dataDir, 'identity-patches.json');
  const lib = JSON.parse(await readFile(libPath, 'utf8'));
  ok(Array.isArray(lib.fragments) && lib.fragments.length >= 1, '片段库文件结构正常');
  const stLib = await mod.status(ctx);
  eq(stLib.detail.library.source, 'file', 'status 优先读自定义片段库');
  eq(stLib.detail.library.fragments, lib.fragments.length, 'status 片段数与库文件一致');
} catch (e) {
  fail += 1;
  console.log('FAIL 未捕获异常 :: ' + ((e && e.stack) || e));
} finally {
  try { await rm(root, { recursive: true, force: true }); } catch { /* 临时目录清不掉不影响结论 */ }
}

function shaFileSync(text) {
  return createHash('sha256').update(String(text), 'utf8').digest('hex');
}

console.log('\n=== identity: ' + pass + ' PASS / ' + fail + ' FAIL ===');
if (fail > 0) process.exitCode = 1;
