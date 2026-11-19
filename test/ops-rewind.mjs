// test/ops-rewind.mjs —— web/ops/rewind.mjs 的自测（零依赖、只用 node: 内置模块）
//
// 纪律：绝不碰真实 ~/.dsh 里的会话，也不碰任何宿主进程。
//   · 夹具会话 + 夹具 dataDir 全造在 data/test-fixtures/rewind 下，和线上 data/rewind-backups 完全隔离；
//   · 只读路径才碰真实会话（本文件干脆不读真实 ~/.dsh）；
//   · 每次运行先清掉上一次的夹具目录，保证结果可重复。
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as rewind from '../web/ops/rewind.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = join(HERE, '..');
const FIXTURE_ROOT = join(APP_ROOT, 'data', 'test-fixtures', 'rewind');
const FIXDATA = join(FIXTURE_ROOT, 'data');
const SLUG = '--F-tmp-rewind-demo--';

let pass = 0;
let fail = 0;
const failures = [];

function record(name, ok, detail) {
  if (ok) { pass += 1; console.log('PASS ' + name); }
  else { fail += 1; failures.push(name + ' :: ' + detail); console.log('FAIL ' + name + ' → ' + detail); }
}

function t(name, fn) {
  try {
    const r = fn();
    if (r === false) throw new Error('断言为 false');
    record(name, true);
  } catch (e) { record(name, false, (e && e.message) ? e.message : String(e)); }
}

async function ta(name, fn) {
  try {
    const r = await fn();
    if (r === false) throw new Error('断言为 false');
    record(name, true);
  } catch (e) { record(name, false, (e && e.message) ? e.message : String(e)); }
}

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

/** 把 mtime 推到 1 分钟前：模拟"宿主早就不写这个会话了"，好让活跃闸门放行。 */
function backdate(path, ms = 60000) {
  const when = new Date(Date.now() - ms);
  utimesSync(path, when, when);
}

function makeCtx(dshHome, dataDir) {
  return {
    dataDir,
    dshHome,
    sessionsRoot: join(dshHome, 'sessions'),
    now: () => new Date().toISOString(),
    log() { /* 测试里不写 data/ops.log */ },
  };
}

/** 造一段"三轮"的会话：第 1、2 轮闭合，第 3 轮还开着（模拟宿主正握在手里的那一轮）。 */
function demoEvents() {
  const human = (seq, id, text) => ({ type: 'user/message', seq, time: 1700000000000 + seq, data: { id, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] } });
  const say = (seq, text) => ({ type: 'assistant/message', seq, time: 1700000000000 + seq, data: { role: 'assistant', content: [{ type: 'text', text }] } });
  return [
    { type: 'permission/preset', seq: 0, time: 1700000000000, data: { preset: 'danger-full-access' } },
    { type: 'turn/start', seq: 1, time: 1700000000001, data: { turn: 1 } },
    human(2, 'u-1', '第一轮问题'),
    { type: 'user/message', seq: 3, time: 1700000000003, data: { id: 'ctx-1', source: { kind: 'runtime-context', form: 'snapshot' }, content: [{ type: 'text', text: 'Current working directory: ...' }] } },
    say(4, '第一轮回答'),
    { type: 'turn/end', seq: 5, time: 1700000000005, data: { turn: 1, reason: { kind: 'completed' } } },
    { type: 'turn/start', seq: 6, time: 1700000000006, data: { turn: 2 } },
    human(7, 'u-2', '第二轮问题'),
    say(8, '第二轮回答'),
    { type: 'tool/call', seq: 9, time: 1700000000009, data: { name: 'edit', arguments: { file_path: 'web/ops/rewind.mjs' } } },
    { type: 'tool/result', seq: 10, time: 1700000000010, data: { content: [{ type: 'text', text: '{"ok":true}' }] } },
    { type: 'turn/end', seq: 11, time: 1700000000011, data: { turn: 2, reason: { kind: 'completed' } } },
    { type: 'turn/start', seq: 12, time: 1700000000012, data: { turn: 3 } },
    human(13, 'u-3', '第三轮问题'),
    say(14, '第三轮回答（还没结束）'),
  ];
}

