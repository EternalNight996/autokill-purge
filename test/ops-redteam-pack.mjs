// test/ops-redteam-pack.mjs —— redteam-pack 能力的验收测试
//
// 三条硬底线（改测试的人别越线）：
//   1) 绝不写本机真实 $DSH_HOME：install/uninstall 只落在 data/test-rt-pack/homes/* 的假 home 里；
//   2) 有宿主副作用的路径只用 dryRun 或只读 status —— 这台机器的 DSH 正在跑，杀/改它等于断线；
//   3) 不直接改上游源码（skills/redteam 与 presets/redteam 是只读参考），要模拟"源升级"就复制一份到 data/ 里改副本。
// 断言全部手写，不引 node:test：项目零依赖，且要一屏看清 PASS/FAIL 计数。
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as mod from '../web/ops/redteam-pack.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const TMP = join(ROOT, 'data', 'test-rt-pack');

let pass = 0;
const fails = [];

function ok(cond, name, extra) {
  if (cond) {
    pass += 1;
    console.log('  PASS ' + name);
    return true;
  }
  const tail = extra === undefined ? '' : ' :: ' + JSON.stringify(extra);
  fails.push(name + tail);
  console.log('  FAIL ' + name + tail);
  return false;
}

function eq(actual, expected, name) {
  return ok(Object.is(actual, expected), name, { actual, expected });
}

function sha(bufOrText) {
  return createHash('sha256').update(bufOrText).digest('hex');
}

function section(title) {
  console.log('\n== ' + title + ' ==');
}

function freshHome(name) {
  const home = join(TMP, 'homes', name);
  rmSync(home, { recursive: true, force: true });
  mkdirSync(home, { recursive: true });
  return home;
}

let ctxSeq = 0;
function mkCtx(dshHome, extra = {}) {
  ctxSeq += 1;
  const dataDir = join(TMP, 'data', String(ctxSeq) + '-' + (extra.tag || 'run'));
  mkdirSync(dataDir, { recursive: true });
  return {
    dataDir,
    dshHome,
    resourcesDir: join(TMP, 'no-resources'),
    appDir: join(TMP, 'no-resources', 'app'),
    asarPath: join(TMP, 'no-resources', 'app.asar'),
    asidePath: join(TMP, 'no-resources', 'app.asar.aside'),
    desktopExe: join(TMP, 'no-resources', 'nope.exe'),
    dshPurgeSrc: extra.src,
    now: () => new Date().toISOString(),
    log: () => {},
    snapshot: async () => {
      throw new Error('测试不允许触发宿主快照');
    },
  };
}

/** 目录树指纹：相对路径 + 大小 + mtime，用来证明 status / dryRun 真的没动盘。 */
function treeFingerprint(root) {
  const rows = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fp = join(dir, entry.name);
      const st = statSync(fp);
      if (entry.isDirectory()) {
        rows.push('D ' + fp + ' ' + st.mtimeMs);
        walk(fp);
      } else {
        rows.push('F ' + fp + ' ' + st.size + ' ' + st.mtimeMs);
      }
    }
  };
  if (existsSync(root)) walk(root);
  return rows.sort().join('\n');
}

function backupDirs(dataDir) {
  const dir = join(dataDir, 'redteam-pack-backups');
  return existsSync(dir) ? readdirSync(dir) : [];
}

function countFiles(dir) {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()).length;
}

function countDirs(dir) {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).length;
}

function readStateFile(dataDir) {
  const fp = join(dataDir, 'redteam-pack-state.json');
  return existsSync(fp) ? JSON.parse(readFileSync(fp, 'utf8')) : null;
}

console.log('== 0. 源定位与克隆源 ==');
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

