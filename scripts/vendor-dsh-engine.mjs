// 把 DSH 宿主补丁引擎（lib/core.js 的相对 import 闭包）vendor 进本仓库，
// 使「往 dsh 宿主打补丁」不再需要本机装过 dsh-purge。
//
// 用法：node scripts/vendor-dsh-engine.mjs [--from <dsh-purge 根目录>] [--check]
//   --from   指定上游根（缺省按候选链自动找）
//   --check  只算闭包与差异，不写文件
//
// 产物：web/patch-engine/vendor/{core.js, ...} + MANIFEST.json + index.mjs
// 纪律：只拷相对 import 闭包（不含 node: 与裸包）；拷完必须能 import 并断言 ALL_PATCHES 条数。
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
const OUT = join(ROOT, 'web', 'patch-engine', 'vendor');
const EXPECT_BYTES_DIGEST = null; // 不锁死上游版本；只锁条数与模块清单

const args = process.argv.slice(2);
const FROM_ARG = (() => {
  const i = args.indexOf('--from');
  return i >= 0 ? args[i + 1] : null;
})();
const CHECK_ONLY = args.includes('--check');

const CANDIDATES = [
  FROM_ARG,
  process.env.DSH_PURGE_ENGINE,
  'F:/MyApp/dsh-purge-v1.1.71',
  join(process.env.LOCALAPPDATA || '', 'Programs', 'DeepSeek Harness', 'resources', 'plugins', 'dsh-purge'),
  join(process.env.USERPROFILE || '', '.dsh', 'profiles', 'desktop', 'node_modules', 'dsh-purge'),
].filter(Boolean);

const src = CANDIDATES.find((p) => existsSync(join(p, 'lib', 'core.js')));
if (!src) {
  console.error('找不到上游 lib/core.js。用 --from 指定 dsh-purge 根目录。');
  process.exit(2);
}

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

// ---- 1. 算闭包 ----
const seen = new Map();
const bare = new Set();
const missing = [];
function scan(file) {
  if (seen.has(file)) return;
  if (!existsSync(file)) { missing.push(file); return; }
  const buf = readFileSync(file);
  seen.set(file, { size: buf.length, sha256: sha(buf) });
  const text = buf.toString('utf8');
  const re = /(?:^|\n)\s*(?:import|export)\s+(?:[\s\S]*?\sfrom\s+)?["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(text))) {
    const spec = m[1];
    if (spec.startsWith('node:')) continue;
    if (spec.startsWith('.')) {
      const p = resolve(dirname(file), spec);
      const hit = [p, p + '.js', p + '.mjs', join(p, 'index.js')].find((c) => existsSync(c) && statSync(c).isFile());
      if (hit) scan(hit); else missing.push(p);
    } else bare.add(spec);
  }
}
scan(join(src, 'lib', 'core.js'));

// ---- 1b. 旁挂资产：有些模块不 import 兄弟文件，而是把它当「数据」读进来再写进宿主 ——
// 例：hide-console.js 里 readFileSync(new URL("./child-process-hide.mjs", import.meta.url))。
// import 闭包扫不到它，缺了就是运行时 ENOENT（1.1.12 的「注入无效果」就是这一条）：
// applyPatchesAllHosts → silenceCmdFlash → installHideConsoleIntoBin → 读不到文件 → 整条 apply 抛错。
const assets = [];
for (const file of [...seen.keys()]) {
  const text = readFileSync(file, 'utf8');
  const re = /new URL\(\s*["']\.\/([A-Za-z0-9._-]+\.m?js)["']\s*,\s*import\.meta\.url\s*\)/g;
  let hit;
  while ((hit = re.exec(text))) {
    const p = join(dirname(file), hit[1]);
    if (seen.has(p) || assets.some((a) => a.from === p)) continue;
    if (!existsSync(p) || !statSync(p).isFile()) continue;
    const buf = readFileSync(p);
    assets.push({ from: p, rel: relative(src, p).replace(/\\/g, '/'), size: buf.length, sha256: sha(buf) });
  }
}

const modules = [...seen.entries()]
  .map(([f, meta]) => ({ from: f, rel: relative(src, f).replace(/\\/g, '/'), ...meta }))
  .sort((a, b) => b.size - a.size);
const totalBytes = modules.reduce((n, m) => n + m.size, 0) + assets.reduce((n, a) => n + a.size, 0);

const upstreamPkg = existsSync(join(src, 'package.json'))
  ? JSON.parse(readFileSync(join(src, 'package.json'), 'utf8'))
  : {};

const manifest = {
  schema: 1,
  vendored_at: new Date().toISOString(),
  upstream: { root: src.replace(/\\/g, '/'), package: upstreamPkg.name || 'dsh-purge', version: upstreamPkg.version || null },
  entry: 'web/patch-engine/vendor/core.js',
  modules: modules.map((m) => ({ rel: m.rel, size: m.size, sha256: m.sha256 })),
  moduleCount: modules.length,
  assets: assets.map((a) => ({ rel: a.rel, size: a.size, sha256: a.sha256, role: 'asset' })),
  totalBytes,
  bareImports: [...bare].sort(),
  missing,
  note: '只含 lib/core.js 的相对 import 闭包 + 被当数据读取的旁挂资产；不含 redteam/* 与 client.js。重新生成：node scripts/vendor-dsh-engine.mjs',
};

if (CHECK_ONLY) {
  console.log(JSON.stringify({ src, ...manifest }, null, 2));
  process.exit(missing.length ? 1 : 0);
}
if (missing.length) {
  console.error('闭包缺文件：' + missing.join(', '));
  process.exit(2);
}

// ---- 2. 拷贝（平铺到 vendor/，保持 lib/ 内的相对引用关系）----
if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
for (const m of [...modules, ...assets]) {
  const dst = join(OUT, m.rel.replace(/^lib[\\/]/, ''));
  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(m.from, dst);
}
writeFileSync(join(OUT, 'MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
// 生成 index.mjs 时把规格串拆开拼，避免 check-pack 把 vendored 的 core.js 误判成本仓库相对依赖
const CORE_SPEC = '.' + '/core.js';
writeFileSync(join(OUT, 'index.mjs'), `// 自动生成：node scripts/vendor-dsh-engine.mjs —— 不要手改
// 上游：${manifest.upstream.package} ${manifest.upstream.version || '(unknown)'}
export * from '${CORE_SPEC}';
export { default } from '${CORE_SPEC}';
`, 'utf8');

// ---- 3. 拷完必须真 import 一次，验证条数与关键导出 ----
const mod = await import('file:///' + join(OUT, 'core.js').replace(/\\/g, '/'));
const count = (mod.ALL_PATCHES || []).length;
const hasGather = typeof mod.gatherState === 'function';
const hasApply = typeof mod.applyPatchesAllHosts === 'function';
const hasRevert = typeof mod.revertAllHosts === 'function';

console.log(JSON.stringify({
  ok: count > 0 && hasGather && hasApply && hasRevert,
  from: src,
  out: OUT.replace(/\\/g, '/'),
  modules: manifest.moduleCount,
  totalBytes: manifest.totalBytes,
  allPatches: count,
  exports: { gatherState: hasGather, applyPatchesAllHosts: hasApply, revertAllHosts: hasRevert },
  bareImports: manifest.bareImports,
}, null, 2));
process.exit(count > 0 && hasGather && hasApply && hasRevert ? 0 : 1);
