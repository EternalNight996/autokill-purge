// host.mjs 平台适配替换（一次性脚本）
const fs = require('fs');
const p = 'F:/MyApp/eternal/autokill-purge/web/host.mjs';
let c = fs.readFileSync(p, 'utf8');
let n = 0;
const rep = (a, b) => { if (c.includes(a)) { c = c.split(a).join(b); n++; } else console.log('MISS:', a.slice(0, 60)); };

// 1) 磁盘 dsh 版本候选：npm 全局路径改为跨平台
rep(
`  const candidates = [
    'C:/Users/Administrator/AppData/Roaming/npm/node_modules/@deepseek-ai/dsh/package.json',
    join(process.env.USERPROFILE || '', '.dsh/profiles/web/node_modules/@deepseek-ai/dsh/package.json'),
    join(process.env.USERPROFILE || '', '.dsh/profiles/desktop/node_modules/@deepseek-ai/dsh/package.json'),`,
`  const candidates = [
    ...npmGlobalRoots().map((r) => join(r, '@deepseek-ai/dsh/package.json')),
    join(dshHome(), 'profiles/web/node_modules/@deepseek-ai/dsh/package.json'),
    join(dshHome(), 'profiles/desktop/node_modules/@deepseek-ai/dsh/package.json'),`);

// 2) 桌面 exe：按平台推导
rep(
`const DESKTOP_EXE_GUESS = 'C:/Users/Administrator/AppData/Local/Programs/DeepSeek Harness/DeepSeek Harness.exe';`,
`const DESKTOP_EXE_GUESS = desktopExeOf(DESKTOP.root) || (isWin ? '' : '');`);

// 3) 读取宿主命令行：跨平台
rep(
`      const child = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command',
        "(Get-CimInstance Win32_Process -Filter \\"Name='DeepSeek Harness.exe'\\" | Select-Object -ExpandProperty CommandLine) -join '\`n'"], { windowsHide: true });
      let buf = '';
      child.stdout.on('data', (d) => { buf += d; });`,
`      const child = spawn(isWin ? 'powershell' : 'ps', isWin
        ? ['-NoProfile', '-NonInteractive', '-Command',
          "(Get-CimInstance Win32_Process -Filter \\"Name='" + DESKTOP_IMAGE + "'\\" | Select-Object -ExpandProperty CommandLine) -join '\`n'"]
        : ['-Ao', 'args'], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
      let buf = '';
      child.stdout.on('data', (d) => { buf += d; });`);

// 4) dshHome 统一
rep(`process.env.DSH_HOME || join(process.env.USERPROFILE || '', '.dsh')`, `dshHome()`);
rep(`join(process.env.USERPROFILE || '', '.dsh')`, `dshHome()`);

// 5) 启动项快捷方式：Windows 专用，其它平台返回空
rep(
`const STARTUP_LNK = join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'autokill-purge.lnk');`,
`const STARTUP_LNK = isWin
  ? join(appDataDir(), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'autokill-purge.lnk')
  : '';`);

// 6) 进程存活判断 / 结束进程：跨平台
rep(
`      const child = spawn('tasklist', ['/FI', \`IMAGENAME eq \${image}\`, '/FO', 'CSV', '/NH'], { windowsHide: true });`,
`      if (!isWin) {
        const psText = await listProcessCommandLines(image);
        resolve(!!psText.trim());
        return;
      }
      const child = spawn('tasklist', ['/FI', \`IMAGENAME eq \${image}\`, '/FO', 'CSV', '/NH'], { windowsHide: true });`);

rep(`  const soft = await runDetached('taskkill', ['/IM', image]);`, `  const soft = await killImage(image);`);
rep(`  const hard = await runDetached('taskkill', ['/IM', image, '/F']);`, `  const hard = await killImage(image, { force: true });`);

fs.writeFileSync(p, c, 'utf8');
console.log('host.mjs patched blocks:', n);