const realCtx = mkCtx(join(homedir(), '.dsh'), { tag: 'real' });
const realSrc = mod.resolveSource(realCtx);
if (!realSrc) {
  console.log('  FAIL 找不到 dsh-purge 技能源（需要插件，或 DSH_PURGE_SRC / 开发仓参考副本）');
  process.exitCode = 1;
  throw new Error('source-missing');
}
ok(true, '解析到技能源：' + realSrc.root + '（' + realSrc.origin + ' v' + realSrc.version + '）');
const sourceSkills = mod.readSourceSkills(realSrc);
eq(sourceSkills.length, 48, '源技能数 = 48');
eq(mod.readSourceRoles(realSrc).length, 3, '源角色文件数 = 3');

// 可变克隆源：模拟"上游技能改过了"。绝不改真实的 skills/redteam。
const CLONE = join(TMP, 'src-clone');
mkdirSync(join(CLONE, 'skills', 'redteam'), { recursive: true });
mkdirSync(join(CLONE, 'presets', 'redteam'), { recursive: true });
for (const f of readdirSync(realSrc.skillsDir)) {
  if (f.endsWith('.md')) copyFileSync(join(realSrc.skillsDir, f), join(CLONE, 'skills', 'redteam', f));
}
for (const f of readdirSync(realSrc.rolesDir)) {
  copyFileSync(join(realSrc.rolesDir, f), join(CLONE, 'presets', 'redteam', f));
}
writeFileSync(join(CLONE, 'package.json'), JSON.stringify({ name: 'dsh-purge', version: '1.1.71-clone' }));
eq(mod.readSourceSkills(mod.resolveSource(mkCtx(join(TMP, 'ghost'), { tag: 'clone-check', src: CLONE }))).length, 48, '克隆源可用（48 篇）');

section('1. 48 篇 frontmatter 解析覆盖');
{
  const bad = sourceSkills.filter((s) => !s.ok);
  eq(bad.length, 0, '全 48 篇 frontmatter 解析成功', bad.map((b) => b.file + ': ' + b.error));
  eq(new Set(sourceSkills.map((s) => s.id)).size, 48, 'skill name 唯一（48 个不重复）');
  const illegal = sourceSkills.filter((s) => !mod.validSkillName(s.id));
  eq(illegal.length, 0, 'name 全部 kebab-case 合法', illegal.map((s) => s.id));
  const noDesc = sourceSkills.filter((s) => !s.description);
  eq(noDesc.length, 0, 'description 全部非空');
  const noWhen = sourceSkills.filter((s) => !s.whenToUse);
  eq(noWhen.length, 0, 'whenToUse 全部非空', noWhen.map((s) => s.id));
  eq(sourceSkills.filter((s) => s.description.length > 500).length, 0, 'description 全部 ≤500 字');
  const mismatch = sourceSkills.filter((s) => s.id !== s.file.replace(/\.md$/, ''));
  eq(mismatch.length, 0, 'name 与文件名一致', mismatch.map((s) => s.file + ' -> ' + s.id));
}

section('2. 重渲染保真（规范化后仍可被官方 loader 解析）');
{
  let roundtripBad = 0;
  let bodyLost = 0;
  let leakedKeys = 0;
  let missingHeading = 0;
  for (const s of sourceSkills) {
    const parsed = mod.parseSkillDocument(s.rendered);
    if (!parsed.ok || parsed.name !== s.id || parsed.description !== s.description) roundtripBad += 1;
    if (!s.rendered.startsWith('---\nname: ' + s.id + '\n')) roundtripBad += 1;
    const head = mod.splitFrontmatter(s.rendered);
    if (!head) roundtripBad += 1;
    else {
      if (/^role:/m.test(head.head) || /^enabled:/m.test(head.head)) leakedKeys += 1;
      if (!/^whenToUse:/m.test(head.head)) roundtripBad += 1;
    }
    const origParts = mod.splitFrontmatter(readFileSync(join(realSrc.skillsDir, s.file), 'utf8'));
    if (!origParts) bodyLost += 1;
    else {
      const renderedBody = mod.splitFrontmatter(s.rendered).body.trim();
      if (renderedBody !== origParts.body.trim()) bodyLost += 1;
      if (!renderedBody.includes('## ')) missingHeading += 1;
    }
  }
  eq(roundtripBad, 0, '48 篇重渲染后 name/description/whenToUse 与源一致');
  eq(bodyLost, 0, '48 篇正文保真（只规范化首尾空行）');
  eq(leakedKeys, 0, 'role / enabled 未泄漏进官方 frontmatter');
  eq(missingHeading, 0, '48 篇正文都含二级标题（不是空壳）');
}

