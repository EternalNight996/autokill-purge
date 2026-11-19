// test/rail-host.mjs —— 右侧「注入状态」栏必须跟着宿主切换（浏览器端）
//
// 前置：控制台在跑（默认 8792，PURGE_WEB_PORT 可改；PURGE_CHROME_PATH / PURGE_CDP_PORT 可覆盖）。
// 断言重点：
//   · 切宿主后**立刻**清空旧宿主数字（不留 A 宿主的数给 B 宿主看）
//   · 数据回来后 data-host 与标题跟着变，且内容是本宿主的那套（DSH 59/83、AutoKill 梦神破甲…）
//   · 切回 DSH 数据能回来（缓存/单飞不把栏钉死在旧值）
//   · 全程 window.__apErrors 为空
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

const PORT = Number(process.env.PURGE_WEB_PORT || 8792);
const BASE = 'http://127.0.0.1:' + PORT;
const CDP_PORT = Number(process.env.PURGE_CDP_PORT || 9351);
const CHROME_CANDIDATES = [
  process.env.PURGE_CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean);

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('PASS  ' + name + (extra ? ' — ' + extra : '')); }
  else { fail++; console.log('FAIL  ' + name + (extra ? ' — ' + extra : '')); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clip = (s, n = 220) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!chromePath) {
  console.log('SKIP  找不到 Chrome（用 PURGE_CHROME_PATH 指定）');
  console.log('summary: 0 PASS / 0 FAIL / 1 SKIP');
  process.exit(0);
}

class CDP {
  constructor(url) { this.url = url; this.id = 0; this.pending = new Map(); }
  async connect() {
    this.ws = new WebSocket(this.url);
    await new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = rej; });
    this.ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) { this.pending.get(m.id)(m.result); this.pending.delete(m.id); }
    };
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res) => { this.pending.set(id, res); this.ws.send(JSON.stringify({ id, method, params })); });
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) {
      throw new Error('页面执行失败：' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
    }
    return r && r.result ? r.result.value : undefined;
  }
  close() { try { this.ws.close(); } catch { /* ignore */ } }
}

const readRail = () => `(() => {
  const el = document.getElementById('injectRail');
  if (!el) return JSON.stringify({ missing: true });
  return JSON.stringify({
    host: el.dataset.host || '',
    loading: el.dataset.loading || '',
    head: (el.querySelector('h3') || {}).textContent || '',
    text: (el.innerText || '').replace(/\\s+/g, ' ').slice(0, 300),
  });
})()`;
const switchHost = (id) => `(() => {
  const s = document.getElementById('hostSwitch');
  if (!s) return 'no-switch';
  s.value = '${id}';
  s.dispatchEvent(new Event('change', { bubbles: true }));
  return s.value;
})()`;

const profile = mkdtempSync(join(tmpdir(), 'ap-rail-chrome-'));
const proc = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=' + CDP_PORT, '--user-data-dir=' + profile, '--window-size=1280,900',
], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });

const killChrome = () => {
  try { execFileSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* 已退出 */ }
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
};
process.on('SIGINT', () => { killChrome(); process.exit(130); });

let wsUrl = null;
for (let i = 0; i < 80; i++) {
  try {
    const r = await fetch('http://127.0.0.1:' + CDP_PORT + '/json/list', { signal: AbortSignal.timeout(1000) });
    if (r.ok) {
      const list = await r.json();
      const page = list.find((t) => t.type === 'page');
      if (page && page.webSocketDebuggerUrl) { wsUrl = page.webSocketDebuggerUrl; break; }
    }
  } catch { /* 还没起来 */ }
  await sleep(250);
}
if (!wsUrl) { killChrome(); console.log('阻塞：Chrome 调试端口没起来'); console.log('summary: 0 PASS / 1 FAIL'); process.exit(1); }

const cdp = new CDP(wsUrl);
await cdp.connect();
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');

