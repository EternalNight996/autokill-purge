// test/persona-ui.mjs —— 人格台端到端：渲染 10 张卡 → 点卡注入 → 卸下恢复
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = 'http://127.0.0.1:' + (process.env.PURGE_WEB_PORT || 8792);
const CDP_PORT = Number(process.env.PURGE_CDP_PORT || 9377);
const chromePath = [process.env.PURGE_CHROME_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'].filter(Boolean).find((p) => existsSync(p));
if (!chromePath) { console.log('SKIP  找不到 Chrome'); process.exit(0); }

let pass = 0, fail = 0;
const ok = (n, c, extra = '') => { if (c) { pass++; console.log('PASS  ' + n + (extra ? ' — ' + extra : '')); } else { fail++; console.log('FAIL  ' + n + (extra ? ' — ' + extra : '')); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
  constructor(u) { this.u = u; this.id = 0; this.p = new Map(); }
  async connect() { this.ws = new WebSocket(this.u); await new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = rej; }); this.ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && this.p.has(m.id)) { this.p.get(m.id)(m.result); this.p.delete(m.id); } }; }
  send(m, params = {}) { const id = ++this.id; return new Promise((r) => { this.p.set(id, r); this.ws.send(JSON.stringify({ id, method: m, params })); }); }
  async eval(x) { const r = await this.send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); if (r?.exceptionDetails) return 'ERR ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r?.result?.value; }
}

const profile = mkdtempSync(join(tmpdir(), 'ap-persona-ui-'));
const proc = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=' + CDP_PORT, '--user-data-dir=' + profile, '--window-size=1440,900'], { stdio: 'ignore', windowsHide: true });
const kill = () => { try { execFileSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* ignore */ } try { rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ } };

let ws = null;
for (let i = 0; i < 80; i++) { try { const r = await fetch('http://127.0.0.1:' + CDP_PORT + '/json/list', { signal: AbortSignal.timeout(1000) }); if (r.ok) { const l = await r.json(); const pg = l.find((t) => t.type === 'page'); if (pg?.webSocketDebuggerUrl) { ws = pg.webSocketDebuggerUrl; break; } } } catch { /* retry */ } await sleep(250); }
const cdp = new CDP(ws);
await cdp.connect();
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');
await cdp.send('Page.navigate', { url: BASE + '/#/breach' });
await sleep(7000);

try {
  // 0. boot 必须成功（否则整页都挂在「连不上控制台服务」的红条上）
  const boot = await cdp.eval(`JSON.stringify({ booted: S.booted, err: S.bootError && S.bootError.message, alert: (document.getElementById("globalAlert")||{}).innerText || "" })`);
  const bj = JSON.parse(boot);
  ok('0. boot 成功、无红条、无 bootError', bj.booted === true && !bj.err && !String(bj.alert).includes('连不上'), boot);

  // 1. 区块在页面上
  const has = await cdp.eval(`(() => {
    const d = document.querySelector('details[data-group="persona"]');
    if (!d) return JSON.stringify({ found: false });
    d.open = true;
    renderPage();
    return JSON.stringify({ found: true });
  })()`);
  ok('1. 页面有「人格」区块', JSON.parse(has).found === true);

  await sleep(1200);
  const cards = await cdp.eval(`(() => {
    const d = document.querySelector('details[data-group="persona"]');
    if (!d) return '0';
    return String(d.querySelectorAll('[data-persona-toggle]').length);
  })()`);
  ok('2. 展开后渲染出人格卡', Number(cards) >= 10, 'cards=' + cards);

  // 2. 点第一张卡 → 注入
  const first = await cdp.eval(`(() => {
    const d = document.querySelector('details[data-group="persona"]');
    const btn = d && d.querySelector('[data-persona-toggle]');
    if (!btn) return 'no-card';
    const id = btn.dataset.personaToggle;
    btn.click();                        // 多选模式：点击 = 加入选中，不立即注入
    return id;
  })()`);
  ok('2a. 点到某张卡（进入选中态）', first !== 'no-card', String(first));
  await sleep(700);
  const selState = await cdp.eval(`(() => JSON.stringify({ selected: (S.persona.selected || []).length, applyBtn: !!document.querySelector('[data-persona-apply-selected]'), diag: null }))()`);
  const ss = JSON.parse(selState);
  ok('2b. 选中 1 张且出现「应用所选」', ss.selected === 1 && ss.applyBtn === true, selState);
  await cdp.eval(`(() => { const b = document.querySelector('[data-persona-apply-selected]'); if (b) b.click(); return 1; })()`);
  await sleep(600);
  const diag = await cdp.eval(`(() => JSON.stringify({ busy: S.persona.busy, msg: S.persona.message, host: S.hostTarget, tried: S.persona.tried, cards: (S.persona.data && S.persona.data.cards || []).length, errs: (window.__apErrors || []).map((e) => e.message).slice(0, 3) }))()`);
  console.log('  diag:', diag);
  await sleep(2500);

  const activeAfter = await cdp.eval(`(() => {
    const a = S.persona && S.persona.data && S.persona.data.active && S.persona.data.active.dsh;
    return JSON.stringify({ active: a && a.active, message: S.persona && S.persona.message });
  })()`);
  const aa = JSON.parse(activeAfter);
  ok('3. 注入后 DSH 有生效人格', !!(aa.active && aa.active.name), JSON.stringify(aa.active));

  const fileHasBlock = await fetch(BASE + '/api/persona/list').then((r) => r.json()).then((j) => !!(j.active && j.active.dsh && j.active.dsh.active));
  ok('3a. 后端确认写入', fileHasBlock === true);

  // 3. 卸下
  await cdp.eval(`(() => { const b = document.querySelector('[data-persona-clear]'); if (b) b.click(); return 1; })()`);
  await sleep(2200);
  const cleared = await fetch(BASE + '/api/persona/list').then((r) => r.json());
  ok('4. 卸下后 DSH 无生效人格', !(cleared.active && cleared.active.dsh && cleared.active.dsh.active), JSON.stringify(cleared.active && cleared.active.dsh && cleared.active.dsh.active));

  const errs = await cdp.eval('JSON.stringify(window.__apErrors || [])');
  ok('5. 页面无未捕获异常', errs === '[]', String(errs).slice(0, 160));
} catch (e) {
  fail++;
  console.log('FAIL  执行异常：' + (e && e.message ? e.message : e));
} finally {
  cdp.ws.close();
  kill();
  console.log('\nsummary: ' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
}