section('3. status() 只读');
{
  const home = freshHome('readonly');
  // 预置一份"用户自己的"技能，证明 status 不会顺手改写别人的东西。
  mkdirSync(join(home, 'skills', 'mem-purge-recall'), { recursive: true });
  writeFileSync(join(home, 'skills', 'mem-purge-recall', 'SKILL.md'), '---\nname: mem-purge-recall\ndescription: 别人的技能\n---\n\n正文\n');
  const ctx = mkCtx(home, { tag: 'readonly', src: CLONE });
  const before = treeFingerprint(home);
  const st = await mod.status(ctx);
  const after = treeFingerprint(home);
  ok(st.ok && st.available, 'status 可用', st.summary);
  eq(after, before, 'status 前后 dshHome 目录树指纹一致（未写盘）');
  eq(backupDirs(ctx.dataDir).length, 0, 'status 不产生备份目录');
  eq(readStateFile(ctx.dataDir), null, 'status 不产生台账文件');
  eq(st.detail.skills.ok, 0, '新 home 里 0 篇技能已装');
  eq(st.detail.skills.missing, 48, '48 篇全部报缺失');
  ok(st.summary.includes('0/48'), 'summary 反映技能进度', st.summary);
  const st2 = await mod.status(ctx);
  eq(st2.detail.skills.missing, st.detail.skills.missing, 'status 幂等（两次结果一致）');
}

section('4. dryRun 不落盘');
{
  const home = freshHome('dryrun');
  const ctx = mkCtx(home, { tag: 'dryrun', src: CLONE });
  const before = treeFingerprint(home);
  const r = await mod.run(ctx, { action: 'install', dryRun: true });
  eq(r.ok, true, 'dryRun 返回 ok');
  eq(r.changed, false, 'dryRun changed=false');
  eq(r.detail.planned.filter((o) => o.type === 'write').length, 51, 'dryRun 计划写 51 项（48 技能 + 3 角色）');
  eq(existsSync(join(home, 'skills')), false, 'dryRun 未创建 skills 目录');
  eq(treeFingerprint(home), before, 'dryRun 前后目录树指纹一致');
  eq(backupDirs(ctx.dataDir).length, 0, 'dryRun 未创建备份目录');
  eq(readStateFile(ctx.dataDir), null, 'dryRun 未写台账');
  ok(r.summary.includes('未落盘'), 'dryRun summary 明说未落盘', r.summary);
}

