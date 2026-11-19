// 安装桌面图标 + 开机自启（都指向 scripts/launch.mjs，启动记忆库与控制台 8792）。
// 记忆库端口不写死：跟 scripts/launch.mjs 一样读 ~/.dsh/autokill-purge-data/deploy.json（缺省 7989）。
//
// 图标为什么单独复制一份：
//   2026-11 之前 IconLocation 直接指 assets/autokill-purge.ico，出现「快捷方式没图标」——
//   资源目录跟着项目走，项目移动/重装/包被裁剪，图标就断了；而且没有刷新 shell 图标缓存。
//   现在固定复制到 %LOCALAPPDATA%\autokill-purge\autokill-purge.ico（稳定、短路径、无空格），
//   装完顺手清一次图标缓存。
//
// 用法：
//   node scripts/install-desktop.mjs              安装（快捷方式 + 自启 + 图标副本 + 刷缓存）
//   node scripts/install-desktop.mjs --status     看装没装
//   node scripts/install-desktop.mjs --icons-only 只修图标（重指 IconLocation + 刷缓存，不动自启）
//   node scripts/install-desktop.mjs --uninstall  卸载（只删快捷方式，不动代码与数据）
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, copyFileSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]+$/, '');
const NODE = process.execPath;
const LAUNCH = join(ROOT, 'scripts', 'launch.mjs');
// --icon <file>：换图标源（默认 assets/autokill-purge.ico，可指向 assets/icon-variants/*.ico）
const ICON_ARG_IX = process.argv.indexOf('--icon');
const ICON_ARG = ICON_ARG_IX > -1 ? process.argv[ICON_ARG_IX + 1] : '';
const ICON_SRC = ICON_ARG ? resolve(ROOT, ICON_ARG) : join(ROOT, 'assets', 'autokill-purge.ico');
// 稳定副本：不随项目目录变动，路径短且无空格（Windows 读图标更稳）
const ICON_DST = join(process.env.LOCALAPPDATA || join(process.env.USERPROFILE || '', 'AppData', 'Local'), 'autokill-purge', 'autokill-purge.ico');
const ICON = ICON_DST; // 快捷方式统一指这份
const NAME = 'autokill-purge';

// 与 launch.mjs 同一份真源，避免文案/快捷方式说明与实际端口不一致
function memPort() {
  try {
    const file = join(process.env.USERPROFILE || '', '.dsh', 'autokill-purge-data', 'deploy.json');
    const raw = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    return Number(raw.port) || 7989;
  } catch { return 7989; }
}
const MEM_PORT = memPort();
const WEB_PORT = Number(process.env.PURGE_WEB_PORT || 8792);

const MODE = process.argv.includes('--uninstall')
  ? 'uninstall'
  : (process.argv.includes('--status') ? 'status'
    : (process.argv.includes('--icons-only') ? 'icons' : 'install'));

function ps(script) {
  return execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    windowsHide: true,
  }).trim();
}

/** 把图标复制到稳定位置（内容变了才覆盖），返回副本路径 */
function ensureIcon() {
  if (!existsSync(ICON_SRC)) throw new Error('缺图标源：' + ICON_SRC);
  mkdirSync(dirname(ICON_DST), { recursive: true });
  let same = false;
  try {
    same = existsSync(ICON_DST) && statSync(ICON_DST).size === statSync(ICON_SRC).size;
  } catch { same = false; }
  if (!same) copyFileSync(ICON_SRC, ICON_DST);
  return ICON_DST;
}

/** 刷 shell 图标缓存：让新图标立刻生效（失败不影响安装） */
function refreshIconCache() {
  try { ps('ie4uinit.exe -ClearIconCache'); } catch { /* 老系统没有这个参数 */ }
  try { ps('ie4uinit.exe -show'); } catch { /* 忽略 */ }
}

function paths() {
  const desktop = ps("[Environment]::GetFolderPath('Desktop')");
  const startup = ps("[Environment]::GetFolderPath('Startup')");
  return { desktop, startup, desktopLnk: join(desktop, NAME + '.lnk'), startupLnk: join(startup, NAME + '.lnk') };
}

