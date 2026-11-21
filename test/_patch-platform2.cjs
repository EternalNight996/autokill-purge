// 跨平台收口：runner + server 的硬编码路径 / Windows 专用调用
const fs = require('fs');
const R = 'F:/MyApp/eternal/autokill-purge';

// ---------- handoff-runner ----------
let r = fs.readFileSync(R + '/scripts/handoff-runner.mjs', 'utf8');
r = r.replace(
  "import net from 'node:net';",
  "import net from 'node:net';\nimport { desktopInstallRoots, desktopExeOf, DESKTOP_IMAGE, killImage, isWin, listProcessCommandLines } from '../web/platform.mjs';"
);
r = r.replace(
  "const EXE = 'C:/Users/Administrator/AppData/Local/Programs/DeepSeek Harness/DeepSeek Harness.exe';",
  "const EXE = (() => {\n  for (const root of desktopInstallRoots()) {\n    try { const p = desktopExeOf(root); if (p && existsSync(p)) return p; } catch { /* next */ }\n  }\n  return process.env.DSH_DESKTOP_EXE || (isWin ? 'C:/Program Files/DeepSeek Harness/DeepSeek Harness.exe' : '');\n})();"
);
r = r.replace(
  "  const out = await ps(\"(Get-CimInstance Win32_Process -Filter \\\"Name='DeepSeek Harness.exe'\\\" | Select-Object -ExpandProperty CommandLine) -join '||'\");",
  "  const out = isWin\n    ? await ps(\"(Get-CimInstance Win32_Process -Filter \\\"Name='\" + DESKTOP_IMAGE + \"'\\\" | Select-Object -ExpandProperty CommandLine) -join '||'\")\n    : await listProcessCommandLines(DESKTOP_IMAGE);"
);
r = r.split("await new Promise((r) => execFile('taskkill', ['/IM', 'DeepSeek Harness.exe'], { windowsHide: true }, () => r()));").join("await killImage(DESKTOP_IMAGE);");
r = r.split("await new Promise((r) => execFile('taskkill', ['/IM', 'DeepSeek Harness.exe', '/F'], { windowsHide: true }, () => r()));").join("await killImage(DESKTOP_IMAGE, { force: true });");
fs.writeFileSync(R + '/scripts/handoff-runner.mjs', r, 'utf8');

// ---------- server.mjs ----------
let s = fs.readFileSync(R + '/web/server.mjs', 'utf8');
s = s.replace(
  "  const appData = process.env.APPDATA || join(process.env.USERPROFILE || '', 'AppData', 'Roaming');",
  "  const appData = appDataDir();"
);
s = s.replace(
  "  const local = join(process.env.LOCALAPPDATA || '', 'Programs', 'AutoKill', 'autokill.exe');",
  "  const local = join(localAppDataDir(), 'Programs', 'AutoKill', 'autokill.exe');"
);
s = s.replace(
  "    join(process.env.LOCALAPPDATA || '', 'Programs', 'AutoKill', 'autokill-cli.exe'),",
  "    join(localAppDataDir(), 'Programs', 'AutoKill', 'autokill-cli.exe'),"
);
s = s.replace(
  "  return join(process.env.APPDATA || join(process.env.USERPROFILE || '', 'AppData', 'Roaming'), 'autokill', 'config.toml');",
  "  return join(appDataDir(), 'autokill', 'config.toml');"
);
s = s.split("join(process.env.DSH_HOME || join(process.env.USERPROFILE || '', '.dsh')").join("join(dshHome()");
s = s.replace("  const home = process.env.USERPROFILE || process.env.HOME || '';", "  const home = HOME;");
fs.writeFileSync(R + '/web/server.mjs', s, 'utf8');
console.log('runner + server patched');
