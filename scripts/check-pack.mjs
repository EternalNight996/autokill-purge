// 发布前自检：确保 package.json 的 files 白名单覆盖所有运行时相对依赖。
//
// 背景：v1.1.2 发布包漏了 break/ 目录（web/server.mjs 里 import '../break/break.mjs'），
// npm 装完控制台直接 ERR_MODULE_NOT_FOUND 起不来。这个脚本把"靠眼睛看白名单"变成机器校验。
//
// 用法：node scripts/check-pack.mjs   （已挂 prepublishOnly，npm publish 前自动跑）
// 退出码：0 = 通过；1 = 有依赖不在白名单里（会列出缺的文件）
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8').replace(/^\uFEFF/, ''));
const allow = pkg.files || [];

// npm 始终包含的项，不必写进 files
const ALWAYS = ['package.json', 'README.md', 'README.en.md', 'LICENSE', 'CHANGELOG.md', 'SKILL.md'];
const allowNorm = allow.map((p) => p.replace(/\\/g, '/'));

function covered(rel) {
  const p = rel.replace(/\\/g, '/');
  if (ALWAYS.includes(p)) return true;
  const bin = pkg.bin ? Object.values(pkg.bin).map((v) => String(v).replace(/\\/g, '/')) : [];
  if (bin.includes(p)) return true;
  return allowNorm.some((a) => (a.endsWith('/') ? p === a.slice(0, -1) || p.startsWith(a) : p === a));
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(mjs|cjs|js)$/.test(name)) out.push(full);
  }
  return out;
}

// 只在会被发布的代码里找依赖：web/ scripts/ break/
const roots = ['web', 'scripts', 'break'].map((d) => join(ROOT, d)).filter((d) => {
  try { return statSync(d).isDirectory(); } catch { return false; }
});

const files = roots.flatMap((d) => walk(d));
const missing = new Map(); // 缺失文件 -> 引用它的源文件

const RE = /(?:from\s*|import\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g;

for (const file of files) {
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(RE)) {
    const spec = m[1];
    const target = join(dirname(file), spec);
    const rel = relative(ROOT, target).replace(/\\/g, '/');
    if (rel.startsWith('..')) continue; // 仓库外的依赖（宿主 DSH 等），不归本包管
    let ok = covered(rel);
    if (!ok) {
      // 省略扩展名时补 .mjs / /index.mjs 再判一次
      const cands = [rel, rel + '.mjs', rel + '.js', rel + '/index.mjs'].filter((c) => {
        try { return statSync(join(ROOT, c)).isFile(); } catch { return false; }
      });
      ok = cands.some((c) => covered(c));
      if (!ok && cands.length) {
        for (const c of cands) missing.set(c, relative(ROOT, file).replace(/\\/g, '/'));
        continue;
      }
    }
    if (!ok) missing.set(rel, relative(ROOT, file).replace(/\\/g, '/'));
  }
}

if (missing.size) {
  console.error('[check-pack] 以下运行时依赖没有写进 package.json 的 files，装包后会 ERR_MODULE_NOT_FOUND：');
  for (const [dep, src] of missing) console.error(`  - ${dep}   （被 ${src} 引用）`);
  console.error('\n修法：把对应文件或目录加进 package.json 的 files 数组。');
  process.exit(1);
}

console.log(`[check-pack] OK：${files.length} 个源文件的相对依赖都在 files 白名单内。`);
