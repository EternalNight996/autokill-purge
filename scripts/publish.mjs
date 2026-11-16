// 一键发布：GitHub → Gitee → npm，凭据全部从环境变量读，不落盘。
//
//   $env:GITHUB_TOKEN = "ghp_xxx"
//   $env:GITHUB_REPO  = "yourname/autokill-purge"     # 不存在会自动创建
//   $env:GITEE_TOKEN  = "xxx"
//   $env:GITEE_REPO   = "yourname/autokill-purge"
//   $env:NPM_TOKEN    = "npm_xxx"
//   $env:NPM_NAME     = "autokill-purge"               # 或 @scope/autokill-purge
//
//   node scripts/publish.mjs --dry-run      # 只打印将要执行的步骤
//   node scripts/publish.mjs --github       # 只发 GitHub
//   node scripts/publish.mjs                # 全发（缺哪个凭据就跳过哪个）
import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]+$/, '');
const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run');
const ONLY = ['--github', '--gitee', '--npm'].filter((f) => argv.includes(f)).map((f) => f.slice(2));
const want = (n) => (ONLY.length ? ONLY.includes(n) : true);

const env = process.env;
const cfg = {
  github: { token: env.GITHUB_TOKEN || '', repo: env.GITHUB_REPO || '', branch: env.GIT_BRANCH || 'main' },
  gitee: { token: env.GITEE_TOKEN || '', repo: env.GITEE_REPO || '', branch: env.GIT_BRANCH || 'main' },
  npm: { token: env.NPM_TOKEN || '', name: env.NPM_NAME || '' },
};

function run(cmd, args, opts = {}) {
  const line = cmd + ' ' + args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ');
  if (DRY) { console.log('  [dry-run] ' + line.replace(/(x-access-token:|_authToken=)[^@\s]+/g, '$1***')); return ''; }
  console.log('  $ ' + line.replace(/(x-access-token:|_authToken=)[^@\s]+/g, '$1***'));
  return execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, env, opts.env || {}) }).trim();
}

const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

/** 仓库不存在就建（GitHub 用 API；Gitee 也支持） */
async function ensureRepo(kind) {
  const c = cfg[kind];
  if (!c.token || !c.repo) return false;
  const [owner, name] = c.repo.split('/');
  if (!owner || !name) return false;
  if (kind === 'github') {
    const h = { authorization: 'token ' + c.token, 'user-agent': 'autokill-purge', accept: 'application/vnd.github+json' };
    const probe = await fetch(`https://api.github.com/repos/${c.repo}`, { headers: h });
    if (probe.status === 200) { console.log(`  仓库已存在：${c.repo}`); return true; }
    if (probe.status !== 404) { console.log(`  ⚠ 探测仓库失败 HTTP ${probe.status}`); return false; }
    const body = { name, description: 'Local console for dsh-purge: one-click injection, equipment, isolated memory vault, MCP.', private: false, has_issues: true, has_wiki: false };
    const create = await fetch('https://api.github.com/user/repos', { method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, h), body: JSON.stringify(body) });
    const d = await create.json().catch(() => ({}));
    if (create.status === 201) { console.log(`  已创建仓库：${d.full_name}`); return true; }
    console.log(`  ✗ 创建仓库失败 HTTP ${create.status} ${d.message || ''}`);
    return false;
  }
  // gitee
  const probe = await fetch(`https://gitee.com/api/v5/repos/${c.repo}?access_token=${encodeURIComponent(c.token)}`);
  if (probe.status === 200) { console.log(`  仓库已存在：${c.repo}`); return true; }
  const create = await fetch('https://gitee.com/api/v5/user/repos', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ access_token: c.token, name, private: false, description: 'autokill-purge console' }),
  });
  const d = await create.json().catch(() => ({}));
  if (create.status === 201) { console.log(`  已创建仓库：${d.full_name}`); return true; }
  console.log(`  ✗ 创建仓库失败 HTTP ${create.status} ${d.message || ''}`);
  return false;
}

