// test/mem-runtime.mjs —— 自维护 memory-eternal 运行时的解析与幂等验收
import { existsSync, readFileSync, mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MEM_RUNTIME_VERSION, RUNTIME_ROOT, resolveMemRoot, runtimeDir, listRuntimes, ensureMemRuntime, readVersion } from '../lib/mem-runtime.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('PASS  ' + name + (extra ? ' — ' + extra : '')); }
  else { fail++; console.log('FAIL  ' + name + (extra ? ' — ' + extra : '')); }
};

// 1) 默认解析到自维护副本（不再依赖 profile）
const r = resolveMemRoot();
ok('1. 解析到自维护副本', r.source === 'runtime', 'source=' + r.source + ' v' + r.version);
ok('1b. 目录存在且有 lib/web.js', !!r.root && existsSync(join(r.root, 'lib', 'web.js')));
ok('1c. 版本 = 钉死版本', r.version === MEM_RUNTIME_VERSION, r.version + ' vs ' + MEM_RUNTIME_VERSION);

// 2) marker 与目录一致
const marker = join(runtimeDir(), '.autokill-runtime.json');
ok('2. 有安装 marker', existsSync(marker));
if (existsSync(marker)) {
  const m = JSON.parse(readFileSync(marker, 'utf8'));
  ok('2b. marker 版本一致', m.version === MEM_RUNTIME_VERSION);
  ok('2c. marker 记录来源', typeof m.source === 'string' && m.source.length > 0, m.source);
}

// 3) 幂等：再 ensure 不应重装
const again = await ensureMemRuntime({ version: MEM_RUNTIME_VERSION });
ok('3. 幂等（第二次不重装）', again.ok === true && again.installed === false, JSON.stringify({ installed: again.installed }));
ok('3b. 幂等后目录仍在', existsSync(join(runtimeDir(), 'lib', 'web.js')));

// 4) AUTOKILL_MEM_ROOT 覆盖
const tmp = mkdtempSync(join(tmpdir(), 'akp-mem-'));
mkdirSync(join(tmp, 'lib'), { recursive: true });
writeFileSync(join(tmp, 'lib', 'web.js'), '// fake');
writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'memory-eternal', version: '9.9.9' }));
const prev = process.env.AUTOKILL_MEM_ROOT;
process.env.AUTOKILL_MEM_ROOT = tmp;
const envHit = resolveMemRoot();
if (prev === undefined) delete process.env.AUTOKILL_MEM_ROOT; else process.env.AUTOKILL_MEM_ROOT = prev;
ok('4. 环境变量覆盖生效', envHit.source === 'env' && envHit.version === '9.9.9', envHit.root || '');

// 5) 未安装的版本会回退到 profile（不抛）
const fb = resolveMemRoot({ version: '0.0.0-nope', profileFallback: true });
ok('5. 指定不存在版本 → 回退 profile 或 missing', fb.source === 'profile' || fb.source === 'missing', fb.source);
const noFb = resolveMemRoot({ version: '0.0.0-nope', profileFallback: false });
ok('5b. 关掉回退 → missing', noFb.source === 'missing');

// 6) 列表
const list = listRuntimes();
ok('6. 列表含钉死版本', list.some((x) => x.version === MEM_RUNTIME_VERSION), JSON.stringify(list.map((x) => x.version)));

console.log('\nsummary: ' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