function writeFixtureSession({ sessionId, events, compression = 'zstd', fileName = 'session.v4.jsonl.zstd' }) {
  const dir = join(FIXTURE_ROOT, 'dshhome', 'sessions', SLUG, sessionId);
  mkdirSync(dir, { recursive: true });
  const header = { type: 'session', version: 4, id: sessionId, createdAt: 1700000000000, cwd: 'F:\\tmp\\rewind-demo', isSeeded: false, delegationDepth: 0, agentPreset: 'standard' };
  const lines = [JSON.stringify(header)].concat(events.map((e) => JSON.stringify(e)));
  const bytes = rewind.encodeSessionBytes(lines, { compression });
  const path = join(dir, fileName);
  writeFileSync(path, bytes);
  backdate(path);
  return { dir, path, bytes, lines };
}

// ─────────────────────────────── 开跑 ───────────────────────────────
rmSync(FIXTURE_ROOT, { recursive: true, force: true });
mkdirSync(join(FIXTURE_ROOT, 'dshhome', 'sessions'), { recursive: true });
const CTX = makeCtx(join(FIXTURE_ROOT, 'dshhome'), FIXDATA);
const BACKUPS = join(FIXDATA, 'rewind-backups');
const SID = 'session-fixture-0001';
const fx = writeFixtureSession({ sessionId: SID, events: demoEvents() });
const ORIGINAL_SHA = sha(fx.bytes);

console.log('--- META / 纯函数 ---');
t('META 形状齐全', () => rewind.META.id === 'rewind' && !!rewind.META.zh && !!rewind.META.en
  && rewind.META.kind === 'both' && Array.isArray(rewind.META.requires));
t('encode→decode 往返一致（zstd）', () => {
  const bytes = rewind.encodeSessionBytes(fx.lines, { compression: 'zstd' });
  const back = rewind.decodeSession(bytes).text.split('\n').filter(Boolean);
  return back.length === fx.lines.length && back[0] === fx.lines[0] && back[back.length - 1] === fx.lines[fx.lines.length - 1];
});
t('encode→decode 往返一致（明文）', () => {
  const bytes = rewind.encodeSessionBytes(fx.lines, { compression: 'none' });
  return bytes[0] === 0x7b && rewind.decodeSession(bytes).compression === 'none';
});
t('多帧拆解：帧数 > 1、总行数正确、无半帧', () => {
  const dec = rewind.decodeSession(fx.bytes);
  const lines = dec.text.split('\n').filter(Boolean);
  return dec.compression === 'zstd' && dec.frames >= 2 && lines.length === fx.lines.length && dec.torn === false;
});
t('坏魔数被 scanZstdFrames 拒绝', () => {
  let threw = false;
  try { rewind.scanZstdFrames(Buffer.from([0, 1, 2, 3, 4, 5, 6, 7])); } catch { threw = true; }
  return threw;
});
t('非会话文件被 decodeSession 拒绝', () => {
  let threw = false;
  try { rewind.decodeSession(Buffer.from('hello world')); } catch { threw = true; }
  return threw;
});

console.log('--- status() ---');
let statusBefore = null;
await ta('status 可用且读出夹具会话的元信息', async () => {
  statusBefore = await rewind.status(CTX);
  if (!statusBefore.ok || !statusBefore.available) throw new Error('available=false: ' + statusBefore.summary);
  if (statusBefore.detail.sessions.length !== 1) throw new Error('会话数应为 1，实际 ' + statusBefore.detail.sessions.length);
  const s = statusBefore.detail.sessions[0];
  if (s.id !== SID) throw new Error('id 不对：' + s.id);
  if (s.format !== 'v4' || s.compression !== 'zstd') throw new Error('格式识别错：' + s.format + '/' + s.compression);
  if (s.events !== 15) throw new Error('事件数应为 15，实际 ' + s.events);
  if (s.turns !== 2) throw new Error('闭合轮数应为 2，实际 ' + s.turns);
  if (s.rewindable !== 2) throw new Error('可回退轮数应为 2，实际 ' + s.rewindable);
  if (s.openTurn !== true) throw new Error('没识别出开着的那一轮');
  if (!s.lastHuman || s.lastHuman.text !== '第三轮问题') throw new Error('最后人类消息错：' + JSON.stringify(s.lastHuman));
  return true;
});
t('status 只读：文件字节未变', () => sha(readFileSync(fx.path)) === ORIGINAL_SHA);
t('status 只读：没建备份目录', () => !existsSync(BACKUPS));
await ta('status 忽略目录里的非会话文件', async () => {
  const dir = join(FIXTURE_ROOT, 'dshhome', 'sessions', SLUG, 'session-junk-0002');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'notes.txt'), 'x\n');
  writeFileSync(join(dir, 'weird.log'), 'x\n');
  const st = await rewind.status(CTX);
  if (st.detail.sessions.length !== 1) throw new Error('非会话目录被当成了会话：' + st.detail.sessions.map((x) => x.id).join(','));
  return !st.detail.sessions.some((x) => x.id === 'session-junk-0002');
});

