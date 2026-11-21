// scripts/build-exe.mjs —— 打 Windows 便携版：node.exe + 程序文件 + autokill-purge.exe 启动器（SEA）
//
// 为什么不是单文件 SEA：主程序是 ESM + 运行时读 web/public、patch-engine/catalog.json 等资源，
// SEA 只支持把 CJS 打成单文件。这里用 SEA 做一个极薄的 launcher.exe（它只负责找同目录的
// node.exe 和 web/server.mjs 并拉起来），程序本体和资源原样放在同目录 —— 双击即可用，零安装。
import { execFileSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const VERSION = pkg.version;
const DIST = join(ROOT, 'dist');
const NAME = 'autokill-purge-' + VERSION + '-win-x64';
const OUT = join(DIST, NAME);
const TMP = join(DIST, '_build');

const run = (cmd, args, opts = {}) => {
  const out = execFileSync(cmd, args, { cwd: opts.cwd || ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return out;
};

console.log('[1/6] 清理 dist');
rmSync(OUT, { recursive: true, force: true });
rmSync(TMP, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
mkdirSync(TMP, { recursive: true });

console.log('[2/6] 复制程序文件');
const KEEP = ['web', 'lib', 'plugin', 'break', 'gear', 'scripts', 'assets', 'package.json', 'README.md', 'README.en.md', 'CHANGELOG.md', 'SKILL.md', 'LICENSE'];
for (const item of KEEP) {
  const src = join(ROOT, item);
  if (!existsSync(src)) continue;
  cpSync(src, join(OUT, item), { recursive: true });
}
// 运行时不用的重量目录
for (const junk of ['plugin/node_modules', 'web/patch-engine/vendor/__pycache__']) {
  rmSync(join(OUT, junk), { recursive: true, force: true });
}

console.log('[3/6] 复制 node.exe 与启动器');
const NODE_EXE = process.execPath;               // 当前跑的 node.exe
copyFileSync(NODE_EXE, join(OUT, 'node.exe'));

const launcher = `
const { spawn } = require('child_process');
const { existsSync } = require('fs');
const { join, dirname } = require('path');
const dir = dirname(process.execPath);
const node = join(dir, 'node.exe');
const server = join(dir, 'web', 'server.mjs');
if (!existsSync(node) || !existsSync(server)) {
  console.error('缺文件：需要同目录下的 node.exe 与 web/server.mjs');
  process.exit(1);
}
const child = spawn(node, [server], { cwd: dir, detached: true, stdio: 'ignore', windowsHide: true });
child.unref();
console.log('autokill-purge 已启动：http://127.0.0.1:8792');
`;
writeFileSync(join(TMP, 'launcher.cjs'), launcher, 'utf8');
writeFileSync(join(TMP, 'sea-config.json'), JSON.stringify({
  main: join(TMP, 'launcher.cjs'),
  output: join(TMP, 'sea-prep.blob'),
  disableExperimentalSEAWarning: true,
}, null, 2), 'utf8');

console.log('[4/6] 生成 SEA blob');
run(process.execPath, ['--experimental-sea-config', join(TMP, 'sea-config.json')]);

console.log('[5/6] 注入 blob → autokill-purge.exe');
const exePath = join(OUT, 'autokill-purge.exe');
copyFileSync(NODE_EXE, exePath);
// postject 装在临时目录，避免污染主 package.json
// Windows 上 Node 的 spawn 不能直接跑 .cmd（EINVAL），统一走 cmd /c
const runNpm = (args) => run('cmd', ['/c', 'npm', ...args], { cwd: TMP });
runNpm(['init', '-y']);
runNpm(['i', 'postject@1.0.0-alpha.6', '--no-audit', '--no-fund', '--silent']);
const postjectBin = join(TMP, 'node_modules', 'postject', 'dist', 'cli.js');
run(process.execPath, [
  postjectBin, exePath, 'NODE_SEA_BLOB', join(TMP, 'sea-prep.blob'),
  '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
]);

console.log('[6/6] 打 zip');
const zipPath = join(DIST, NAME + '.zip');
rmSync(zipPath, { force: true });
run('powershell', ['-NoProfile', '-Command',
  `Compress-Archive -Path '${OUT}\\*' -DestinationPath '${zipPath}' -Force`]);

const sz = (p) => Math.round(statSync(p).size / 1024 / 1024 * 100) / 100;
console.log('exe  :', exePath, sz(exePath) + ' MB');
console.log('zip  :', zipPath, sz(zipPath) + ' MB');
console.log('done');