section('5. install 落地 + 内容 sha 校验');
let home;
let ctx;
{
  home = freshHome('install');
  mkdirSync(join(home, '.agent-presets'), { recursive: true }); // 假装本机有 preset 机制
  ctx = mkCtx(home, { tag: 'install', src: CLONE });

  const r = await mod.run(ctx, { action: 'install' });
  eq(r.ok, true, 'install ok', r.summary);
  eq(r.changed, true, 'install changed=true');
  eq(r.detail.written, 51, 'install 写 51 项（48 技能 + 3 角色）');
  eq(r.detail.removed, 0, 'install 不删任何东西');
  eq(r.detail.failures.length, 0, 'install 无失败项', r.detail.failures.slice(0, 2));
  eq(countDirs(join(home, 'skills')), 48, 'skills/ 下 48 个 bundle 目录');

  const state = readStateFile(ctx.dataDir);
  ok(state !== null, '生成了安装台账 redteam-pack-state.json');
  eq(Object.keys(state.skills).length, 48, '台账记 48 个技能 sha');
  eq(Object.keys(state.roles).length, 3, '台账记 3 个角色 sha');

  const st = await mod.status(ctx);
  eq(st.detail.skills.ok, 48, 'status：48 篇 ok');
  eq(st.detail.skills.stale, 0, 'status：0 篇过期');
  eq(st.detail.skills.modified, 0, 'status：0 篇本地改动');
  eq(st.detail.roles.ok, 3, 'status：3 个角色文件一致');

  let shaBad = 0;
  let nameBad = 0;
  let fmBad = 0;
  for (const item of st.detail.skills.items) {
    const fp = join(home, 'skills', item.id, 'SKILL.md');
    if (!existsSync(fp)) continue;
    const text = readFileSync(fp, 'utf8');
    if (sha(text) !== item.expectedSha) shaBad += 1;
    const parsed = mod.parseSkillDocument(text);
    if (!parsed.ok || parsed.name !== item.id) nameBad += 1;
    if (!/^---\nname: /.test(text) || !/\nwhenToUse: /.test(text)) fmBad += 1;
  }
  eq(shaBad, 0, '48 篇落盘内容 sha 与期望一致');
  eq(nameBad, 0, '48 篇落盘后 name 与目录名一致');
  eq(fmBad, 0, '48 篇落盘文件都是规范 frontmatter');
  eq(readdirSync(join(home, 'skills')).filter((n) => n.includes('.tmp-')).length, 0, '无遗留 .tmp- 临时文件');
  eq(countFiles(join(home, '.agent-presets', 'redteam')), 3, '角色目录 3 个文件');
  ok(readFileSync(join(home, '.agent-presets', 'redteam', 'preset.yml'), 'utf8').includes('红队模式'), 'preset.yml 中文未损坏');
  eq(sha(readFileSync(join(home, '.agent-presets', 'redteam', 'anchor-gate.mjs'))), sha(readFileSync(join(realSrc.rolesDir, 'anchor-gate.mjs'))), 'anchor-gate.mjs 逐字节一致');
}

section('6. install 幂等');
{
  const dirsBefore = backupDirs(ctx.dataDir).length;
  const fpBefore = treeFingerprint(home);
  const r = await mod.run(ctx, { action: 'install' });
  eq(r.ok, true, '重复 install ok');
  eq(r.changed, false, '重复 install changed=false');
  eq(r.detail.written, 0, '重复 install 不写任何文件');
  eq(treeFingerprint(home), fpBefore, '重复 install 目录树未变');
  eq(backupDirs(ctx.dataDir).length, dirsBefore, '重复 install 不产生新备份目录');
  const st = await mod.status(ctx);
  eq(st.detail.skills.ok, 48, '重复 install 后仍 48 篇 ok');
}

section('7. 源升级 → 过期检测与修复（含备份）');
{
  const cloneSkill = join(CLONE, 'skills', 'redteam', 'active-scan.md');
  writeFileSync(cloneSkill, readFileSync(cloneSkill, 'utf8') + '\n## 新增章节（模拟上游技能更新）\n');
  const st1 = await mod.status(ctx);
  eq(st1.detail.skills.stale, 1, '源改动一篇 → stale=1');
  eq(st1.detail.skills.ok, 47, '源改动一篇 → ok=47');
  ok(st1.summary.includes('过期'), 'summary 点出过期', st1.summary);

  const dirsBefore = backupDirs(ctx.dataDir).length;
  const r = await mod.run(ctx, { action: 'install' });
  eq(r.changed, true, '过期修复 changed=true');
  eq(r.detail.written, 1, '只重写 1 篇');
  eq(backupDirs(ctx.dataDir).length, dirsBefore + 1, '修复前建了 1 个备份目录');
  const backupName = backupDirs(ctx.dataDir).slice(-1)[0];
  const backupFile = join(ctx.dataDir, 'redteam-pack-backups', backupName, 'skills', 'active-scan', 'SKILL.md');
  ok(existsSync(backupFile), '备份里能找到被覆盖的旧版', backupFile);
  ok(!readFileSync(backupFile, 'utf8').includes('模拟上游技能更新'), '备份保存的是被覆盖前的旧内容');
  ok(readFileSync(join(home, 'skills', 'active-scan', 'SKILL.md'), 'utf8').includes('模拟上游技能更新'), '盘上已是新版内容');
  const st2 = await mod.status(ctx);
  eq(st2.detail.skills.stale, 0, '修复后 stale=0');
  eq(st2.detail.skills.ok, 48, '修复后 48 篇 ok');
}

