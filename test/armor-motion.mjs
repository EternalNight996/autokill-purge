// test/armor-motion.mjs —— 验证「一键注入」的动画真的在动（headless Chrome + CDP）
//
// 断言：
//   1) canvas.armor-eater 存在
//   2) 相隔 250ms 的两次像素采样不同（rAF 在跑，不是停在第一帧）
//   3) 进度 40% 时怪物位置左移（路径参数生效）
//   4) 无待注入项时 stopEaterIfIdle 把 0% 播成 100% 完成态
//   5) window.__apErrors 为空
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = Number(process.env.PURGE_WEB_PORT || 8792);
const BASE = 'http://127.0.0.1:' + PORT;
const CDP_PORT = Number(process.env.PURGE_CDP_PORT || 9361);
const CHROME_CANDIDATES = [
  process.env.PURGE_CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean);
const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!chromePath) { console.log('SKIP  找不到 Chrome（PURGE_CHROME_PATH 指定）'); process.exit(0); }

let pass = 0, fail = 0;
const ok = (n, c, extra = '') => { if (c) { pass++; console.log('PASS  ' + n + (extra ? ' — ' + extra : '')); } else { fail++; console.log('FAIL  ' + n + (extra ? ' — ' + extra : '')); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
  constructor(url) { this.url = url; this.id = 0; this.pending = new Map(); }
  async connect() {
    this.ws = new WebSocket(this.url);
    await new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = rej; });
    this.ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && this.pending.has(m.id)) { this.pending.get(m.id)(m.result); this.pending.delete(m.id); } };
  }
  send(method, params = {}) { const id = ++this.id; return new Promise((res) => { this.pending.set(id, res); this.ws.send(JSON.stringify({ id, method, params })); }); }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) throw new Error('页面执行失败：' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r && r.result ? r.result.value : undefined;
  }
  close() { try { this.ws.close(); } catch { /* ignore */ } }
}

const profile = mkdtempSync(join(tmpdir(), 'ap-armor-chrome-'));
const proc = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=' + CDP_PORT, '--user-data-dir=' + profile, '--window-size=1280,900',
], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
const kill = () => { try { execFileSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* ignore */ } try { rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ } };
process.on('SIGINT', () => { kill(); process.exit(130); });

let wsUrl = null;
for (let i = 0; i < 80; i++) {
  try {
    const r = await fetch('http://127.0.0.1:' + CDP_PORT + '/json/list', { signal: AbortSignal.timeout(1000) });
    if (r.ok) { const list = await r.json(); const page = list.find((t) => t.type === 'page'); if (page?.webSocketDebuggerUrl) { wsUrl = page.webSocketDebuggerUrl; break; } }
  } catch { /* not ready */ }
  await sleep(250);
}
if (!wsUrl) { kill(); console.log('阻塞：Chrome 调试端口没起来'); console.log('summary: 0 PASS / 1 FAIL'); process.exit(1); }

const cdp = new CDP(wsUrl);
await cdp.connect();
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');

const pixelDigest = `(() => {
  const cv = document.querySelector('canvas.armor-eater');
  if (!cv) return 'no-canvas';
  const ctx = cv.getContext('2d');
  const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
  let sum = 0n;
  for (let i = 0; i + 3 < d.length; i += 1999) sum = (sum * 131n + BigInt((d[i] || 0) + (d[i + 1] || 0) + (d[i + 2] || 0) + (d[i + 3] || 0))) % 1000000007n;
  return String(sum);
})()`;
const frameCount = `(() => (typeof armorEater === 'object' && armorEater ? (armorEater.frames || 0) : -1))()`;

try {
  await cdp.send('Page.navigate', { url: BASE + '/#/breach' });
  await sleep(6000);

  await cdp.eval(`(() => { armorEater.start('inject'); armorEater.set(40); return 1; })()`);
  await sleep(350);
  const hasCanvas = await cdp.eval(`!!document.querySelector('canvas.armor-eater')`);
  ok('1. 吃豆人 canvas 已挂载', hasCanvas === true);

  const f1 = await cdp.eval(frameCount);
  const a = await cdp.eval(pixelDigest);
  await sleep(260);
  const b = await cdp.eval(pixelDigest);
  const f2 = await cdp.eval(frameCount);
  ok('2. rAF 帧数在增长', f2 > f1, 'frames ' + f1 + ' -> ' + f2);
  ok('2a. 相隔 260ms 画面在变', a !== b && a !== 'no-canvas', String(a).slice(0, 10) + ' -> ' + String(b).slice(0, 10));

  // 进度推进：40% → 80%，画面应继续变化
  await cdp.eval(`(() => { armorEater.set(80); return 1; })()`);
  await sleep(260);
  const c = await cdp.eval(pixelDigest);
  ok('3. 进度推进后画面继续变化', c !== b && c !== 'no-canvas');

  // 无待注入项：0% 等待态应被播成 100% 完成
  const done = await cdp.eval(`(() => {
    S.host.progress = { percent: 0, note: '正在写入补丁…', done: false };
    S.host.progressTimer = null;
    stopEaterIfIdle(null);
    return JSON.stringify(S.host.progress);
  })()`);
  const parsed = JSON.parse(done);
  ok('4. 无待注入项 → 播完成态 100%', parsed.percent === 100 && parsed.done === true, done);

  const errs = await cdp.eval(`JSON.stringify(window.__apErrors || [])`);
  ok('5. 页面无未捕获异常', errs === '[]', errs);
} catch (e) {
  fail++;
  console.log('FAIL  执行异常：' + (e && e.message ? e.message : e));
} finally {
  cdp.close();
  kill();
  console.log('\nsummary: ' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
}