console.log('--- plan() ---');
let p1 = null;
await ta('plan(last-turn)：边界=第二轮 turn/start，scope 精确', async () => {
  p1 = await rewind.plan(CTX, { sessionId: SID });
  if (!p1.ok) throw new Error(p1.error);
  if (p1.fromSeq !== 6) throw new Error('fromSeq 应为 6，实际 ' + p1.fromSeq);
  if (p1.toSeq !== 14) throw new Error('toSeq 应为 14，实际 ' + p1.toSeq);
  if (p1.dropCount !== 9) throw new Error('dropCount 应为 9，实际 ' + p1.dropCount);
  if (p1.dropTurns !== 1) throw new Error('dropTurns 应为 1');
  if (p1.text !== '第二轮问题') throw new Error('回退文本错：' + p1.text);
  if (p1.linesBefore !== 16 || p1.linesAfter !== 7) throw new Error('行数预期 16→7，实际 ' + p1.linesBefore + '→' + p1.linesAfter);
  if (p1.leavesOpenTurn !== false) throw new Error('截完应正好停在 turn/end 上');
  if (!p1.preview.length || p1.preview[0].seq !== 6 || p1.preview[0].type !== 'turn/start') throw new Error('preview 首行不对：' + JSON.stringify(p1.preview[0]));
  return true;
});
await ta('plan(last-turns:2)：回退到第一轮 turn/start', async () => {
  const p = await rewind.plan(CTX, { sessionId: SID, mode: 'last-turns', turns: 2 });
  if (!p.ok) throw new Error(p.error);
  if (p.fromSeq !== 1) throw new Error('fromSeq 应为 1，实际 ' + p.fromSeq);
  if (p.dropTurns !== 2) throw new Error('dropTurns 应为 2');
  if (p.text !== '第一轮问题') throw new Error('窗口内最后一条提示应取第一轮：' + p.text);
  return true;
});
await ta('plan(to-seq)：停在 turn/start 上并标记开着回合', async () => {
  const p = await rewind.plan(CTX, { sessionId: SID, mode: 'to-seq', seq: 7 });
  if (!p.ok) throw new Error(p.error);
  if (p.fromSeq !== 7 || p.dropCount !== 8) throw new Error('fromSeq/dropCount 不对：' + p.fromSeq + '/' + p.dropCount);
  if (p.leavesOpenTurn !== true) throw new Error('保留前缀停在 turn/start(seq=6)，应报 leavesOpenTurn');
  return true;
});
await ta('plan 拒绝不存在的 seq', async () => {
  const p = await rewind.plan(CTX, { sessionId: SID, mode: 'to-seq', seq: 999 });
  return p.ok === false && /seq=999/.test(p.error);
});
await ta('plan 拒绝路径穿越的 sessionId', async () => {
  const p = await rewind.plan(CTX, { sessionId: '../../evil' });
  return p.ok === false && /sessionId/.test(p.error);
});
await ta('plan 拒绝未知 sessionId', async () => {
  const p = await rewind.plan(CTX, { sessionId: 'session-nope' });
  return p.ok === false && /没有这个会话/.test(p.error);
});
await ta('plan 全程不写盘', async () => sha(readFileSync(fx.path)) === ORIGINAL_SHA && !existsSync(BACKUPS));

console.log('--- run(dryRun) ---');
await ta('dryRun：不写盘、不建备份、changed=false', async () => {
  const r = await rewind.run(CTX, { sessionId: SID, mode: 'last-turn', dryRun: true });
  if (!r.ok || r.changed !== false) throw new Error('dryRun 结果不对：' + JSON.stringify({ ok: r.ok, changed: r.changed, error: r.error }));
  if (sha(readFileSync(fx.path)) !== ORIGINAL_SHA) throw new Error('dryRun 改了文件');
  if (existsSync(BACKUPS)) throw new Error('dryRun 建了备份目录');
  if (r.detail.dryRun !== true || r.detail.linesAfter !== 7) throw new Error('detail 不对：linesAfter=' + r.detail.linesAfter);
  return /\[dry-run\]/.test(r.summary);
});