section('8. 用户手改过的技能：默认不覆盖，force 才覆盖');
{
  const fp = join(home, 'skills', 'ad-attack', 'SKILL.md');
  writeFileSync(fp, readFileSync(fp, 'utf8') + '\n<!-- 用户自己的改动 -->\n');
  const st = await mod.status(ctx);
  eq(st.detail.skills.modified, 1, 'status 把用户改动识别为 modified（不是 stale）');
  const r = await mod.run(ctx, { action: 'install' });
  eq(r.changed, false, '普通 install 不动用户改动');
  ok(r.detail.skipped.some((s) => s.id === 'ad-attack' && s.reason === 'modified-by-user'), 'skipped 里点名 modified-by-user');
  ok(readFileSync(fp, 'utf8').includes('用户自己的改动'), '用户改动仍在盘上');
  const r2 = await mod.run(ctx, { action: 'install', force: true });
  eq(r2.detail.written, 1, 'force install 只重写那 1 篇');
  ok(!readFileSync(fp, 'utf8').includes('用户自己的改动'), 'force 后回到官方内容');
  eq((await mod.status(ctx)).detail.skills.ok, 48, 'force 后 48 篇 ok');
}

section('9. uninstall：只删我们写的，force 才删改动过的');
{
  const fp = join(home, 'skills', 'anti-debug-bypass', 'SKILL.md');
  writeFileSync(fp, readFileSync(fp, 'utf8') + '\n<!-- 卸载保护测试 -->\n');
  const r = await mod.run(ctx, { action: 'uninstall' });
  eq(r.ok, true, 'uninstall ok');
  eq(r.detail.skipped.filter((s) => s.reason === 'modified-by-user').length, 1, '改动过的那篇被跳过');
  ok(existsSync(fp), '被跳过的那篇仍在盘上');
  eq(countDirs(join(home, 'skills')), 1, '其余 47 篇已卸干净');
  eq(countFiles(join(home, '.agent-presets', 'redteam')), 0, '角色文件已卸干净');
  const state = readStateFile(ctx.dataDir);
  eq(Object.keys(state.skills).length, 1, '台账只剩被跳过的那条');

  const r2 = await mod.run(ctx, { action: 'uninstall', force: true });
  eq(r2.changed, true, 'force uninstall 有动作');
  eq(countDirs(join(home, 'skills')), 0, 'force 后 skills/ 全空');
  const r3 = await mod.run(ctx, { action: 'uninstall' });
  eq(r3.changed, false, '重复 uninstall changed=false（幂等）');
}

section('10. reinstall 恢复全套');
{
  const r = await mod.run(ctx, { action: 'reinstall' });
  eq(r.ok, true, 'reinstall ok');
  eq(r.detail.written, 51, 'reinstall 重写 51 项');
  const st = await mod.status(ctx);
  eq(st.detail.skills.ok, 48, 'reinstall 后 48 篇 ok');
  eq(st.detail.skills.missing, 0, 'reinstall 后 0 缺失');
  eq(st.detail.roles.ok, 3, 'reinstall 后角色 3/3');
}

