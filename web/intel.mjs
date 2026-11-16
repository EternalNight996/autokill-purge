// 情报巡检：驱动 dsh-purge 1.1.71 的 scripts/intel-sweep.mjs（7 个源：Exploit-DB / 吾爱破解 /
// 看雪 / oss-sec / 先知 / FreeBuf / GitHub Advisory），并把产物读回来展示。
//
// 不重写抓取逻辑：抓取的 UA 池、编码判定（GBK/UTF-8）、Cookie 罐都在它那边，复制一遍只会漂。
// 产物：<DSH_HOME>/redteam/intel-sweep-YYYYMMDD.md
import { spawn } from 'node:child_process';
import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const REPORT_NAME = /^(intel-sweep|vuln-intel)-\d{8}\.md$/;

function home() {
  return process.env.DSH_HOME || join(process.env.USERPROFILE || '', '.dsh');
}
function redteamDir() {
  return join(home(), 'redteam');
}
function dshPurgeRoot() {
  const cands = [
    'C:/Users/Administrator/AppData/Local/Programs/DeepSeek Harness/resources/plugins/dsh-purge',
    join(process.env.USERPROFILE || '', '.dsh/profiles/desktop/node_modules/dsh-purge'),
    join(process.env.USERPROFILE || '', '.dsh/profiles/web/node_modules/dsh-purge'),
  ];
  return cands.find((p) => p && existsSync(join(p, 'scripts', 'intel-sweep.mjs'))) || null;
}

export async function listIntelReports() {
  const dir = redteamDir();
  if (!existsSync(dir)) return { ok: true, dir: dir, reports: [] };
  const files = await readdir(dir).catch(() => []);
  const reports = [];
  for (const name of files) {
    if (!REPORT_NAME.test(name)) continue;
    const st = await stat(join(dir, name)).catch(() => null);
    reports.push({ name: name, bytes: st ? st.size : 0, mtime: st ? st.mtime.toISOString() : null, kind: name.startsWith('vuln-intel') ? '漏洞情报' : '信息差巡检' });
  }
  reports.sort((a, b) => b.name.localeCompare(a.name));
  return { ok: true, dir: dir, reports: reports };
}

export async function readIntelReport(name) {
  if (!REPORT_NAME.test(String(name || ''))) throw new Error('报告名不合法');
  const file = join(redteamDir(), name);
  if (!existsSync(file)) return { ok: false, error: 'not_found', name: name };
  const text = await readFile(file, 'utf8');
  const clipped = text.length > 60000 ? text.slice(0, 60000) + '\n…（已截断，共 ' + text.length + ' 字符）' : text;
  const st = await stat(file);
  return { ok: true, name: name, path: file, text: clipped, bytes: st.size, mtime: st.mtime.toISOString(), truncated: text.length > 60000 };
}

/** 跑一次巡检。真实出网抓 7 个源，最坏 3 分钟内；失败也要把 stderr 带回来。 */
export function runIntelSweep({ days = 7, timeoutMs = 180000 } = {}) {
  const root = dshPurgeRoot();
  if (!root) return Promise.resolve({ ok: false, error: 'intel_script_missing', detail: '本机没装 dsh-purge，找不到 scripts/intel-sweep.mjs' });
  const script = join(root, 'scripts', 'intel-sweep.mjs');
  const n = Math.min(Math.max(Number(days) || 7, 1), 30);
  const started = Date.now();
  return new Promise((resolve) => {
    let out = '';
    let err = '';
    let done = false;
    const child = spawn(process.execPath, [script, '--days', String(n)], {
      cwd: root,
      env: process.env,
      windowsHide: true,
    });
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try { child.kill(); } catch { /* ignore */ }
      resolve({ ok: false, error: 'timeout', elapsedMs: Date.now() - started, days: n, stdoutTail: tail(out), stderrTail: tail(err) });
    }, timeoutMs);
    child.stdout.on('data', (b) => { out += b.toString('utf8'); });
    child.stderr.on('data', (b) => { err += b.toString('utf8'); });
    child.on('error', (e) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ ok: false, error: 'spawn_failed', detail: String((e && e.message) || e), elapsedMs: Date.now() - started });
    });
    child.on('close', (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const m = out.match(/已写入\s+(.+intel-sweep-\d{8}\.md)/);
      resolve({
        ok: code === 0,
        code: code,
        days: n,
        elapsedMs: Date.now() - started,
        reportName: m ? m[1].split(/[\\/]/).pop() : null,
        reportPath: m ? m[1].trim() : null,
        stdoutTail: tail(out),
        stderrTail: tail(err),
      });
    });
  });
}

function tail(s, n = 4000) {
  const t = String(s || '');
  return t.length > n ? t.slice(t.length - n) : t;
}