console.log('--- 活跃会话闸门 ---');
await ta('mtime 在 3 秒内 → 拒绝并提示会话活跃', async () => {
  utimesSync(fx.path, new Date(), new Date());
  const r = await rewind.run(CTX, { sessionId: SID, mode: 'last-turn' });
  if (r.ok !== false || r.changed !== false) throw new Error('应当拒绝：' + JSON.stringify(r));
  if (!/会话活跃/.test(r.error || '')) throw new Error('错误文案不对：' + r.error);
  if (sha(readFileSync(fx.path)) !== ORIGINAL_SHA) throw new Error('被拒绝了却仍然改了文件');
  return true;
});
await ta('活跃会话上 dryRun 仍给预览，并带 wouldRefuse', async () => {
  utimesSync(fx.path, new Date(), new Date());
  const r = await rewind.run(CTX, { sessionId: SID, mode: 'last-turn', dryRun: true });
  return r.ok === true && r.changed === false && r.detail.active === true && /会话活跃/.test(r.detail.wouldRefuse || '');
});

console.log('--- run 真写 ---');
let run1 = null;
await ta('真写：16 行 → 7 行，备份 + manifest 就位', async () => {
  backdate(fx.path);
  run1 = await rewind.run(CTX, { sessionId: SID, mode: 'last-turn' });
  if (!run1.ok || !run1.changed) throw new Error('真写失败：' + JSON.stringify({ ok: run1.ok, changed: run1.changed, error: run1.error }));
  const dec = rewind.decodeSession(readFileSync(fx.path));
  const rows = dec.text.split('\n').filter(Boolean);
  if (rows.length !== 7) throw new Error('写后行数应为 7，实际 ' + rows.length);
  if (run1.detail.linesBefore !== 16 || run1.detail.linesAfter !== 7) throw new Error('detail 行数不对');
  if (run1.detail.writeMode !== 'rename') throw new Error('应走 rename 原子替换，实际 ' + run1.detail.writeMode);
  if (!existsSync(run1.detail.backupDir)) throw new Error('备份目录不存在');
  const manifestPath = join(run1.detail.backupDir, 'manifest.json');
  if (!existsSync(manifestPath)) throw new Error('manifest.json 不存在');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.before.sha256 !== ORIGINAL_SHA) throw new Error('manifest 的原文 sha 不对');
  if (manifest.after.lines !== 7) throw new Error('manifest 的新行数不对');
  if (manifest.backup.sha256 !== ORIGINAL_SHA || manifest.backup.identical !== true) throw new Error('备份 sha 与原文不匹配');
  if (sha(readFileSync(join(run1.detail.backupDir, manifest.backupFile))) !== ORIGINAL_SHA) throw new Error('备份文件内容与原文不一致');
  return true;
});
t('写后尾部事件止于 seq=5（turn/end）', () => {
  const rows = rewind.decodeSession(readFileSync(fx.path)).text.split('\n').filter(Boolean);
  const last = JSON.parse(rows[rows.length - 1]);
  return last.seq === 5 && last.type === 'turn/end';
});
t('写后会话头保持原样', () => {
  const rows = rewind.decodeSession(readFileSync(fx.path)).text.split('\n').filter(Boolean);
  return rows[0] === fx.lines[0];
});
t('detail.text 可回填输入框', () => run1.detail.text === '第二轮问题');
await ta('再次 plan 落到第一轮', async () => {
  const p = await rewind.plan(CTX, { sessionId: SID });
  return p.ok === true && p.fromSeq === 1 && p.dropCount === 5;
});
await ta('to-seq 把日志砍到只剩 头 + seq0', async () => {
  backdate(fx.path);
  const r = await rewind.run(CTX, { sessionId: SID, mode: 'to-seq', seq: 1 });
  if (!r.ok || !r.changed) throw new Error('to-seq 失败：' + r.error);
  const rows = rewind.decodeSession(readFileSync(fx.path)).text.split('\n').filter(Boolean);
  return rows.length === 2 && JSON.parse(rows[1]).seq === 0;
});
await ta('无可回退轮次 → ok + changed=false（幂等）', async () => {
  backdate(fx.path);
  const r = await rewind.run(CTX, { sessionId: SID, mode: 'last-turn' });
  if (r.ok !== true || r.changed !== false) throw new Error('应 ok+unchanged：' + JSON.stringify({ ok: r.ok, changed: r.changed, error: r.error }));
  return /没有可回退/.test(r.summary);
});