section('11. 角色：本地已改默认不覆盖，force 才覆盖');
{
  const h = freshHome('roles-custom');
  mkdirSync(join(h, '.agent-presets', 'redteam'), { recursive: true });
  writeFileSync(join(h, '.agent-presets', 'redteam', 'agent.cordis.yml'), '# 用户手工改过的角色稿\n');
  const c = mkCtx(h, { tag: 'roles-custom', src: CLONE });
  const st1 = await mod.status(c);
  eq(st1.detail.roles.customized, 1, 'status：1 个角色文件报 customized');
  eq(st1.detail.roles.missing, 2, 'status：其余 2 个报缺失');

  const r1 = await mod.run(c, { action: 'install' });
  eq(r1.detail.written, 50, 'install 只写 48 技能 + 2 个角色（跳过定制的）');
  ok(r1.detail.skipped.some((s) => s.kind === 'role' && s.reason === 'customized'), '清单里点名跳过 customized');
  eq(readFileSync(join(h, '.agent-presets', 'redteam', 'agent.cordis.yml'), 'utf8'), '# 用户手工改过的角色稿\n', '定制文件原样保留');

  const r2 = await mod.run(c, { action: 'install', force: true });
  eq(r2.detail.written, 1, 'force install 只补那 1 个定制文件');
  ok(readFileSync(join(h, '.agent-presets', 'redteam', 'agent.cordis.yml'), 'utf8').includes('id:'), 'force 后才写回官方角色稿');
  ok(backupDirs(c.dataDir).length >= 1, 'force 覆盖前留了备份');
}

section('12. 角色目标目录未接入时退回 data/ 并明说');
{
  const h = freshHome('roles-fallback');
  const c = mkCtx(h, { tag: 'roles-fallback', src: CLONE });
  const st = await mod.status(c);
  eq(st.detail.roles.wired, false, 'status 标出 wired=false');
  eq(st.detail.roles.mech, 'data-fallback', '机制降级为 data-fallback');
  ok(st.detail.roles.note.includes('未接入'), 'note 明说 DSH 侧未接入', st.detail.roles.note);
  ok(st.summary.includes('未接入'), 'summary 也带未接入', st.summary);

  const r = await mod.run(c, { action: 'install' });
  ok(r.summary.includes('DSH 侧未接入'), 'run summary 明说未接入', r.summary);
  eq(countFiles(join(c.dataDir, 'redteam-roles', 'redteam')), 3, '3 个角色文件落在 data/redteam-roles/redteam');
  eq(existsSync(join(h, '.agent-presets')), false, '没有凭空造 .agent-presets 目录');
  eq(countDirs(join(h, 'skills')), 48, '技能仍正常落在 home/skills');
}

