#!/usr/bin/env node
// 回归：撤销补丁层「点了没反应」
//  1) 快照按 manifest.at 排序，不再被 skill-* / rule-* 这类前缀 id 骗到
//  2) 默认恢复跳过调用方刚建的 guard 快照与 0 文件空快照
//  3) restoreSnapshot 真的把 blob 写回目标文件，并把 restored 数量报出来
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { listSnapshots, pickRestoreSnapshot, restoreSnapshot } from '../web/host.mjs';

let pass = 0;
const fails = [];
function ok(cond, name, extra = '') {
  if (cond) { pass += 1; return; }
  fails.push(name + (extra ? ' :: ' + extra : ''));
}

const root = await mkdtemp(join(tmpdir(), 'akp-restore-'));
const dataDir = join(root, 'data');
const snapRoot = join(dataDir, 'host-snapshots');
const target = join(root, 'hostfile.js');

async function snap(id, at, files) {
  const dir = join(snapRoot, id);
  await mkdir(dir, { recursive: true });
  const manifest = { id, at, tag: id.split('-').slice(2).join('-') || 'manual', files: [], bytes: 0 };
  for (const [i, f] of files.entries()) {
    const blob = String(i).padStart(3, '0') + '-' + f.name;
    await writeFile(join(dir, blob), f.body);
    manifest.files.push({ key: 'k' + i, path: f.path, blob, bytes: f.body.length, sha256: 'x' });
    manifest.bytes += f.body.length;
  }
  await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return id;
}

try {
  await writeFile(target, 'PATCHED-BYTES');

  // skill-* 是空快照（历史遗留），id 字符串天生大于 2026…，旧实现会把「最新」判给它
  await snap('skill-20261117-192550', '2026-11-17T11:25:50.440Z', []);
  await snap('20261121-100000-pre-apply', '2026-11-21T02:00:00.000Z', [{ name: 'hostfile.js', path: target, body: 'ORIGINAL-A' }]);
  await snap('20261121-200000-pre-apply', '2026-11-21T12:00:00.000Z', [{ name: 'hostfile.js', path: target, body: 'ORIGINAL-B' }]);

  const snaps = await listSnapshots(dataDir);
  ok(snaps.length === 3, '列出 3 份快照', String(snaps.length));
  ok(snaps[0].id === '20261121-200000-pre-apply', '最新快照按 at 排序（不是 skill-*）', snaps[0].id);
  ok(snaps[snaps.length - 1].id === 'skill-20261117-192550', '空快照排到最后', snaps[snaps.length - 1].id);

  const pick = pickRestoreSnapshot(snaps, {});
  ok(pick && pick.id === '20261121-200000-pre-apply', '默认选最近一份有文件的快照', pick && pick.id);

  const guarded = pickRestoreSnapshot(snaps, { excludeIds: ['20261121-200000-pre-apply'] });
  ok(guarded && guarded.id === '20261121-100000-pre-apply', '跳过刚建的 guard 快照', guarded && guarded.id);

  const onlyEmpty = pickRestoreSnapshot([snaps[snaps.length - 1]], {});
  ok(onlyEmpty === null, '只剩空快照时返回 null（上层据此报 409，而不是假装成功）');

  const explicit = pickRestoreSnapshot(snaps, { id: 'skill-20261117-192550' });
  ok(explicit && explicit.id === 'skill-20261117-192550', '显式指定 id 时照单全收');

  // 真的写回：默认选最新那份（ORIGINAL-B）
  const r = await restoreSnapshot(dataDir, null, {});
  ok(r.restored === 1, 'restoreSnapshot 回报恢复了 1 个文件', String(r.restored));
  const got = await readFile(target, 'utf8');
  ok(got === 'ORIGINAL-B', '目标文件被写回 ORIGINAL-B', got);

  // 显式指定空快照：写 0 个文件，不抛错（上层据此回 409）
  const empty = await restoreSnapshot(dataDir, 'skill-20261117-192550');
  ok(empty.restored === 0, '空快照恢复 0 个文件并被如实回报', String(empty.restored));

  // 找不到的 id 要报错
  let threw = false;
  try { await restoreSnapshot(dataDir, 'nope-1970'); } catch { threw = true; }
  ok(threw, '找不到的快照 id 抛错');
} finally {
  await rm(root, { recursive: true, force: true });
}

if (fails.length) {
  console.error(`FAIL host-restore · ${fails.length} 项未过 / ${pass} 项通过`);
  for (const f of fails) console.error(' - ' + f);
  process.exit(1);
}
console.log(`OK host-restore · ${pass} 项断言全过`);