try {
  await cdp.send('Page.navigate', { url: BASE + '/#/breach' });
  await sleep(6000);

  // 1) 首屏：DSH 数据
  let r = JSON.parse(await cdp.eval(readRail()));
  ok('1. 首屏栏挂在 dsh', r.host === 'dsh', 'head=' + clip(r.head, 40));
  ok('1a. 首屏有 83 条补丁的实数字', /59\/83|\d+\/83/.test(r.text), clip(r.text, 80));

  // 2) 切 MengBot：先清空（不许残留 DSH 的 59/83），再换成 MengBot 的数
  await cdp.eval(switchHost('mengbot'));
  await sleep(160);
  r = JSON.parse(await cdp.eval(readRail()));
  ok('2. 切到 mengbot 时 data-host 立刻变', r.host === 'mengbot', 'host=' + r.host);
  ok('2a. 切换瞬间清空旧宿主数字', !/\d+\/83/.test(r.text), clip(r.text, 80));
  ok('2b. 切换瞬间显示读取中', r.loading === '1' || /读取中/.test(r.text), 'loading=' + r.loading);

  let mb = null;
  for (let i = 0; i < 24; i++) { // 最多等 6s
    await sleep(250);
    mb = JSON.parse(await cdp.eval(readRail()));
    if (mb.host === 'mengbot' && mb.loading === '0') break;
  }
  ok('2c. MengBot 数据到位', mb && mb.host === 'mengbot' && mb.loading === '0');
  ok('2d. 标题是 MengBot 且无 DSH 补丁数', /MengBot/i.test(mb.head) && !/\d+\/83/.test(mb.text), clip(mb.text, 110));
  ok('2e. 说明 MengBot 没有补丁层', /没有字节补丁层|SOUL/.test(mb.text), clip(mb.text, 120));

  // 3) 切 AutoKill：梦神破甲 9 项
  await cdp.eval(switchHost('autokill'));
  let ak = null;
  for (let i = 0; i < 24; i++) {
    await sleep(250);
    ak = JSON.parse(await cdp.eval(readRail()));
    if (ak.host === 'autokill' && ak.loading === '0') break;
  }
  ok('3. AutoKill 数据到位', ak && ak.host === 'autokill', 'host=' + (ak && ak.host));
  ok('3a. 显示梦神破甲与 9 项', /梦神破甲/.test(ak.text) && /\/9/.test(ak.text), clip(ak.text, 120));
  ok('3b. 带上 config / CLI 信息', /config|CLI/.test(ak.text), clip(ak.text, 120));

  // 4) 切回 DSH：数字回来（缓存/单飞没把栏钉死）
  await cdp.eval(switchHost('dsh'));
  let back = null;
  for (let i = 0; i < 30; i++) {
    await sleep(250);
    back = JSON.parse(await cdp.eval(readRail()));
    if (back.host === 'dsh' && back.loading === '0') break;
  }
  ok('4. 切回 dsh 数据复位', back && back.host === 'dsh' && /\d+\/83/.test(back.text), clip(back.text, 90));

  // 5) 逻辑闭环：任何写操作（这里用 host/snapshot，安全且真的写盘）之后栏要自己重取
  const atBefore = Number(await cdp.eval("document.getElementById('injectRail').dataset.at || 0"));
  // 用页面自己的 request() 发这个写请求 —— 闭环钩子就挂在它上面
  const snap = await cdp.eval(`request('/api/host/snapshot', { method: 'POST', body: { tag: 'rail-test' } }).then((r) => JSON.stringify(r)).catch((e) => JSON.stringify({ ok: false, error: String(e && e.message || e) }))`)
    .then((s) => { try { return JSON.parse(s); } catch { return null; } })
    .catch(() => null);
  ok('5. 写操作成功（host/snapshot）', !!snap && snap.ok !== false, clip(JSON.stringify(snap || {}), 90));
  let atAfter = atBefore;
  for (let i = 0; i < 24; i++) {
    await sleep(400);
    atAfter = Number(await cdp.eval("document.getElementById('injectRail').dataset.at || 0"));
    if (atAfter > atBefore) break;
  }
  ok('5a. 写操作后栏自动刷新（at 变大）', atAfter > atBefore, atBefore + ' → ' + atAfter);

  // 6) 无脚本错误
  const errs = await cdp.eval('JSON.stringify(window.__apErrors || [])');
  ok('6. window.__apErrors 为空', errs === '[]', String(errs).slice(0, 160));

  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  try { writeFileSync(join('data', 'shot-rail-host.png'), Buffer.from(shot.data, 'base64')); } catch { /* 截图只是留证 */ }
} finally {
  cdp.close();
  killChrome();
}

console.log('\nsummary: ' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
