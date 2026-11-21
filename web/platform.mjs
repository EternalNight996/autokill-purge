// web/platform.mjs —— 平台适配层（Windows / macOS / Linux）
//
// 这里只做三件事：把「用户主目录 / 应用数据目录 / DSH 桌面安装根 / 进程结束」这些
// 平台差异收口到一处，避免业务代码里到处写 %APPDATA%、taskkill 和某台机器的绝对路径。
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

export const PLATFORM = process.platform; // 'win32' | 'darwin' | 'linux'
export const isWin = PLATFORM === 'win32';
export const isMac = PLATFORM === 'darwin';
export const isLinux = PLATFORM === 'linux';

/** 用户主目录：Windows 也统一走 os.homedir()，不再依赖 USERPROFILE */
export const HOME = (() => {
  const h = os.homedir();
  return h || process.env.HOME || process.env.USERPROFILE || '';
})();

/** DSH 数据目录（默认 ~/.dsh，可用 DSH_HOME 覆盖） */
export function dshHome() {
  return process.env.DSH_HOME || path.join(HOME, '.dsh');
}

/** 漫游配置目录（Windows: %APPDATA%；macOS: ~/Library/Application Support；Linux: $XDG_CONFIG_HOME） */
export function appDataDir() {
  if (isWin) return process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming');
  if (isMac) return path.join(HOME, 'Library', 'Application Support');
  return process.env.XDG_CONFIG_HOME || path.join(HOME, '.config');
}

/** 本地数据目录（Windows: %LOCALAPPDATA%；macOS 同 Application Support；Linux: $XDG_DATA_HOME） */
export function localAppDataDir() {
  if (isWin) return process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local');
  if (isMac) return path.join(HOME, 'Library', 'Application Support');
  return process.env.XDG_DATA_HOME || path.join(HOME, '.local', 'share');
}

/** npm 全局前缀（Windows 在 %APPDATA%/npm，类 Unix 在 ~/.npm-global 或 /usr/local/lib/node_modules） */
export function npmGlobalRoots() {
  if (isWin) return [path.join(appDataDir(), 'npm', 'node_modules'), path.join(process.env.ProgramFiles || 'C:/Program Files', 'nodejs', 'node_modules')];
  if (isMac) return ['/usr/local/lib/node_modules', '/opt/homebrew/lib/node_modules', path.join(HOME, '.npm-global', 'lib', 'node_modules')];
  return ['/usr/local/lib/node_modules', '/usr/lib/node_modules', path.join(HOME, '.npm-global', 'lib', 'node_modules')];
}

/** DSH 桌面安装根候选（「resources」的上一级），第一个存在的就是当前安装 */
export function desktopInstallRoots() {
  const out = [];
  if (process.env.DSH_DESKTOP_ROOT) out.push(process.env.DSH_DESKTOP_ROOT);
  if (isWin) {
    out.push(path.join(localAppDataDir(), 'Programs', 'DeepSeek Harness'));
    out.push(path.join(process.env.ProgramFiles || 'C:/Program Files', 'DeepSeek Harness'));
    out.push('C:/Program Files/DeepSeek Harness');
  } else if (isMac) {
    out.push('/Applications/DeepSeek Harness.app/Contents');
    out.push(path.join(HOME, 'Applications', 'DeepSeek Harness.app', 'Contents'));
  } else {
    out.push(path.join(process.env.OPT_ROOT || '/opt', 'DeepSeek Harness'));
    out.push(path.join(HOME, '.local', 'share', 'deepseek-harness'));
    out.push('/usr/lib/deepseek-harness');
  }
  return out;
}

/** resources 目录（macOS 在 .app/Contents/Resources） */
export function resourcesDirOf(root) {
  if (!root) return '';
  if (isMac) {
    const r = path.join(root, 'Resources');
    if (existsSync(r)) return r;
  }
  const r = path.join(root, 'resources');
  if (existsSync(r)) return r;
  // 传入的已经是 resources 本身
  if (path.basename(root).toLowerCase() === 'resources' && existsSync(root)) return root;
  return r;
}

/** 桌面可执行文件路径（Windows: *.exe；macOS: .app；Linux: 同名二进制或启动脚本） */
export function desktopExeOf(root) {
  if (!root) return '';
  if (isWin) {
    const p = path.join(root, 'DeepSeek Harness.exe');
    return p;
  }
  if (isMac) {
    // root 可能是 /Applications/DeepSeek Harness.app/Contents
    const app = root.endsWith('.app') ? root : root.replace(/\/Contents$/, '');
    return path.join(app, 'Contents', 'MacOS', 'DeepSeek Harness');
  }
  const p = path.join(root, 'deepseek-harness');
  if (existsSync(p)) return p;
  return path.join(root, 'DeepSeek Harness');
}

/** 桌面进程名（用于结束/探测） */
export const DESKTOP_IMAGE = isWin ? 'DeepSeek Harness.exe' : 'DeepSeek Harness';

/** 当前是否 Windows —— 部分能力（注册表、启动项快捷方式、WMI 脱离进程树）只在 Windows 可用 */
export function supportsWindowsTricks() {
  return isWin;
}

/** 结束一个进程映像（跨平台）：Windows taskkill，macOS/Linux pkill -f */
export function killImage(image, { force = false } = {}) {
  return new Promise((resolve) => {
    const exe = isWin ? 'taskkill' : 'pkill';
    const args = isWin
      ? ['/IM', image].concat(force ? ['/F'] : [])
      : [force ? '-9' : '-TERM', '-f', image];
    try {
      if (!isWin && !existsSync('/usr/bin/pkill') && !existsSync('/bin/pkill')) {
        resolve({ ok: false, error: 'pkill-missing' });
        return;
      }
      const child = spawn(exe, args, { windowsHide: true, stdio: 'ignore' });
      child.on('error', (e) => resolve({ ok: false, error: e.message }));
      child.on('close', (code) => resolve({ ok: code === 0, code }));
    } catch (e) {
      resolve({ ok: false, error: e.message });
    }
  });
}

/** 列出进程（跨平台，只取命令行/Mach-O 路径足够定位桌面壳） */
export function listProcessCommandLines(image) {
  return new Promise((resolve) => {
    try {
      if (isWin) {
        const cmd = `(Get-CimInstance Win32_Process -Filter "Name='${image}'" | Select-Object -ExpandProperty CommandLine) -join '\`n'`;
        const child = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', cmd], { windowsHide: true });
        let out = '';
        child.stdout.on('data', (d) => { out += d.toString(); });
        child.on('error', () => resolve(''));
        child.on('close', () => resolve(out.trim()));
        return;
      }
      const child = spawn('ps', ['-Ao', 'args'], { stdio: ['ignore', 'pipe', 'ignore'] });
      let out = '';
      child.stdout.on('data', (d) => { out += d.toString(); });
      child.on('error', () => resolve(''));
      child.on('close', () => {
        const lines = out.split('\n').filter((l) => l.toLowerCase().includes(String(image).toLowerCase()));
        resolve(lines.join('\n').trim());
      });
    } catch {
      resolve('');
    }
  });
}

/** 平台说明（写进 /api/state 与设置页，便于排查） */
export function platformInfo() {
  return {
    platform: PLATFORM,
    arch: process.arch,
    release: os.release(),
    home: HOME,
    dshHome: dshHome(),
    appData: appDataDir(),
    localAppData: localAppDataDir(),
    desktopRoots: desktopInstallRoots(),
    windowsOnly: supportsWindowsTricks(),
  };
}