console.log('--- 明文（compression:none）会话 ---');
const plainSid = 'session-fixture-0003';
const plain = writeFixtureSession({ sessionId: plainSid, events: demoEvents(), compression: 'none', fileName: 'session.v3.jsonl' });
await ta('明文会话 plan/run 正常，写回仍是明文', async () => {
  const p = await rewind.plan(CTX, { sessionId: plainSid });
  if (!p.ok || p.compression !== 'none') throw new Error('plan 不对：' + (p.error || p.compression));
  const r = await rewind.run(CTX, { sessionId: plainSid, mode: 'last-turn' });
  if (!r.ok || !r.changed) throw new Error('run 失败：' + r.error);
  const buf = readFileSync(plain.path);
  if (buf.length >= 4 && buf.readUInt32LE(0) === 0xfd2fb528) throw new Error('明文会话被写成了 zstd');
  return buf.toString('utf8').split('\n').filter(Boolean).length === 7 && r.detail.compression === 'none';
});
await ta('force 可绕过活跃闸门（只有测试/应急用）', async () => {
  utimesSync(plain.path, new Date(), new Date());
  const refused = await rewind.run(CTX, { sessionId: plainSid, mode: 'last-turn' });
  if (refused.ok !== false) throw new Error('未 force 时应当拒绝');
  const forced = await rewind.run(CTX, { sessionId: plainSid, mode: 'last-turn', force: true });
  return forced.ok === true && forced.changed === true;
});
t('备份目录按 <ts>-<id> 累积，各自带 manifest', () => {
  const dirs = readdirSync(BACKUPS).filter((n) => existsSync(join(BACKUPS, n, 'manifest.json')));
  const withSid = dirs.filter((n) => n.endsWith('-' + SID) || n.includes('-' + SID + '-'));
  return dirs.length >= 3 && withSid.length >= 2;
});
await ta('拒绝把「只有非会话文件」的目录当目标', async () => {
  const r = await rewind.run(CTX, { sessionId: 'session-junk-0002', mode: 'last-turn' });
  return r.ok === false && /没有这个会话/.test(r.error);
});
await ta('拒绝缺 sessionId 的调用', async () => {
  const r = await rewind.run(CTX, { mode: 'last-turn' });
  return r.ok === false && /sessionId/.test(r.error);
});

console.log('--- UI 兜底：候选清单 / auto ---');
const autoSid = 'session-fixture-0004';
writeFixtureSession({ sessionId: autoSid, events: demoEvents() });
await ta('缺 sessionId 时返回候选清单（供 UI 渲染选择器）', async () => {
  const r = await rewind.run(CTX, { mode: 'last-turn' });
  if (r.ok !== false) throw new Error('应当拒绝并要求 sessionId');
  if (!r.detail || r.detail.needsSessionId !== true) throw new Error('缺少 needsSessionId 标记');
  if (!Array.isArray(r.detail.candidates) || r.detail.candidates.length === 0) throw new Error('候选清单为空');
  const top = r.detail.candidates[0];
  if (!top.id || !Number.isFinite(top.rewindable) || top.rewindable < 1) throw new Error('候选字段不全：' + JSON.stringify(top));
  return /sessionId/.test(r.error) && top.id === autoSid;
});
await ta('sessionId:"auto" 会挑最近的可回退会话并标 autoPicked', async () => {
  const p = await rewind.plan(CTX, { sessionId: 'auto' });
  if (!p.ok) throw new Error(p.error);
  if (p.autoPicked !== true || p.sessionId !== autoSid) throw new Error('auto 选错了：' + p.sessionId);
  const r = await rewind.run(CTX, { sessionId: 'auto', mode: 'last-turn', dryRun: true });
  return r.ok === true && r.changed === false && r.detail.autoPicked === true && r.detail.sessionId === autoSid;
});
await ta('auto + 不存在的 seq → 一行都不写', async () => {
  const path = join(FIXTURE_ROOT, 'dshhome', 'sessions', SLUG, autoSid, 'session.v4.jsonl.zstd');
  const before = sha(readFileSync(path));
  const r = await rewind.run(CTX, { sessionId: 'auto', mode: 'to-seq', seq: 999999, dryRun: true });
  return r.changed === false && sha(readFileSync(path)) === before;
});
await ta('auto 在空会话目录里报错而不是瞎选', async () => {
  const emptyCtx = makeCtx(join(FIXTURE_ROOT, 'empty-dshhome'), join(FIXTURE_ROOT, 'empty-data'));
  mkdirSync(join(FIXTURE_ROOT, 'empty-dshhome', 'sessions'), { recursive: true });
  const r = await rewind.plan(emptyCtx, { sessionId: 'auto' });
  return r.ok === false && /可自动挑选/.test(r.error);
});

console.log('');
console.log('PASS ' + pass + ' / FAIL ' + fail);
if (fail) {
  console.log('失败项：');
  for (const f of failures) console.log('  - ' + f);
  process.exitCode = 1;
}