section('13. 工具面托管：在位 / 缺失 / 冲突');
{
  // 13a 缺失
  const bare = freshHome('tools-missing');
  const bareCtx = mkCtx(bare, { tag: 'tools-missing', src: CLONE });
  const stBare = await mod.status(bareCtx);
  eq(stBare.detail.toolHosting.available, false, '无插件 → 工具面 available=false');
  ok(stBare.detail.toolHosting.summary.includes('缺失'), 'summary 说明缺失', stBare.detail.toolHosting.summary);
  const paths = stBare.detail.toolHosting.paths || [];
  eq(paths.length, 2, '给出两条替代路径');
  eq(paths[0].id, 'install-plugin', '路径 A = 装插件');
  eq(paths[1].id, 'cli-payload', '路径 B = CLI 载荷');
  ok(paths[0].steps.length > 0 && paths[1].steps.length > 0, '两条路径都有可执行步骤');

  // 13b 在位 + autoApplyOnStart=true
  const h = freshHome('tools-present');
  const plugin = join(h, 'profiles', 'desktop', 'node_modules', 'dsh-purge');
  mkdirSync(join(plugin, 'lib', 'redteam'), { recursive: true });
  mkdirSync(join(plugin, 'skills', 'redteam'), { recursive: true });
  writeFileSync(join(plugin, 'package.json'), JSON.stringify({ name: 'dsh-purge', version: '9.9.9' }));
  writeFileSync(join(plugin, 'lib', 'redteam', 'tools.js'), "export function apply(ctx) {\n  ctx.tools.register({ name: 'redteam_a' })\n  ctx.tools.register({ name: 'redteam_b' })\n  ctx.tools.register({ name: \"redteam_c\" })\n}\n");
  writeFileSync(join(plugin, 'skills', 'redteam', 'a.md'), '---\nname: a\ndescription: a\n---\n');
  writeFileSync(join(plugin, 'skills', 'redteam', 'b.md'), '---\nname: b\ndescription: b\n---\n');
  writeFileSync(join(plugin, 'cordis.patch.yml'), "- id: dsh-purge\n  name: 'dsh-purge'\n  config:\n    enabled: true\n    autoApplyOnStart: true\n");
  writeFileSync(join(h, 'profiles', 'desktop', 'package.json'), JSON.stringify({ name: 'p', dsh: { profile: { bundles: ['dsh-base', 'dsh-purge'] } } }));
  const c = mkCtx(h, { tag: 'tools-present', src: CLONE });
  const st = await mod.status(c);
  eq(st.detail.toolHosting.available, true, '插件在位 → available=true');
  eq(st.detail.toolHosting.toolCount, 3, '从 tools.js 数出 3 个 redteam_* 工具');
  eq(st.detail.toolHosting.version, '9.9.9', '报告插件版本 9.9.9');
  eq(st.detail.toolHosting.enabled, true, 'profile bundles 含 dsh-purge → enabled=true');
  eq(st.detail.toolHosting.pluginSkillCount, 2, '插件内 redteam 技能数 2');
  eq(st.detail.warning && st.detail.warning.code, 'auto-apply-conflict', 'autoApplyOnStart=true → 冲突警告');
  eq(st.detail.warning && st.detail.warning.level, 'warn', '冲突警告 level=warn');
  ok(st.summary.includes('冲突'), 'summary 点出冲突', st.summary);
  eq(st.warning && st.warning.code, 'auto-apply-conflict', '顶层也带 warning 字段（路由可直接读）');

  // 13c profile 层覆盖 false → 降级
  writeFileSync(join(h, 'profiles', 'desktop', 'cordis.patch.yml'), "- id: dsh-purge\n  config:\n    autoApplyOnStart: false\n");
  const st2 = await mod.status(c);
  eq(st2.detail.warning.code, 'no-auto-apply', 'profile 覆盖 false → 不再警告');
  // 13d bundle false + profile yes → 仍警告，且标明来源
  writeFileSync(join(plugin, 'cordis.patch.yml'), "- id: dsh-purge\n  config:\n    autoApplyOnStart: false\n");
  writeFileSync(join(h, 'profiles', 'desktop', 'cordis.patch.yml'), "- id: dsh-purge\n  config:\n    autoApplyOnStart: yes\n");
  const st3 = await mod.status(c);
  eq(st3.detail.warning.code, 'auto-apply-conflict', 'profile 覆盖 yes → 仍然警告');
  eq(st3.detail.warning.detail[0].from, 'profile/patch', '警告标明来源是 profile patch');
}

