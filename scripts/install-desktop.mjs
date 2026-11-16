// 安装桌面图标 + 开机自启（都指向 scripts/launch.mjs，启动记忆库 7989 与控制台 8792）。
//
// 用法：
//   node scripts/install-desktop.mjs            安装（桌面快捷方式 + 启动项自启）
//   node scripts/install-desktop.mjs --status   看装没装
//   node scripts/install-desktop.mjs --uninstall 卸载（只删快捷方式，不动代码与数据）
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]+$/, '');
const NODE = process.execPath;
const LAUNCH = join(ROOT, 'scripts', 'launch.mjs');
const ICON = join(ROOT, 'assets', 'autokill-purge.ico');
const NAME = 'autokill-purge';

const MODE = process.argv.includes('--uninstall') ? 'uninstall' : (process.argv.includes('--status') ? 'status' : 'install');

function ps(script) {
  return execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    windowsHide: true,
  }).trim();
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
    ['图标', ICON, existsSync(ICON)],
  ];
  for (const [label, file, ok] of rows) console.log(`${ok ? '✓' : '✗'} ${label}  ${file}`);
  return rows.every((r) => r[2]);
}

function install() {
  const p = paths();
  if (!existsSync(LAUNCH)) throw new Error('缺启动器：' + LAUNCH);
  if (!existsSync(ICON)) throw new Error('缺图标：' + ICON);

  // 快捷方式：目标 node.exe，参数 scripts/launch.mjs，工作目录项目根，图标用生成的那个，最小化启动
  const mk = (target) => `
$ws = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut('${target.replace(/'/g, "''")}')
$lnk.TargetPath = '${NODE.replace(/'/g, "''")}'
$lnk.Arguments = '"${LAUNCH.replace(/'/g, "''")}"'
$lnk.WorkingDirectory = '${ROOT.replace(/'/g, "''")}'
$lnk.IconLocation = '${ICON.replace(/'/g, "''")}'
$lnk.Description = 'autokill-purge 控制台（记忆库 mem-purge 7989 / 控制台 8792）'
$lnk.WindowStyle = 7
$lnk.Save()
Write-Output 'ok'
`;
  ps(mk(p.desktopLnk));
  ps(mk(p.startupLnk));

  console.log('已安装：');
  console.log('  桌面快捷方式  ' + p.desktopLnk);
  console.log('  开机自启      ' + p.startupLnk);
  console.log('  目标          ' + NODE + ' "' + LAUNCH + '"');
  console.log('  图标          ' + ICON);
  console.log('');
  console.log('双击桌面图标 = 起记忆库(7989) + 控制台(8792) + 打开浏览器（已在跑就跳过）。');
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
  else { install(); status(); }
} catch (e) {
  console.error('失败：' + (e && e.message ? e.message : e));
  process.exit(1);
}