function status() {
  const p = paths();
  const rows = [
    ['桌面快捷方式', p.desktopLnk, existsSync(p.desktopLnk)],
    ['开机自启', p.startupLnk, existsSync(p.startupLnk)],
    ['启动器', LAUNCH, existsSync(LAUNCH)],
    ['图标副本', ICON_DST, existsSync(ICON_DST)],
    ['图标源', ICON_SRC, existsSync(ICON_SRC)],
  ];
  for (const [label, file, ok] of rows) console.log(`${ok ? '✓' : '✗'} ${label}  ${file}`);
  // 顺手报告快捷方式实际指向哪个图标（对不上就是图标没生效的原因）
  for (const [label, lnk] of [['桌面', p.desktopLnk], ['自启', p.startupLnk]]) {
    if (!existsSync(lnk)) continue;
    try {
      const got = ps(`$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('${lnk.replace(/'/g, "''")}'); Write-Output $s.IconLocation`).trim();
      const file = got.replace(/,\d+$/, '');
      const ok = file && existsSync(file);
      console.log(`${ok ? '✓' : '✗'} ${label}快捷方式的 IconLocation  ${got}${ok ? '' : '（文件不存在 → 会显示成白纸图标）'}`);
    } catch { /* 读不到就跳过 */ }
  }
  return rows.every((r) => r[2]);
}

function install() {
  const p = paths();
  if (!existsSync(LAUNCH)) throw new Error('缺启动器：' + LAUNCH);
  const icon = ensureIcon();

  // 快捷方式：目标 node.exe，参数 scripts/launch.mjs，工作目录项目根，图标用稳定副本，最小化启动
  const mk = (target) => `
$ws = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut('${target.replace(/'/g, "''")}')
$lnk.TargetPath = '${NODE.replace(/'/g, "''")}'
$lnk.Arguments = '"${LAUNCH.replace(/'/g, "''")}"'
$lnk.WorkingDirectory = '${ROOT.replace(/'/g, "''")}'
$lnk.IconLocation = '${(icon + ',0').replace(/'/g, "''")}'
$lnk.Description = 'autokill-purge 控制台（记忆库 mem-purge ${MEM_PORT} / 控制台 ${WEB_PORT}）'
$lnk.WindowStyle = 7
$lnk.Save()
Write-Output 'ok'
`;
  ps(mk(p.desktopLnk));
  ps(mk(p.startupLnk));
  refreshIconCache();

  console.log('已安装：');
  console.log('  桌面快捷方式  ' + p.desktopLnk);
  console.log('  开机自启      ' + p.startupLnk);
  console.log('  目标          ' + NODE + ' "' + LAUNCH + '"');
  console.log('  图标          ' + icon + '（从 assets 复制的稳定副本）');
  console.log('');
  console.log(`双击桌面图标 = 起记忆库(${MEM_PORT}) + 控制台(${WEB_PORT}) + 打开浏览器（已在跑就跳过）。`);
  console.log('若桌面仍是旧图标：注销一次，或结束后重启 explorer（任务管理器 → Windows 资源管理器 → 重新启动）。');
}

/** 只修图标：重指 IconLocation + 刷缓存，不动自启与目标 */
function iconsOnly() {
  const p = paths();
  const icon = ensureIcon();
  const lnks = [p.desktopLnk, p.startupLnk].filter((f) => existsSync(f));
  if (!lnks.length) {
    console.log('还没有快捷方式（先跑 node scripts/install-desktop.mjs 装一次）。图标副本已就位：' + icon);
    return;
  }
  for (const lnk of lnks) {
    ps(`
$ws = New-Object -ComObject WScript.Shell
$s = $ws.CreateShortcut('${lnk.replace(/'/g, "''")}')
$s.IconLocation = '${(icon + ',0').replace(/'/g, "''")}'
$s.Save()
Write-Output 'ok'
`);
    console.log('已重指图标  ' + lnk);
  }
  refreshIconCache();
  console.log('图标缓存已刷新。桌面还没变的话：重启 explorer 或注销一次。');
}

function uninstall() {
  const p = paths();
  for (const f of [p.desktopLnk, p.startupLnk]) {
    if (existsSync(f)) {
      ps(`Remove-Item -LiteralPath '${f.replace(/'/g, "''")}' -Force`);
      console.log('已删除 ' + f);
    }
  }
  console.log('（代码、数据、进程都没动；要停服务让对应进程退出即可。）');
}

try {
  if (MODE === 'status') { status(); }
  else if (MODE === 'uninstall') { uninstall(); }
  else if (MODE === 'icons') { iconsOnly(); status(); }
  else { install(); status(); }
} catch (e) {
  console.error('失败：' + (e && e.message ? e.message : e));
  process.exit(1);
}
