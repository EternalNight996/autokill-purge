#!/usr/bin/env node
// scripts/ensure-mem-runtime.mjs —— 装/校验 autokill-purge 自己那份 memory-eternal 运行时
//
// 用法：
//   node scripts/ensure-mem-runtime.mjs            # 幂等安装钉死版本（默认 0.49.11）
//   node scripts/ensure-mem-runtime.mjs --version 0.49.11 --force
//   node scripts/ensure-mem-runtime.mjs --check    # 只报现状，不下载
import { MEM_RUNTIME_VERSION, ensureMemRuntime, listRuntimes, resolveMemRoot } from '../lib/mem-runtime.mjs';

const args = process.argv.slice(2);
const argOf = (name, dflt) => {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const version = argOf('version', MEM_RUNTIME_VERSION);
const force = args.includes('--force');
const checkOnly = args.includes('--check');

const before = resolveMemRoot({ version });
console.log('[ensure-mem-runtime] pinned=' + version + ' · current=' + before.source + (before.version ? ' v' + before.version : ''));

if (checkOnly) {
  console.log(JSON.stringify({ installed: listRuntimes(), resolved: before }, null, 2));
  process.exit(before.root ? 0 : 1);
}

const r = await ensureMemRuntime({ version, force });
console.log(JSON.stringify(r, null, 2));
const after = resolveMemRoot({ version });
console.log('[ensure-mem-runtime] resolved=' + after.source + ' · ' + after.root);
process.exit(r.ok && after.root ? 0 : 1);
