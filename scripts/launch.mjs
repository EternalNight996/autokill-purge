// 启动器：桌面图标与开机自启都指向这里。
//
// 做三件事（都可重复执行，已经在跑就跳过）：
//   1) 记忆库（隔离库 mem-purge）7989
//   2) 控制台 8792
//   3) 打开浏览器到控制台
//
// 用法：node scripts/launch.mjs [--no-open] [--quiet]
import { spawn } from 'node:child_process';
import { existsSync, openSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const HOME = process.env.USERPROFILE || process.env.HOME || '';
const MEM_PORT = Number(process.env.MEM_PURGE_PORT || 7989);
const WEB_PORT = Number(process.env.PURGE_WEB_PORT || 8792);
const MEM_ROOT = join(HOME, '.dsh', 'profiles', 'desktop', 'node_modules', 'memory-eternal');
const MEM_VAULT = join(HOME, '.dsh', 'memory-vault-mem-purge');
const LOG_DIR = join(HOME, '.dsh', 'autokill-purge-logs');

const QUIET = process.argv.includes('--quiet');
const NO_OPEN = process.argv.includes('--no-open');

function say(...args) {
  if (!QUIET) console.log(...args);
}

function portOpen(port, timeoutMs = 800) {
  return new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port });
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      try { sock.destroy(); } catch { /* ignore */ }
      resolve(v);
    };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => finish(true));
    sock.once('timeout', () => finish(false));
    sock.once('error', () => finish(false));
  });
}

function detached(file, args, opts = {}) {
  mkdirSync(LOG_DIR, { recursive: true });
  const out = openSync(join(LOG_DIR, (opts.tag || 'proc') + '.log'), 'a');
  const child = spawn(file, args, {
    detached: true,
    stdio: ['ignore', out, out],
    windowsHide: true,
    cwd: opts.cwd || ROOT,
    env: process.env,
  });
  child.unref();
  return child.pid;
}

async function waitPort(port, ms = 20000) {
  const started = Date.now();
  while (Date.now() - started < ms) {
    if (await portOpen(port)) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

async function main() {
  // 1) 记忆库
  if (await portOpen(MEM_PORT)) {
    say(`记忆库 ${MEM_PORT} 已在运行`);
  } else {
    if (!existsSync(join(MEM_ROOT, 'lib', 'web.js'))) {
      console.error(`找不到 memory-eternal：${MEM_ROOT}`);
      process.exit(2);
    }
    mkdirSync(MEM_VAULT, { recursive: true });
    const pid = detached(process.execPath, [join(MEM_ROOT, 'lib', 'web.js'), '--port', String(MEM_PORT), '--vault', MEM_VAULT], { tag: 'memory' });
    say(`记忆库 ${MEM_PORT} 启动中（pid ${pid}）`);
    const ok = await waitPort(MEM_PORT);
    say(ok ? `记忆库 ${MEM_PORT} 就绪` : `记忆库 ${MEM_PORT} 没起来，看 ${join(LOG_DIR, 'memory.log')}`);
  }

  // 2) 控制台
  if (await portOpen(WEB_PORT)) {
    say(`控制台 ${WEB_PORT} 已在运行`);
  } else {
    const pid = detached(process.execPath, [join(ROOT, 'web', 'server.mjs')], { tag: 'web', cwd: ROOT });
    say(`控制台 ${WEB_PORT} 启动中（pid ${pid}）`);
    const ok = await waitPort(WEB_PORT);
    say(ok ? `控制台 ${WEB_PORT} 就绪` : `控制台 ${WEB_PORT} 没起来，看 ${join(LOG_DIR, 'web.log')}`);
  }

  // 3) 打开浏览器
  const url = `http://127.0.0.1:${WEB_PORT}`;
  if (!NO_OPEN) {
    try {
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
      say(`已在浏览器打开 ${url}`);
    } catch {
      say(`打不开浏览器，手动访问 ${url}`);
    }
  }
}

main().catch((e) => {
  console.error('启动失败：' + (e && e.message ? e.message : e));
  process.exit(1);
});
