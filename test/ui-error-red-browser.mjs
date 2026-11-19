// test/ui-error-red-browser.mjs —— 报错红色标识的浏览器级验收（headless Chrome / CDP）
// 前置：控制台在跑（默认 8792）。找不到 Chrome 时 SKIP，不算失败。
// 断言：失败请求 → toast 红色（类名/role/边框色 = --bad）；确认 toast 仍中性；
//       运行时错误横幅只在技术模式显示且为 alert.bad；右侧栏「提示词注入」行未生效时标红；全程 __apErrors=0。
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

const PORT = Number(process.env.PURGE_WEB_PORT || 8792);
const BASE = 'http://127.0.0.1:' + PORT;
const CDP_PORT = Number(process.env.PURGE_CDP_PORT_RED || 9352);
const CHROME = [process.env.PURGE_CHROME_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'].filter(Boolean).find((p) => existsSync(p));
if (!CHROME) { console.log('SKIP  找不到 Chrome（用 PURGE_CHROME_PATH 指定）'); process.exit(0); }

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('PASS  ' + name + (extra ? ' — ' + extra : '')); }
  else { fail++; console.log('FAIL  ' + name + (extra ? ' — ' + extra : '')); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
    if (r && r.exceptionDetails) throw new Error('页面执行失败：' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
    return r && r.result ? r.result.value : undefined;
  }
  close() { try { this.ws.close(); } catch { /* ignore */ } }
}

const profile = mkdtempSync(join(tmpdir(), 'ap-red-chrome-'));
const proc = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=' + CDP_PORT, '--user-data-dir=' + profile, '--window-size=1280,900'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
const killChrome = () => { try { execFileSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* exited */ } try { rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ } };
process.on('SIGINT', () => { killChrome(); process.exit(130); });

let wsUrl = null;
for (let i = 0; i < 60; i++) {
  await sleep(250);
  try {
    const list = await fetch('http://127.0.0.1:' + CDP_PORT + '/json/list', { signal: AbortSignal.timeout(1200) }).then((r) => r.json());
    const page = (list || []).find((t) => t.type === 'page');
    if (page && page.webSocketDebuggerUrl) { wsUrl = page.webSocketDebuggerUrl; break; }
  } catch { /* retry */ }
}
if (!wsUrl) { console.log('FAIL  Chrome CDP 没起来'); killChrome(); process.exit(1); }

const cdp = new CDP(wsUrl);
await cdp.connect();
await cdp.send('Runtime.enable');
await cdp.send('Page.enable');
await cdp.send('Page.navigate', { url: BASE + '/#/breach' });

let ready = false;
for (let i = 0; i < 80; i++) {
  await sleep(250);
  try { ready = await cdp.eval("!!(document.getElementById('toast') && typeof S !== 'undefined' && document.getElementById('injectRail') && document.getElementById('page') && document.getElementById('page').children.length > 0)"); if (ready) break; } catch { /* retry */ }
}
ok('1. 控制台页面就绪', ready === true);

if (ready) {
  const toastSrc = [
    '  (async () => {',
    '    try { await request(\'/api/inject/summary?host=evil\'); toastError(\'x\'); } catch (e) { toastError(simpleReason(e)); }',
    '    const el = document.getElementById(\'toast\');',
    '    const probe = document.createElement(\'span\');',
    '    probe.style.color = \'var(--bad)\';',
    '    document.body.appendChild(probe);',
    '    const bad = getComputedStyle(probe).color; probe.remove();',
    '    const out = { cls: el.className, role: el.getAttribute(\'role\'), live: el.getAttribute(\'aria-live\'), border: getComputedStyle(el).borderTopColor, bad };',
    '    toast(\'__ok__\');',
    '    const okEl = document.getElementById(\'toast\');',
    '    out.okCls = okEl.className; out.okBorder = getComputedStyle(okEl).borderTopColor;',
    '    return JSON.stringify(out);',
    '  })()',
  ].join(String.fromCharCode(10));
  const pp = JSON.parse(await cdp.eval(toastSrc));
  ok('2. 失败请求 → toast 带 bad 类', /bad/.test(pp.cls), pp.cls);
  ok('3. 红态 role=alert + aria-live=assertive', pp.role === 'alert' && pp.live === 'assertive', pp.role + '/' + pp.live);
  ok('4. 红态边框 = --bad', pp.border === pp.bad, pp.border + ' vs ' + pp.bad);
  ok('5. 确认 toast 仍中性', !/bad/.test(pp.okCls) && pp.okBorder !== pp.bad, pp.okCls);

  const bannerSrc = [
    '  (() => {',
    '    S.uiMode = \'technical\';',
    '    window.__apErrors.push({ kind: \'error\', message: \'__probe__\', source: \'p.js\', line: 1 });',
    '    renderRuntimeErrors();',
    '    const box = document.getElementById(\'runtimeErrors\');',
    '    const out = { visible: !box.hidden, hasBad: !!box.querySelector(\'.alert.bad\') };',
    '    S.uiMode = \'simple\'; renderRuntimeErrors(); out.hidden = box.hidden;',
    '    window.__apErrors.pop(); renderRuntimeErrors();',
    '    return JSON.stringify(out);',
    '  })()',
  ].join(String.fromCharCode(10));
  const banner = JSON.parse(await cdp.eval(bannerSrc));
  ok('6. 运行时错误横幅（技术模式可见 + alert.bad）', banner.visible === true && banner.hasBad === true);
  ok('7. 普通模式下横幅隐藏', banner.hidden === true);

  const railSrc = [
    '  (() => {',
    '    const el = document.getElementById(\'injectRail\');',
    '    const st = (typeof railState !== \'undefined\' && railState && railState.data) || null;',
    '    if (!el || el.dataset.loading !== \'0\') return JSON.stringify({ loading: true });',
    '    const row = Array.from(el.querySelectorAll(\'.rail-kv\')).find((r) => r.innerText.includes(\'提示词注入\')) || null;',
    '    return JSON.stringify({ loading: false, has: !!row, red: row ? row.querySelector(\'.rail-err\') !== null : false, hasInstructions: !!(Array.from(el.querySelectorAll(\'.rail-kv\')).find((r) => r.innerText.includes(\'\u6307\u4ee4\u5c42\'))), effective: st && st.injection ? !!st.injection.effective : null, errors: (window.__apErrors || []).length });',
    '  })()',
  ].join(String.fromCharCode(10));
  let rail = null;
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    rail = JSON.parse(await cdp.eval(railSrc));
    if (rail && rail.loading === false) break;
  }
  ok('8. 右侧栏有「提示词注入」行', !!(rail && rail.has));
  ok('8a. 右侧栏有「指令层」行', !!(rail && rail.hasInstructions));
  ok('9. 未生效时该行标红', !!(rail && rail.has && (rail.effective ? true : rail.red)), 'effective=' + (rail && rail.effective) + ' red=' + (rail && rail.red));
  ok('10. 全程 __apErrors 干净', !!rail && rail.errors === 0, 'errors=' + (rail && rail.errors));
}

cdp.close();
killChrome();
console.log('');
console.log('summary: ' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);