function git(args, opts) {
  return run('git', args, opts);
}

function hasRemote(name) {
  try {
    const out = git(['remote']);
    return out.split(/\r?\n/).map((s) => s.trim()).includes(name);
  } catch {
    return false;
  }
}

function ensureCleanTree() {
  const st = git(['status', '--porcelain']);
  if (st) {
    console.log('⚠ 工作区有未提交改动，先提交再发：');
    console.log(st);
    process.exit(2);
  }
}

/** GitHub / Gitee 走同一套：remote add（用 token 拼 URL）→ push -u */
function pushTo(kind) {
  const c = cfg[kind];
  if (!c.token || !c.repo) { console.log(`⏭  ${kind}：缺 token 或 repo，跳过`); return false; }
  const host = kind === 'github' ? 'github.com' : 'gitee.com';
  const user = kind === 'github' ? 'x-access-token' : c.repo.split('/')[0];
  const url = `https://${user}:${c.token}@${host}/${c.repo}.git`;
  const remote = kind === 'github' ? 'github' : 'gitee';
  console.log(`\n== ${kind}：${c.repo} ==`);
  if (hasRemote(remote)) git(['remote', 'set-url', remote, url]);
  else git(['remote', 'add', remote, url]);
  git(['push', '-u', remote, 'HEAD:' + c.branch, '--force']);
  // 清掉带 token 的 remote，避免留在 .git/config 里
  if (!DRY) git(['remote', 'set-url', remote, `https://${host}/${c.repo}.git`]);
  console.log(`✓ ${kind} 已推送：https://${host}/${c.repo}`);
  return true;
}

function publishNpm() {
  if (!cfg.npm.token) { console.log('\n⏭  npm：缺 NPM_TOKEN，跳过'); return false; }
  const pkgPath = join(ROOT, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  if (cfg.npm.name) pkg.name = cfg.npm.name;
  if (cfg.github.repo) pkg.repository = { type: 'git', url: 'git+' + ('https://github.com/' + cfg.github.repo + '.git') };
  if (!DRY) writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  console.log(`\n== npm：${pkg.name}@${pkg.version} ==`);
  const npmrc = join(ROOT, '.npmrc');
  const hadRc = existsSync(npmrc);
  if (!DRY) writeFileSync(npmrc, `//registry.npmjs.org/:_authToken=${cfg.npm.token}\n`, 'utf8');
  try {
    run(NPM, ['publish', '--access', 'public', '--no-git-checks']);
    console.log(`✓ npm 已发布：https://www.npmjs.com/package/${pkg.name}`);
    return true;
  } finally {
    if (!DRY && !hadRc) { try { rmSync(npmrc, { force: true }); } catch { /* 忽略 */ } }
  }
}

async function main() {
  console.log('发布目标：' + (ONLY.length ? ONLY.join(' + ') : 'github + gitee + npm') + (DRY ? '（dry-run）' : ''));
  if (!DRY) ensureCleanTree();
  const done = [];
  if (want('github')) {
    try { const okRepo = await ensureRepo('github'); if (okRepo || DRY) { if (pushTo('github')) done.push('github'); } else console.error('✗ github：仓库建不出来，跳过'); }
    catch (e) { console.error('✗ github 失败：' + (e.stdout || e.message)); }
  }
  if (want('gitee')) {
    try { const okRepo = await ensureRepo('gitee'); if (okRepo || DRY) { if (pushTo('gitee')) done.push('gitee'); } else console.error('✗ gitee：仓库建不出来，跳过'); }
    catch (e) { console.error('✗ gitee 失败：' + (e.stdout || e.message)); }
  }
  if (want('npm')) {
    try { if (publishNpm()) done.push('npm'); }
    catch (e) { console.error('✗ npm 失败：' + (e.stdout || e.message)); }
  }
  console.log('\n完成：' + (done.length ? done.join(' · ') : '无（缺凭据或失败）'));
}

main().catch((e) => { console.error("发布异常：" + (e && e.message)); process.exit(1); });
