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
    run('npm', ['publish', '--access', 'public', '--no-git-checks']);
    console.log(`✓ npm 已发布：https://www.npmjs.com/package/${pkg.name}`);
    return true;
  } finally {
    if (!DRY && !hadRc) { try { rmSync(npmrc, { force: true }); } catch { /* 忽略 */ } }
  }
}

function main() {
  console.log('发布目标：' + (ONLY.length ? ONLY.join(' + ') : 'github + gitee + npm') + (DRY ? '（dry-run）' : ''));
  if (!DRY) ensureCleanTree();
  const done = [];
  if (want('github')) { try { if (pushTo('github')) done.push('github'); } catch (e) { console.error('✗ github 失败：' + (e.stdout || e.message)); } }
  if (want('gitee')) { try { if (pushTo('gitee')) done.push('gitee'); } catch (e) { console.error('✗ gitee 失败：' + (e.stdout || e.message)); } }
  if (want('npm')) { try { if (publishNpm()) done.push('npm'); } catch (e) { console.error('✗ npm 失败：' + (e.stdout || e.message)); } }
  console.log('\n完成：' + (done.length ? done.join(' · ') : '无（缺凭据或失败）'));
}

main();