section('14. 源缺失 / 非法 action / 写盘失败都不抛裸异常');
{
  const h = freshHome('no-source');
  const c = mkCtx(h, { tag: 'no-source', src: join(TMP, 'definitely-not-here') });
  const st = await mod.status(c);
  eq(st.available, false, '源缺失 → available=false');
  eq(st.ok, true, '源缺失不算 status 失败（只读路径不炸）');
  ok(st.summary.includes('找不到'), 'summary 说明找不到源', st.summary);
  const r = await mod.run(c, { action: 'install' });
  eq(r.ok, false, '源缺失 → run ok=false');
  eq(r.error, 'source-missing', 'run 返回 source-missing');

  const h2 = freshHome('bad-action');
  const c2 = mkCtx(h2, { tag: 'bad-action', src: CLONE });
  const r2 = await mod.run(c2, { action: 'rm-rf' });
  eq(r2.ok, false, '非法 action → ok=false');
  eq(r2.error, 'unsupported-action', '非法 action 的错误码');

  const asFile = join(TMP, 'home-is-a-file');
  rmSync(asFile, { recursive: true, force: true });
  writeFileSync(asFile, 'not a directory');
  const c3 = mkCtx(asFile, { tag: 'write-fail', src: CLONE });
  const r3 = await mod.run(c3, { action: 'install' });
  eq(r3.ok, false, '写盘失败 → ok=false（不抛裸异常）');
  eq(typeof r3.error, 'string', '写盘失败带 error 字符串');
  ok(r3.detail.failures.length > 0, '失败项逐条列出', r3.detail.failures.slice(0, 1));
}

section('15. plan() 与 run() 口径一致');
{
  const h = freshHome('plan');
  const c = mkCtx(h, { tag: 'plan', src: CLONE });
  const p1 = await mod.plan(c, { action: 'install' });
  eq(p1.ok, true, 'plan ok');
  eq(p1.counts.write, 51, 'plan 计划写 51 项');
  eq(p1.counts.remove, 0, 'plan 计划删 0 项');
  const r = await mod.run(c, { action: 'install' });
  eq(r.detail.written, p1.counts.write, 'plan 与 run 的写入数一致');
  const p2 = await mod.plan(c, { action: 'install' });
  eq(p2.counts.write, 0, '装完之后 plan 计划写 0 项');
  const p3 = await mod.plan(c, { action: 'uninstall' });
  eq(p3.counts.remove, 51, 'plan uninstall 计划删 51 项');
}

section('16. 本机真实 status（只读，作为交付样本）');
{
  const before = backupDirs(realCtx.dataDir).length;
  const st = await mod.status(realCtx);
  const after = backupDirs(realCtx.dataDir).length;
  eq(after, before, '真实 status 未产生备份目录');
  ok(st.ok, '真实 status ok');
  ok(st.summary.length > 0, '真实 status 有摘要');
  console.log('  ---- status() 真实输出 ----');
  console.log('  ok=' + st.ok + ' available=' + st.available);
  console.log('  summary: ' + st.summary);
  const d = st.detail;
  console.log('  source: ' + d.source.root + ' (' + d.source.origin + ' v' + d.source.version + ')');
  console.log('  skills: ' + JSON.stringify({ source: d.skills.source, ok: d.skills.ok, stale: d.skills.stale, modified: d.skills.modified, missing: d.skills.missing, target: d.skills.targetDir }));
  console.log('  roles: ' + JSON.stringify({ source: d.roles.source, ok: d.roles.ok, stale: d.roles.stale, customized: d.roles.customized, missing: d.roles.missing, mech: d.roles.mech, wired: d.roles.wired, target: d.roles.targetDir }));
  console.log('  toolHosting: ' + JSON.stringify({ available: d.toolHosting.available, toolCount: d.toolHosting.toolCount, version: d.toolHosting.version, profile: d.toolHosting.profile, enabled: d.toolHosting.enabled, note: d.toolHosting.toolCountNote }));
  console.log('  upstreamFlat: ' + JSON.stringify(d.upstreamFlat));
  console.log('  warning: ' + JSON.stringify({ level: d.warning && d.warning.level, code: d.warning && d.warning.code, text: d.warning && d.warning.text }));
  console.log('  ---- end ----');
}

console.log('\n================ 结果 ================');
console.log('PASS ' + pass + ' · FAIL ' + fails.length);
if (fails.length) {
  console.log('失败项：');
  for (const f of fails) console.log('  - ' + f);
  process.exitCode = 1;
} else {
  console.log('全绿。测试产物在 ' + TMP + '（可删）');
}
