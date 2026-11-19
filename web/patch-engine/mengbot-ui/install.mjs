// MengBot · 「装备」上拉抽屉的安装 / 卸载（幂等，可反复跑）
//
//   node web/patch-engine/mengbot-ui/install.mjs            安装（或修复被 MengBot 自愈冲掉的注入）
//   node web/patch-engine/mengbot-ui/install.mjs --uninstall 卸载（还原 index.html，删组件）
//   node web/patch-engine/mengbot-ui/install.mjs --check     只看状态
//
// 做的事只有三件：① 备份 index.html ② 把 gear-drawer.js 放进 resources/ui/assets/
// ③ 在 index.html 的 </body> 前加一行 <script defer src="/assets/gear-drawer.js"></script>
// 不碰 MengBot 自己的 bundle（App-*.js），所以它的自动更新/自愈不会因为改 bundle 而崩，
// 但**会重写 index.html** —— 那种情况下重跑本脚本即可。
import { copyFileSync, existsSync, readFileSync, unlinkSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const UI = join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'Programs', 'mengbot', 'resources', 'ui');
const HTML = join(UI, 'index.html');
const BAK = join(UI, 'index.html.dshpurge.bak');
const DEST = join(UI, 'assets', 'gear-drawer.js');
const SRC = join(HERE, 'gear-drawer.js');
const TAG = '<script defer src="/assets/gear-drawer.js"></script>';
const ARGS = process.argv.slice(2);

if (!existsSync(HTML)) {
  console.error('找不到 MengBot UI：' + HTML);
  process.exit(2);
}

const read = () => readFileSync(HTML, 'utf8');
const hasTag = (t) => t.includes('gear-drawer.js');

if (ARGS.includes('--uninstall')) {
  let t = read();
  if (hasTag(t)) {
    t = t.replace(/\n?\s*<script[^>]*src="\/assets\/gear-drawer\.js"><\/script>/g, '');
    writeFileSync(HTML, t, 'utf8');
  }
  let restored = false;
  if (existsSync(BAK)) {
    // 只有在没有其它改动时才整份还原，避免把用户后续手改覆盖掉
    copyFileSync(BAK, HTML);
    restored = true;
  }
  if (existsSync(DEST)) unlinkSync(DEST);
  console.log(JSON.stringify({ ok: true, mode: 'uninstall', tagRemoved: true, restoredFromBackup: restored, removed: DEST }, null, 2));
  process.exit(0);
}

if (ARGS.includes('--check')) {
  const t = read();
  console.log(JSON.stringify({
    ok: true, mode: 'check',
    uiDir: UI,
    indexHtml: { exists: true, bytes: statSync(HTML).size, hasTag: hasTag(t) },
    backup: { exists: existsSync(BAK) },
    component: { path: DEST, exists: existsSync(DEST), bytes: existsSync(DEST) ? statSync(DEST).size : 0 },
    sourceBytes: statSync(SRC).size,
  }, null, 2));
  process.exit(0);
}

// ---- install ----
if (!existsSync(BAK)) copyFileSync(HTML, BAK);
copyFileSync(SRC, DEST);
let t = read();
let injected = false;
if (!hasTag(t)) {
  if (t.includes('</body>')) {
    t = t.replace('</body>', '    ' + TAG + '\n  </body>');
  } else {
    t += '\n' + TAG + '\n';
  }
  writeFileSync(HTML, t, 'utf8');
  injected = true;
}
const after = read();
console.log(JSON.stringify({
  ok: after.includes('gear-drawer.js') && existsSync(DEST),
  mode: 'install',
  uiDir: UI,
  component: { path: DEST, bytes: statSync(DEST).size },
  backup: BAK,
  injected,
  alreadyPresent: !injected,
  next: '重启 MengBot 生效（它会重读 index.html）；若它自更新后组件消失，重跑本脚本',
}, null, 2));
process.exit(0);
