// MengBot 的 bots.json 恢复：从快照里把丢掉的 bot 找回来（默认 dry-run）。
//
//   node web/patch-engine/mengbot-ui/restore-bots.mjs                 看现状 + 该用哪份快照（不写）
//   node web/patch-engine/mengbot-ui/restore-bots.mjs --apply         真写（写前备份当前，合并而不是覆盖）
//   node web/patch-engine/mengbot-ui/restore-bots.mjs --snapshot <f>  指定快照文件
//   node web/patch-engine/mengbot-ui/restore-bots.mjs --apply --force MengBot 在跑也写（不推荐，它内存里那份会盖回来）
//
// 合并策略：以快照的 bot 顺序为主，把「当前 bots.json 里快照中没有的 bot」追加到末尾。
// 这样既找回 22~24 个 bot，也不会把 MengBot 这次新建的那个 bot 弄丢。
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';

const HOME = process.env.USERPROFILE || homedir();
const CUR = join(HOME, '.mengbot', 'bots.json');
const SNAP = join(HOME, '.dsh', 'autokill-purge-data', 'mengbot-snapshots');
const ARGS = process.argv.slice(2);
const APPLY = ARGS.includes('--apply');
const FORCE = ARGS.includes('--force');
const SNAP_ARG = (() => {
  const i = ARGS.indexOf('--snapshot');
  return i >= 0 ? ARGS[i + 1] : null;
})();

const listOf = (j) => (Array.isArray(j) ? j : (j && typeof j === 'object' ? Object.values(j).filter((x) => x && x.id) : []));

function mengbotRunning() {
  try {
    const out = execFileSync('tasklist', ['/FI', 'IMAGENAME eq MengBot.exe', '/NH'], { encoding: 'utf8', timeout: 8000, windowsHide: true });
    return /MengBot\.exe/i.test(out);
  } catch {
    return false;
  }
}

if (!existsSync(CUR)) {
  console.error('找不到 ' + CUR);
  process.exit(2);
}
const current = JSON.parse(readFileSync(CUR, 'utf8'));
const curList = listOf(current);
console.log(`当前 bots.json：${curList.length} 个 bot（${statSync(CUR).size} B）`);
console.log('  ' + curList.map((b) => b.name || b.id.slice(0, 8)).join('、'));

// 选快照：时间最新 + bot 数最多（或 --snapshot 指定）
let files = [];
if (existsSync(SNAP)) {
  files = readdirSync(SNAP).filter((f) => f.endsWith('.json')).map((f) => {
    const p = join(SNAP, f);
    let bots = 0;
    try { bots = listOf(JSON.parse(readFileSync(p, 'utf8'))).length; } catch { bots = -1; }
    return { file: p, name: f, bots, at: statSync(p).mtimeMs, bytes: statSync(p).size };
  }).filter((x) => x.bots > 0);
}

let pick = null;
if (SNAP_ARG) {
  pick = files.find((x) => x.name === SNAP_ARG || x.file === SNAP_ARG) || { file: SNAP_ARG, name: SNAP_ARG, bots: 0 };
  if (!existsSync(pick.file)) { console.error('指定的快照不存在：' + SNAP_ARG); process.exit(2); }
} else {
  pick = files.sort((a, b) => (b.bots - a.bots) || (b.at - a.at))[0] || null;
}
if (!pick) {
  console.error('没有可用快照（目录：' + SNAP + '）');
  process.exit(2);
}

const snapList = listOf(JSON.parse(readFileSync(pick.file, 'utf8')));
console.log(`\n选中的快照：${pick.name}`);
console.log(`  ${snapList.length} 个 bot（${Math.round(pick.bytes / 1024)} KB，${new Date(pick.at).toLocaleString()}）`);
console.log('  ' + snapList.slice(0, 10).map((b) => b.name || b.id.slice(0, 8)).join('、') + (snapList.length > 10 ? ' …' : ''));

// 合并：快照为主 + 当前独有的追加
const snapIds = new Set(snapList.map((b) => b.id));
const onlyNow = curList.filter((b) => !snapIds.has(b.id));
const merged = [...snapList, ...onlyNow];
const lost = curList.filter((b) => !snapIds.has(b.id));   // 会被保留（追加），不算丢
console.log(`\n合并结果：${snapList.length}（快照）+ ${onlyNow.length}（当前独有：${onlyNow.map((b) => b.name || b.id.slice(0, 8)).join('、') || '无'}）= ${merged.length} 个 bot`);

if (!APPLY) {
  console.log('\n[dry-run] 没有写任何文件。要真写：加 --apply');
  console.log('  写前会把当前 bots.json 备份到 ~/.dsh/autokill-purge-data/mengbot-snapshots/pre-restore-rb-<时间>.json');
  process.exit(0);
}

const running = mengbotRunning();
if (running && !FORCE) {
  console.error('\nMengBot 正在运行：它把 bots.json 缓存在内存里，直接写会被它覆盖（甚至让它退出）。');
  console.error('先退出 MengBot 再跑，或加 --force 强行写。');
  process.exit(3);
}

mkdirSync(SNAP, { recursive: true });
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const bak = join(SNAP, `pre-restore-rb-${stamp}.json`);
copyFileSync(CUR, bak);

// MengBot 接受顶层数组（当前文件就是数组）
writeFileSync(CUR, JSON.stringify(merged), 'utf8');

// 读回验证
const after = listOf(JSON.parse(readFileSync(CUR, 'utf8')));
console.log(JSON.stringify({
  ok: after.length === merged.length,
  wrote: CUR,
  backup: bak,
  bots: after.length,
  running,
  next: '重启 MengBot 后它才会重读 bots.json；重启后「方案 · 目标 bot」应能看到这些 bot',
}, null, 2));
