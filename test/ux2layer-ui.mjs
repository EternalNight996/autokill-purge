#!/usr/bin/env node
// =============================================================================
// test/ux2layer-ui.mjs — 双层体验（simple / technical）浏览器端验收驱动
// -----------------------------------------------------------------------------
// 零依赖：只用 Node 内置模块 + 全局 WebSocket / fetch / AbortSignal.timeout（Node 20+，本机 24）。
// 自己起 headless Chrome，自己说 CDP，自己断言 + 截图。
//
// 判定口径来源：docs/UX-2LAYER-CONTRACT.md
//   §2 DOM 约定（#nav / #main / #page / #modeSwitch / ol.steps / 文案）
//   §3 16 条验收表 —— 本脚本负责浏览器部分（#1..#15），服务端部分不归本脚本。
//
// 用法：
//   $env:PURGE_WEB_PORT=8795; node web/server.mjs      # 被测实例（8795）
//   node test/ux2layer-ui.mjs
//   node test/ux2layer-ui.mjs --base http://127.0.0.1:8795
//
// 环境变量：
//   PURGE_WEB_BASE     被测基址，默认 http://127.0.0.1:8795
//   PURGE_CDP_PORT     Chrome 调试端口，默认 9334
//   PURGE_CHROME_PATH  自定义 chrome.exe 路径
//
// 退出码：0 = 全通过（允许 SKIP）｜1 = 有 FAIL｜2 = 阻塞（服务不可达 / Chrome 缺失 / 前端双层未落地）
//
// 红线：本脚本只新建自己（test/ux2layer-ui.mjs）、_ui-test/shots-ux2/*.png 与
//       test/ux2layer-ui-results.txt。不碰 web/public/**、web/server.mjs、docs/**。
// =============================================================================

import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect as netConnect } from 'node:net';

// ---- 常量 -------------------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const SHOT_DIR = join(ROOT, '_ui-test', 'shots-ux2');
const LOG_FILE = join(ROOT, 'test', 'ux2layer-ui-results.txt');

const argv = process.argv.slice(2);
function argOf(flag) {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}
const BASE = String(argOf('--base') || process.env.PURGE_WEB_BASE || 'http://127.0.0.1:8795').replace(/\/+$/, '');
const CDP_PORT = Number(argOf('--cdp-port') || process.env.PURGE_CDP_PORT || 9334);
const CHROME_CANDIDATES = [
  process.env.PURGE_CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  join(process.env.LOCALAPPDATA || '.', 'Google\\Chrome\\Application\\chrome.exe'),
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);

// 契约 §3 #15：三宽度
const WIDTHS = [
  [1280, 900],
  [390, 844],
  [320, 720],
];

// 契约 §2.6 / §3 #4 禁用词（大小写敏感，按字面）
const BANNED_TEXT = /breakDir|pluginPath|wasm|token|memoryBase|payload|variant|layer|technique|schema|API|HTTP|\b403\b|\b400\b|\b500\b/;
// 契约 §2.4 / §3 #11 设置页禁用字段（token 额外不区分大小写）
const BANNED_SETTINGS_WORDS = ['breakDir', 'pluginPath', 'memoryBase', 'token', '令牌'];

const EXIT = { ok: 0, fail: 1, blocked: 2 };
const TASK_TEXT = '写一段测试文本';

// ---- 日志 -------------------------------------------------------------------

const lines = []; // 落 test/ux2layer-ui-results.txt 的完整日志
const log = (text = '') => {
  lines.push(text);
  console.log(text);
};

function clip(s, n = 300) {
  const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
}

// 只用于「等渲染」的固定缓冲（契约里明确要求的 600ms 等 SPA 渲染）；
// 其余所有等待都是轮询 + 超时。
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function sleepSync(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    const t = Date.now();
    while (Date.now() - t < ms) {
      /* busy wait */
    }
  }
}

// ---- 结果收集 -----------------------------------------------------------------

const results = []; // {n, status, title, detail}
const shots = []; // {file, bytes}
const jsLog = []; // {kind, text}
const ctx = { payloads: 0 };

function record(n, status, title, detail = '') {
  results.push({ n, status, title, detail });
  log(`${status}  ${n}. ${title}${detail ? '  — ' + detail : ''}`);
  return { status, detail };
}

const ok = (detail = '') => ({ status: 'PASS', detail });
const bad = (detail = '') => ({ status: 'FAIL', detail });
const skip = (detail = '') => ({ status: 'SKIP', detail });

/** 跑一条断言：函数抛错也变成 FAIL（带页面文本前 300 字符），不炸栈。 */
async function run(n, title, fn) {
  try {
    const r = (await fn()) || ok('');
    return record(n, r.status || 'PASS', title, r.detail || '');
  } catch (e) {
    let tail = '';
    try {
      tail = await page.evalJS(inPage('return __text().slice(0, 300);'));
    } catch {
      tail = '';
    }
    const msg = `异常：${e && e.message ? e.message : String(e)}`;
    return record(n, 'FAIL', title, tail ? `${msg} | 页面文本：${clip(tail, 300)}` : msg);
  }
}

// ---- HTTP（Node 侧直连：前置签署 / attempts 增量）--------------------------------

async function api(path, opts = {}) {
  const { timeout = 8000, ...rest } = opts;
  const res = await fetch(BASE + path, {
    ...rest,
    headers: {
      accept: 'application/json',
      ...(rest.body ? { 'content-type': 'application/json' } : {}),
      ...(rest.headers || {}),
    },
    signal: AbortSignal.timeout(timeout),
  });
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, ok: res.ok, data, text };
}

async function attemptCount() {
  const r = await api('/api/state');
  const a = r.data && r.data.state && r.data.state.attempts;
  return Array.isArray(a) ? a.length : null;
}

// ---- 最小 CDP 客户端 -----------------------------------------------------------

class CDP {
  #ws = null;
  #id = 0;
  #pending = new Map();
  #listeners = new Map();
  #closed = false;

  constructor(url) {
    this.url = url;
  }

  connect(openTimeout = 10000) {
    return new Promise((resolveP, rejectP) => {
      let ws;
      try {
        ws = new WebSocket(this.url);
      } catch (e) {
        return rejectP(new Error(`CDP WebSocket 创建失败：${e.message}`));
      }
      this.#ws = ws;
      const timer = setTimeout(() => {
        try {
          ws.close();
        } catch {
          /* empty */
        }
        rejectP(new Error(`CDP WebSocket 连接超时 ${openTimeout}ms（${this.url}）`));
      }, openTimeout);
      ws.addEventListener('open', () => {
        clearTimeout(timer);
        resolveP(this);
      });
      ws.addEventListener('message', (ev) => this.#onMessage(ev.data));
      ws.addEventListener('error', () => {
        clearTimeout(timer);
        rejectP(new Error(`CDP WebSocket 出错（${this.url}）`));
      });
      ws.addEventListener('close', () => {
        this.#closed = true;
        for (const p of this.#pending.values()) p.reject(new Error(`CDP 已关闭，未完成：${p.method}`));
        this.#pending.clear();
      });
    });
  }

  #onMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(typeof raw === 'string' ? raw : Buffer.from(raw).toString('utf8'));
    } catch {
      return;
    }
    if (msg.id !== undefined) {
      const p = this.#pending.get(msg.id);
      if (!p) return;
      this.#pending.delete(msg.id);
      if (msg.error) p.reject(new Error(`CDP ${p.method} → ${msg.error.message || JSON.stringify(msg.error)}`));
      else p.resolve(msg.result);
      return;
    }
    if (!msg.method) return;
    const list = this.#listeners.get(msg.method);
    if (!list) return;
    for (const fn of list.slice()) {
      try {
        fn(msg.params || {}, msg.sessionId || null);
      } catch (e) {
        jsLog.push({ kind: 'driver', text: `监听器异常(${msg.method}): ${e.message}` });
      }
    }
  }

  send(method, params = {}, sessionId = null, timeoutMs = 20000) {
    if (this.#closed) return Promise.reject(new Error(`CDP 已关闭，无法发送 ${method}`));
    const id = ++this.#id;
    return new Promise((resolveP, rejectP) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        rejectP(new Error(`CDP ${method} 超时 ${timeoutMs}ms`));
      }, timeoutMs);
      this.#pending.set(id, {
        method,
        resolve: (v) => {
          clearTimeout(timer);
          resolveP(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          rejectP(e);
        },
      });
      const payload = { id, method, params };
      if (sessionId) payload.sessionId = sessionId;
      try {
        this.#ws.send(JSON.stringify(payload));
      } catch (e) {
        clearTimeout(timer);
        this.#pending.delete(id);
        rejectP(new Error(`CDP ${method} 发送失败：${e.message}`));
      }
    });
  }

  on(method, fn) {
    if (!this.#listeners.has(method)) this.#listeners.set(method, []);
    this.#listeners.get(method).push(fn);
  }

  /** 等一个事件；超时返回 null（不挂死） */
  waitEvent(method, timeoutMs = 20000, sessionId = null) {
    return new Promise((resolveP) => {
      let done = false;
      const finish = (v) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        const list = this.#listeners.get(method) || [];
        const i = list.indexOf(handler);
        if (i >= 0) list.splice(i, 1);
        resolveP(v);
      };
      const handler = (params, sid) => {
        if (sessionId && sid && sid !== sessionId) return;
        finish(params);
      };
      this.on(method, handler);
      const timer = setTimeout(() => finish(null), timeoutMs);
    });
  }

  close() {
    try {
      if (this.#ws) this.#ws.close();
    } catch {
      /* empty */
    }
  }
}

// ---- 页面内共享辅助（String.raw：转义原样发给页面，不用双重反斜杠）-----------------

const JS_HELPERS = String.raw`
const __vis = (el) => {
  if (!el) return false;
  const s = getComputedStyle(el);
  if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
};
const __page = () => document.querySelector('#page') || document.querySelector('#main') || document.body;
const __text = () => (((document.querySelector('#page') || {innerText: ''}).innerText || (document.querySelector('#main') || document.body).innerText) || '').replace(/\u00a0/g, ' ');
const __nav = () => Array.from(document.querySelectorAll('#nav a, nav a')).filter(__vis).map((a) => (a.innerText || '').trim()).filter(Boolean);
const __label = (el) => ((el.innerText || el.value || el.getAttribute('aria-label') || el.placeholder || '') + '').trim();
const __copyBtns = () => Array.from(document.querySelectorAll('#main button, #main [role=button], #main a')).filter(__vis).filter((x) => /^(复制|复制全文)$/.test(__label(x)));
/* 卡片容器 = 最深的一个「只含这一张卡的复制按钮」的祖先；再往上就会把别的卡圈进来 */
const __cardOf = (btn) => {
  let el = btn;
  let best = null;
  for (let i = 0; i < 8 && el.parentElement; i++) {
    const p = el.parentElement;
    if (__copyBtns().filter((b) => p.contains(b)).length > 1) break;
    const t = (p.innerText || '').trim();
    if (t.length > ((btn.innerText || '').trim()).length + 3) best = { text: t, tag: p.tagName.toLowerCase(), cls: (p.className || '').toString().slice(0, 40) };
    el = p;
  }
  return best;
};
const __firstCardText = () => {
  const b = __copyBtns()[0];
  const c = b ? __cardOf(b) : null;
  return c ? c.text : '';
};
const __errors = () => {
  const e = window.__apErrors;
  if (e === undefined || e === null) return { exists: false, len: 0, sample: [] };
  if (Array.isArray(e)) return { exists: true, len: e.length, sample: e.slice(0, 3).map((x) => String(x).slice(0, 200)) };
  return { exists: true, len: 1, sample: [String(e).slice(0, 200)] };
};
const __payloads = () => {
  const btns = Array.from(document.querySelectorAll('#main button, #main [role=button], #main a')).filter(__vis);
  const copyAll = btns.filter((b) => /^复制全部/.test(__label(b))).length;
  const copyBtns = __copyBtns();
  const cards = copyBtns.map((b) => {
    const c = __cardOf(b);
    return { btn: __label(b), cardLen: c ? c.text.length : 0, card: c ? c.text.slice(0, 600) : '' };
  });
  return { copyCount: copyBtns.length, copyAll: copyAll, cards: cards };
};
const __hints = () => {
  const RE = /写|一句/;
  const sel = '#main [role=alert], #main [role=status], #main .alert, #main .hint, #main .error, #main .warn, #main .toast, #toast';
  const nodes = Array.from(document.querySelectorAll(sel)).filter(__vis);
  const hints = nodes.map((n) => (n.innerText || '').trim()).filter((t) => t && RE.test(t));
  return { hints: hints, text: __text() };
};
const __banned = (pattern) => {
  const a = (document.querySelector('#main') || document.body).innerText || '';
  const b = (document.querySelector('#page') || document.body).innerText || '';
  const src = Array.from(new Set([a, b])).join('\n');
  const rx = new RegExp(pattern, 'g');
  const hits = [];
  let m;
  while ((m = rx.exec(src)) && hits.length < 20) {
    hits.push({ word: m[0], ctx: src.slice(Math.max(0, m.index - 24), m.index + m[0].length + 24).replace(/\s+/g, ' ') });
  }
  return { hits: hits, textLen: src.length };
};
const __setInput = (el, value) => {
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  el.focus();
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return el.value;
};
`;

/** 组装一段页面内 IIFE 表达式 */
const inPage = (body) => `(() => {\n${JS_HELPERS}\n${body}\n})()`;

// ---- 页面驱动 -----------------------------------------------------------------

class Page {
  constructor(browser, sessionId, targetId) {
    this.browser = browser;
    this.sessionId = sessionId;
    this.targetId = targetId;
    this.requests = []; // {url, method}
    this.responses = []; // {url, status}
    this.failures = [];
    this.console = [];
    this.exceptions = [];
  }

  send(method, params = {}, timeoutMs = 25000) {
    return this.browser.send(method, params, this.sessionId, timeoutMs);
  }

  async install() {
    this.browser.on('Runtime.consoleAPICalled', (p, sid) => {
      if (sid !== this.sessionId) return;
      const text = (p.args || [])
        .map((a) => {
          if (a.value !== undefined) return typeof a.value === 'string' ? a.value : JSON.stringify(a.value);
          if (a.unserializableValue) return a.unserializableValue;
          return a.description || a.type || '?';
        })
        .join(' ');
      const entry = { type: p.type || 'log', text: clip(text, 400) };
      this.console.push(entry);
      if (p.type === 'error' || p.type === 'assert') jsLog.push({ kind: 'console.error', text: entry.text });
    });
    this.browser.on('Runtime.exceptionThrown', (p, sid) => {
      if (sid !== this.sessionId) return;
      const d = p.exceptionDetails || {};
      const text = `${d.text || 'exception'}${d.exception && d.exception.description ? ' :: ' + String(d.exception.description).split('\n')[0] : ''}`;
      const entry = { text: clip(text, 500), url: d.url || '', line: d.lineNumber };
      this.exceptions.push(entry);
      jsLog.push({ kind: 'exception', text: entry.text });
    });
    this.browser.on('Network.requestWillBeSent', (p, sid) => {
      if (sid !== this.sessionId) return;
      this.requests.push({ url: p.request && p.request.url, method: p.request && p.request.method, type: p.type });
    });
    this.browser.on('Network.responseReceived', (p, sid) => {
      if (sid !== this.sessionId) return;
      this.responses.push({ url: p.response && p.response.url, status: p.response && p.response.status });
    });
    this.browser.on('Network.loadingFailed', (p, sid) => {
      if (sid !== this.sessionId) return;
      this.failures.push({ error: p.errorText, canceled: !!p.canceled });
    });

    await this.send('Page.enable');
    await this.send('Runtime.enable');
    await this.send('Network.enable');
    try {
      await this.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    } catch {
      /* 部分 chrome 版本不支持，忽略 */
    }
  }

  async evalJS(expr, timeoutMs = 20000) {
    const r = await this.send(
      'Runtime.evaluate',
      { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true },
      timeoutMs,
    );
    if (r && r.exceptionDetails) {
      const d = r.exceptionDetails;
      const msg = (d.exception && d.exception.description) || d.text || 'unknown';
      throw new Error(`页面 JS 异常：${String(msg).split('\n')[0]}`);
    }
    return r && r.result ? r.result.value : undefined;
  }

  async navigate(url, { settle = 600, timeout = 25000 } = {}) {
    const wait = this.browser.waitEvent('Page.loadEventFired', timeout, this.sessionId);
    await this.send('Page.navigate', { url });
    const ev = await wait;
    if (!ev) throw new Error(`页面加载超时 ${timeout}ms：${url}`);
    if (settle) await sleep(settle);
  }

  async reload({ settle = 600, timeout = 25000 } = {}) {
    const wait = this.browser.waitEvent('Page.loadEventFired', timeout, this.sessionId);
    await this.send('Page.reload', { ignoreCache: true });
    const ev = await wait;
    if (!ev) throw new Error(`刷新加载超时 ${timeout}ms`);
    if (settle) await sleep(settle);
  }

  /** 只改 hash 的站内跳转（不触发 loadEventFired，所以走 hash + 轮询） */
  async gotoHash(hash, { timeout = 12000 } = {}) {
    const cur = await this.evalJS('location.hash', 3000).catch(() => null);
    if (cur !== hash) {
      await this.evalJS(`(() => { location.hash = ${JSON.stringify(hash)}; return location.hash; })()`, 3000);
    }
    // 记忆页整页就是一个 iframe，自身文本为空，所以「渲染完成」也要认 iframe
    return this.waitFor(inPage(`return location.hash === ${JSON.stringify(hash)} && (__text().length > 0 || !!document.querySelector('#main iframe'));`), {
      timeout,
      label: `跳转到 ${hash}`,
    });
  }

  /** 轮询等条件成立；expr 为页面内表达式，返回真值即成功。
   *  单次评估用短超时（长任务/被抢 CPU 时一帧可能很久），整段等待由 timeout 兜住。 */
  async waitFor(expr, { timeout = 8000, interval = 150, label = '' } = {}) {
    const started = Date.now();
    let lastErr = null;
    for (;;) {
      const remain = timeout - (Date.now() - started);
      if (remain <= 0) break;
      try {
        const v = await this.evalJS(expr, Math.min(2500, Math.max(900, remain)));
        if (v) return v;
      } catch (e) {
        lastErr = e;
      }
      const rest = timeout - (Date.now() - started);
      if (rest <= 0) break;
      await sleep(Math.min(interval, rest));
    }
    const tail = await this.evalJS(inPage('return __text().slice(0, 300);'), 3000).catch(() => '');
    throw new Error(
      `等待超时(${timeout}ms)：${label || clip(expr, 90)}${lastErr ? ' [最后一次错误：' + lastErr.message + ']' : ''}${tail ? ' | 页面文本：' + clip(tail, 300) : ''}`,
    );
  }

  /** 渲染进程存活探测：评估卡住时重试、必要时重载一次页面；仍然无响应就给一句明确诊断 */
  async ensureAlive(budget = 15000) {
    const started = Date.now();
    let last = null;
    let tries = 0;
    while (Date.now() - started < budget) {
      try {
        const v = await this.evalJS('1 + 1', 2000);
        if (v === 2) return true;
      } catch (e) {
        last = e;
      }
      tries += 1;
      try {
        await this.send('Page.stopLoading', {}, 3000);
      } catch {
        /* empty */
      }
      if (tries === 3) {
        log('  [warn] 页面连续无响应，重载一次再继续');
        await this.reload({ settle: 900 }).catch(() => null);
      }
      await sleep(300);
    }
    throw new Error(`页面渲染进程在 ${budget}ms 内无响应（最后一次：${(last && last.message) || '未知'}）`);
  }

  /** 点：优先 querySelector，退化为按可见文本找 button/a/[role=button]/summary/label。
   *  命中后先校验坐标上真的是它（防 smooth-scroll / 遮罩），再发真实鼠标事件；
   *  校验不过才退化到 el.click()。 */
  async click(selectorOrText) {
    const box = await this.evalJS(
      inPage(String.raw`
      const target = ${JSON.stringify(selectorOrText)};
      let el = null;
      try { el = document.querySelector(target); } catch (_) { el = null; }
      if (!el || !__vis(el)) {
        const want = String(target).trim();
        const cands = Array.from(document.querySelectorAll('button, a[href], [role=button], summary, label, input[type=button], input[type=submit]')).filter(__vis);
        el = cands.find((n) => __label(n) === want) || cands.find((n) => want && __label(n).includes(want)) || null;
      }
      if (!el) return { ok: false };
      const desc = el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + '「' + (__label(el) || '').slice(0, 28) + '」';
      try { el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }); } catch (_) { try { el.scrollIntoView({ block: 'center' }); } catch (_) {} }
      if (el.focus) { try { el.focus(); } catch (_) {} }
      const r = el.getBoundingClientRect();
      const x = r.x + r.width / 2;
      const y = r.y + r.height / 2;
      const hit = document.elementFromPoint(x, y);
      return {
        ok: true, x: x, y: y, w: r.width, h: r.height, desc: desc,
        hitOk: !!hit && (hit === el || el.contains(hit)),
        hitDesc: hit ? hit.tagName.toLowerCase() + (hit.id ? '#' + hit.id : '') : null,
      };
    `),
    );
    if (!box || !box.ok) throw new Error(`找不到可点击目标：「${selectorOrText}」`);
    if (box.hitOk && box.w > 0 && box.h > 0 && box.y > -1) {
      const at = { x: Math.round(box.x), y: Math.round(box.y) };
      await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...at });
      await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...at, button: 'left', buttons: 1, clickCount: 1 });
      await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...at, button: 'left', buttons: 0, clickCount: 1 });
      return box.desc;
    }
    // 坐标上不是它（被遮住/滚不到位）→ 直接对元素派发点击事件
    const done = await this.evalJS(
      inPage(String.raw`
      const target = ${JSON.stringify(selectorOrText)};
      let el = null;
      try { el = document.querySelector(target); } catch (_) { el = null; }
      if (!el || !__vis(el)) {
        const want = String(target).trim();
        const cands = Array.from(document.querySelectorAll('button, a[href], [role=button], summary, label')).filter(__vis);
        el = cands.find((n) => __label(n) === want) || cands.find((n) => want && __label(n).includes(want)) || null;
      }
      if (!el) return false;
      el.click();
      return true;
    `),
    );
    if (!done) throw new Error(`找不到可点击目标：「${selectorOrText}」`);
    return box.desc + (box.hitDesc ? `（坐标命中 ${box.hitDesc}，改用元素点击）` : '');
  }

  async setViewport(width, height) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width < 500,
      screenWidth: width,
      screenHeight: height,
    });
  }

  async screenshot(path) {
    const r = await this.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
    writeFileSync(path, Buffer.from(r.data, 'base64'));
    const bytes = statSync(path).size;
    shots.push({ file: path, bytes });
    return bytes;
  }

  async snapshot() {
    return this.evalJS(
      inPage(String.raw`
      const sw = document.querySelector('#modeSwitch');
      return {
        url: location.href,
        hash: location.hash,
        title: document.title,
        nav: __nav(),
        navCount: __nav().length,
        hasModeSwitch: !!sw,
        modeSwitchText: sw ? __label(sw) : null,
        ariaChecked: sw ? sw.getAttribute('aria-checked') : null,
        dataMode: sw ? sw.getAttribute('data-mode') : null,
        text: __text().slice(0, 800),
        textLen: __text().length,
        errors: __errors(),
        details: document.querySelectorAll('#main details').length,
      };
    `),
    );
  }

  netMark() {
    return { req: this.requests.length, res: this.responses.length };
  }

  netSince(mark) {
    return { requests: this.requests.slice(mark.req), responses: this.responses.slice(mark.res) };
  }
}

// ---- 模式判定 / 切换 ------------------------------------------------------------

/**
 * 判当前模式：优先 #modeSwitch 的 data-mode，其次导航项数（契约 §2.2：4 vs 6），最后 aria-checked。
 * 导航项数就是 #2/#13 的判定依据，所以两者冲突时以它为准并记进日志。
 */
async function readMode() {
  const s = await page.snapshot();
  let mode = null;
  let how = '';
  if (s.dataMode === 'simple' || s.dataMode === 'technical') {
    mode = s.dataMode;
    how = '#modeSwitch[data-mode=' + s.dataMode + ']';
  } else if (s.navCount === 8) {
    mode = 'technical';
    how = '导航 8 项';
  } else if (s.navCount === 5) {
    mode = 'simple';
    how = '导航 5 项';
  } else if (s.ariaChecked === 'true') {
    mode = 'technical';
    how = '#modeSwitch[aria-checked=true]';
  } else if (s.ariaChecked === 'false') {
    mode = 'simple';
    how = '#modeSwitch[aria-checked=false]';
  }
  if (mode && s.ariaChecked && (s.navCount === 5 || s.navCount === 8)) {
    const fromAria = s.ariaChecked === 'true' ? 'technical' : 'simple';
    if (fromAria !== mode) log(`  [note] #modeSwitch aria-checked=${s.ariaChecked} 与导航项数 ${s.navCount} 不一致，按导航项数判为 ${mode}`);
  }
  return { mode, how, snapshot: s };
}

/** 保证处于目标模式；需要时点一次开关。返回 {clicks, before} */
async function ensureMode(mode) {
  const before = await readMode();
  if (before.mode === mode) return { clicks: 0, before: before.mode };
  const wantNav = mode === 'technical' ? 8 : 5;
  await page.click('#modeSwitch');
  await page.waitFor(inPage(`return __nav().length === ${wantNav};`), {
    timeout: 8000,
    label: `切到 ${mode} 后导航项应为 ${wantNav} 项（切前 ${before.mode || '未知'} / ${before.how}）`,
  });
  return { clicks: 1, before: before.mode };
}

// ---- 断言 ---------------------------------------------------------------------

async function assert1() {
  // 私有部署：根地址（无 hash）固定落到 #/memory，先进记忆库再回破甲页断言
  await page.navigate(BASE + '/', { settle: 1200 });
  await page.waitFor(inPage("return location.hash === '#/memory' || document.querySelector('#sBuild') ? true : null;"), { timeout: 12000, interval: 150 }).catch(() => null);
  const landedHash = await page.evalJS('location.hash', 4000).catch(() => null);
  const landedEmbed = await page.evalJS(inPage("return !!document.querySelector('#main iframe') ? true : null;"), 4000).catch(() => null);
  await page.gotoHash('#/breach');
  await page.waitFor(inPage("return document.querySelector('#sBuild') ? true : null;"), { timeout: 12000, interval: 120 }).catch(() => null);
  const s = await readMode();
  const snap = s.snapshot;
  const text = snap.text;
  // 破甲方式下拉会换按钮文案（默认 host-patch → 「生成并应用补丁」），且页面文本只取前 800 字符，
  // 所以直接读按钮本身，别靠文本窗口碰运气。
  const btnText = await page.evalJS(inPage("const b=document.querySelector('#sBuild'); return b ? b.textContent.trim() : '';"), 3000).catch(() => '');
  // 破甲方式会换按钮文案（默认补丁层＝「应用补丁」，载荷＝「一键生成」），只要生成按钮在且是可执行动作即可
  const hasOneClick = /生成|应用|入库/.test(String(btnText || "")) || text.includes('一键生成') || text.includes('生成并');
  // 破甲台按方式条件渲染：补丁层不需要模型/任务，所以「模型入口」只在需要载荷的方式下要求存在
  const deliveryMode = await page.evalJS(inPage("const s=document.querySelector('#sDelivery'); return s ? s.value : '';"), 3000).catch(() => '');
  const needsPayload = deliveryMode !== 'host-patch';
  const hasModelField = await page.evalJS(inPage("return !!document.querySelector('#sModelsWrap') || !!document.querySelector('#sTask');"), 3000).catch(() => false);
  const hasModel = needsPayload ? hasModelField : true;
  const wizard = /设置向导|上一步|下一步/.test(text);
  const navOk = snap.navCount === 5;
  const simOk = s.mode === 'simple';
  if (hasOneClick && hasModel && navOk && simOk && !wizard) {
    return ok(`根地址落地 ${landedHash}${landedEmbed ? '（记忆库 iframe 已挂）' : ''} → 破甲页 ${snap.hash || ''}；模式 ${s.mode}（${s.how}）；导航 ${snap.navCount} 项 [${snap.nav.join(' · ')}]；破甲方式=${deliveryMode || '未知'}${needsPayload ? ' + 模型入口' : '（补丁层，无需模型）'}；无设置向导`);
  }
  return bad(
    [
      `含一键生成=${hasOneClick}`,
      `含模型入口=${hasModel}(方式=${deliveryMode || '未知'})`,
      `导航项=${snap.navCount}(期望5)[${snap.nav.join('·')}]`,
      `模式=${s.mode}(${s.how})`,
      `含设置向导=${wizard}`,
      `根地址落地=${landedHash}(iframe=${landedEmbed})`,
      `页面文本前 300：${clip(text, 300)}`,
    ].join('；'),
  );
}

async function assert2() {
  const snap = await page.snapshot();
  const hit = ['记忆分发', '关于'].filter((w) => snap.nav.some((t) => t.includes(w)));
  if (snap.navCount === 5 && hit.length === 0) {
    return ok(`导航 ${snap.navCount} 项 [${snap.nav.join(' · ')}]，无「记忆分发」「关于」`);
  }
  return bad(`导航 ${snap.navCount} 项(期望5) [${snap.nav.join('·')}]；命中禁用导航词：${hit.join('、') || '无'}`);
}

async function assert3() {
  const r = await page.evalJS(
    inPage(String.raw`
    const sel = '#main button, #main input, #main textarea, #main select, #main a[href]';
    const all = Array.from(document.querySelectorAll(sel)).filter(__vis);
    const EXCLUDE = /复制|成功了|被拒绝了|重试|展开/;
    const kept = [];
    const excluded = [];
    for (const el of all) {
      const label = (__label(el) || '').slice(0, 36);
      const entry = { tag: el.tagName.toLowerCase(), id: el.id || null, type: el.getAttribute('type') || null, label: label };
      (EXCLUDE.test(label) ? excluded : kept).push(entry);
    }
    return { total: all.length, kept: kept, excluded: excluded };
  `),
  );
  const list = r.kept.map((e) => `${e.tag}${e.id ? '#' + e.id : ''}${e.type ? '[' + e.type + ']' : ''}「${e.label}」`);
  const detail =
    `可交互元素 ${r.kept.length} 个（上限 24；#main 内命中选择器共 ${r.total} 个，按文案排除 ${r.excluded.length} 个）` +
    (list.length ? `：${list.join(' ｜ ')}` : '') +
    (r.excluded.length ? ` ｜ 已排除：${r.excluded.map((e) => e.label || e.tag).join('、')}` : '');
  return r.kept.length <= 24 ? ok(detail) : bad(detail);
}

async function assert4() {
  const r = await page.evalJS(inPage(`return __banned(${JSON.stringify(BANNED_TEXT.source)});`));
  if (r.hits.length === 0) return ok(`#main/#page 文本 ${r.textLen} 字符，无 §2.6 禁用词`);
  const shown = r.hits.slice(0, 8).map((h) => `「${h.word}」←…${h.ctx}…`).join(' ｜ ');
  return bad(`命中 ${r.hits.length} 处禁用词：${shown}`);
}

async function assert5() {
  // 默认破甲方式是「宿主注入 · 补丁层」，操作台此时显示补丁清单、不出载荷卡；
  // 本条要测的是载荷产出，先把方式切到「载荷破甲」再点生成。
  await page.evalJS(inPage("const s=document.querySelector('#sDelivery'); if (s) { s.value='payload'; s.dispatchEvent(new Event('change')); } return true;")).catch(() => null);
  await page.waitFor(inPage("return document.querySelector('#sBuild') ? true : null;"), { timeout: 6000, interval: 120 }).catch(() => null);
  const filled = await page.evalJS(
    inPage(String.raw`
    const tas = [document.querySelector('#sTask')].filter(Boolean).concat(Array.from(document.querySelectorAll('#main textarea, textarea')).filter(__vis).filter((el) => el.id !== 'sTask'));
    if (!tas.length) return { ok: false, reason: '没有可见的 textarea' };
    const v = __setInput(tas[0], ${JSON.stringify(TASK_TEXT)});
    return { ok: true, value: v, placeholder: tas[0].placeholder || '' };
  `),
  );
  if (!filled || !filled.ok) return bad(`填不进任务：${(filled && filled.reason) || '未知'}`);

  // 等宿主状态加载完再点，避免点击瞬间页面被宿主状态回填重绘
  await page.waitFor(inPage('return (!S.host.loading && S.host.tried) ? true : null;'), { timeout: 12000, interval: 150 }).catch(() => null);
  const mark = page.netMark();
  await page.click('#sBuild');
  let last = null;
  try {
    last = await page.waitFor(inPage('const r = __payloads(); return r.copyCount >= 1 && r.cards.some((c) => c.cardLen > 20) ? r : null;'), {
      timeout: 8000,
      interval: 200,
      label: '点「一键生成」后 8s 内出现 ≥1 张载荷卡（含「复制」且文本>20）',
    });
  } catch (e) {
    const snap = await page.snapshot();
    const cur = await page.evalJS(inPage('return __payloads();')).catch(() => null);
    return bad(`${e.message} ｜ 卡片快照：${clip(JSON.stringify(cur), 240)} ｜ 页面文本：${clip(snap.text, 200)}`);
  }
  const net = page.netSince(mark);
  const buildReq = net.requests.filter((q) => /\/api\/breach\/build/.test(q.url || '')).length;
  const goodCards = last.cards.filter((c) => c.cardLen > 20).length;
  ctx.payloads = last.copyCount;
  return ok(
    `载荷卡 ${last.copyCount} 张（文本>20 的 ${goodCards} 张；「复制全部」按钮 ${last.copyAll} 个）；/api/breach/build 请求 ${buildReq} 次；首卡文本：${clip(last.cards[0] && last.cards[0].card, 90)}`,
  );
}

async function assert6() {
  if (!ctx.payloads) return skip('前置 #5 未产出载荷卡，无法比较「载荷数不增加」——本条无法判定（不给假 PASS）');
  const before = await page.evalJS(inPage('return __payloads();'));
  const beforeText = await page.evalJS(inPage('return __text();'));

  const cleared = await page.evalJS(
    inPage(String.raw`
    const ta = (document.querySelector('#sTask') || Array.from(document.querySelectorAll('#main textarea, textarea')).filter(__vis)[0]);
    if (!ta) return { ok: false };
    return { ok: true, value: __setInput(ta, '') };
  `),
  );
  if (!cleared || !cleared.ok) return bad('找不到 textarea，无法清空任务');
  if (cleared.value !== '') return bad(`清空后 textarea 仍有内容：「${clip(cleared.value, 60)}」`);

  const mark = page.netMark();
  await page.click('#sBuild');

  let feedback = null;
  try {
    feedback = await page.waitFor(
      inPage(String.raw`
      const ta = document.querySelector('#sTask') || Array.from(document.querySelectorAll('textarea')).filter(__vis)[0];
      if (!ta) return null;
      const active = document.activeElement === ta;
      const marked = ta.classList.contains('shake') || ta.getAttribute('aria-invalid') === 'true';
      return (active || marked) ? { source: active ? '光标回到输入框' : '输入框抖动标记' } : null;
    `),
      { timeout: 4000, interval: 120, label: '空任务点生成后把光标放回输入框（或给出抖动标记）' },
    );
  } catch (e) {
    const net = page.netSince(mark);
    return bad(`${e.message} ｜ 期间请求：${clip(net.requests.map((q) => q.method + ' ' + q.url).join(', '), 200)}`);
  }

  const after = await page.evalJS(inPage('return __payloads();'));
  const net = page.netSince(mark);
  const build = net.requests.filter((q) => /\/api\/breach\/build/.test(q.url || ''));
  const s5xx = net.responses.filter((r) => Number(r.status) >= 500);
  const problems = [];
  if (!feedback) problems.push('点击后既没有把光标放回输入框，也没有抖动标记');
  if (after.copyCount > before.copyCount) problems.push(`载荷数增加（${before.copyCount} → ${after.copyCount}）`);
  if (build.length) problems.push(`发出了 /api/breach/build 请求 ${build.length} 次`);
  if (s5xx.length) problems.push(`出现 5xx：${s5xx.map((r) => r.status + ' ' + r.url).join(', ')}`);
  const detail = `反馈（${(feedback && feedback.source) || '?'}）；载荷数 ${before.copyCount} → ${after.copyCount}；/api/breach/build 请求 ${build.length} 次；5xx ${s5xx.length} 个`;
  return problems.length === 0 ? ok(detail) : bad(`${problems.join('；')} ｜ ${detail}`);
}

async function assert7() {
  if (!ctx.payloads) return skip('前置 #5 未产出载荷卡，没有可点的「复制」按钮');

  // 1) 先把第一张卡「展开看全文」（契约 §2.3：每条卡 = 序号+名称+复制+展开看全文）
  const expand = await page.evalJS(
    inPage(String.raw`
    // 只在第一张载荷卡里找：页面上还有「法律声明全文」等别的 details，全局匹配会点错
    const card = document.querySelector('.payload');
    const btns = card ? Array.from(card.querySelectorAll('button, summary')).filter(__vis) : [];
    const copy = card ? Array.from(card.querySelectorAll('button')).filter((b) => /复制/.test(__label(b)))[0] : null;
    if (!copy) return { ok: false, reason: '找不到第一张卡的「复制」按钮' };
    const before = __firstCardText();
    const ex = (card.querySelector('summary')) || btns.filter((x) => /展开|全文/.test(__label(x)))[0] || null;
    if (ex) { try { ex.scrollIntoView({ block: 'center' }); } catch (_) {} ; try { ex.click(); } catch (_) {} }
    return { ok: true, hadExpand: !!ex, beforeLen: (before || '').length };
  `),
  );
  if (!expand || !expand.ok) return bad(`点不了「复制」：${(expand && expand.reason) || '未知'}`);

  // 点完 summary 要等展开真的生效（details.open=true），否则 innerText 还是折叠态
  if (expand.hadExpand) {
    await page
      .waitFor(
        inPage(String.raw`
        const d = document.querySelector('.payload details');
        return d && d.open ? true : null;
      `),
        { timeout: 3000, interval: 100 },
      )
      .catch(() => null);
  }

  let cardLen = expand.beforeLen;
  if (expand.hadExpand) {
    cardLen = await page
      .waitFor(inPage(`const n = __firstCardText().length; return n > ${expand.beforeLen} ? n : null;`), {
        timeout: 4000,
        interval: 150,
        label: '点「展开看全文」后卡片全文变长',
      })
      .catch(() => expand.beforeLen);
  }

  // 2) 点「复制」，读剪贴板
  const copied = await page.evalJS(
    inPage(String.raw`
    const b = __copyBtns()[0];
    if (!b) return { ok: false, reason: '找不到「复制」按钮' };
    try { b.scrollIntoView({ block: 'center' }); } catch (_) {}
    if (b.focus) { try { b.focus(); } catch (_) {} }
    b.click();
    const attrs = {};
    for (const a of Array.from(b.attributes)) if (/^(data-|aria-label$|title$)/.test(a.name)) attrs[a.name] = String(a.value).slice(0, 4000);
    let store = null;
    try { store = typeof window.__copyStore === 'undefined' ? null : JSON.stringify(window.__copyStore).slice(0, 4000); } catch (_) { store = null; }
    return { ok: true, attrs: attrs, store: store };
  `),
  );
  if (!copied || !copied.ok) return bad(`点不了「复制」：${(copied && copied.reason) || '未知'}`);

  await sleep(250); // 让剪贴板写入 / 前端状态更新落地

  const clipRes = await page
    .evalJS(
      String.raw`(async () => {
        if (!navigator.clipboard || !navigator.clipboard.readText) return { ok: false, why: '没有 navigator.clipboard.readText' };
        try { const t = await navigator.clipboard.readText(); return { ok: true, text: t }; }
        catch (e) { return { ok: false, why: ((e && e.name) || 'Error') + ': ' + ((e && e.message) || '') }; }
      })()`,
    )
    .catch((e) => ({ ok: false, why: e.message }));

  const norm = (t) => String(t || '').replace(/\s+/g, ' ').trim();
  const cardNorm = norm(await page.evalJS(inPage(String.raw`
    const card = document.querySelector('.payload');
    if (!card) return '';
    const pres = Array.from(card.querySelectorAll('pre')).map((p) => p.textContent).join('\n');
    return (card.textContent || '') + '\n' + pres;
  `)));

  if (clipRes && clipRes.ok) {
    const t = norm(clipRes.text);
    if (t.length <= 20) return bad(`剪贴板只有 ${t.length} 字符（要求 >20）：「${clip(t, 120)}」`);
    if (cardNorm.includes(t)) return ok(`展开后卡片全文 ${cardNorm.length} 字符；剪贴板 ${t.length} 字符，内容与全文一致：「${clip(t, 90)}」`);
    // 卡片文本可能被折叠/换行拆开，退一步在整个 #main 文本里找
    const inPageText = norm(await page.evalJS(inPage('return __text();')));
    if (inPageText.includes(t)) return ok(`剪贴板 ${t.length} 字符，内容出现在页面文本中（卡片全文 ${cardNorm.length} 字符，含展开动作=${expand.hadExpand}）：「${clip(t, 90)}」`);
    return bad(`剪贴板与全文不一致：剪贴板「${clip(t, 90)}」 vs 卡片「${clip(cardNorm, 140)}」`);
  }

  const dataKeys = Object.keys(copied.attrs || {}).filter((k) => /^data-/.test(k) && String(copied.attrs[k]).length > 20);
  if (dataKeys.length) {
    const k = dataKeys[0];
    const v = norm(copied.attrs[k]);
    return cardNorm.includes(v)
      ? ok(`剪贴板不可读（${clip(clipRes && clipRes.why, 120)}），退化到按钮属性 ${k}：${v.length} 字符，含于卡片全文`)
      : bad(`剪贴板不可读（${clip(clipRes && clipRes.why, 120)}）；按钮属性 ${k} 不在卡片全文里：「${clip(cardNorm, 140)}」`);
  }

  if (copied.store) {
    const v = norm(copied.store);
    return v.length > 20
      ? ok(`剪贴板不可读（${clip(clipRes && clipRes.why, 120)}），退化到 window.__copyStore：${v.length} 字符`)
      : bad(`window.__copyStore 内容过短：${clip(v, 120)}`);
  }

  return skip(
    `剪贴板读取不可用（${clip(clipRes && clipRes.why, 140)}），且该卡片无 data-* 载荷属性、无 window.__copyStore，无法比对复制内容与全文——不给假 PASS`,
  );
}

/** 给第一个可点的（未 disabled）匹配按钮打临时 id，用真实鼠标点它，再撤掉 id */
async function clickEnabled(label) {
  const tagged = await page.evalJS(
    inPage(String.raw`
    const stale = document.getElementById('__ux2_tap');
    if (stale) stale.removeAttribute('id');
    const want = ${JSON.stringify(label)};
    const btns = Array.from(document.querySelectorAll('#main button, #main [role=button], #main a'))
      .filter(__vis)
      .filter((b) => !b.disabled && b.getAttribute('aria-disabled') !== 'true');
    const b = btns.filter((x) => __label(x) === want)[0] || btns.filter((x) => __label(x).includes(want))[0] || null;
    if (!b) return null;
    b.id = '__ux2_tap';
    return { label: __label(b), key: b.getAttribute('data-simple-key') || b.getAttribute('data-key') || null };
  `),
  );
  if (!tagged) return null;
  // The click can legitimately fail: the page re-renders right after the first record
  // ("已记录" toast -> renderPage rebuilds the cards), which drops the temp id between
  // tagging and clicking. Treat that as "not clickable this round" and let the caller retry.
  let clicked = false;
  try {
    clicked = await page.click('#__ux2_tap');
  } catch {
    clicked = false;
  }
  await page.evalJS(`(() => { const el = document.getElementById('__ux2_tap'); if (el) el.removeAttribute('id'); return 0; })()`).catch(() => 0);
  return { ...tagged, clicked };
}

/** 点一次并等 attempts 恰好 +1；被 busy 吞掉的点击会重试，但每轮都留证 */
async function recordAttempt(label) {
  const log_ = [];
  for (let round = 1; round <= 3; round++) {
    const before = await attemptCount();
    const mark = page.netMark();
    const target = await clickEnabled(label);
    if (!target) {
      log_.push(`第${round}轮：找不到可点的「${label}」`);
      await sleep(300);
      continue;
    }
    if (!target.clicked) {
      log_.push(`第${round}轮：点「${target.label}」时被重渲染打断（临时 id 失效），重试`);
      await sleep(350);
      continue;
    }
    let after = before;
    const started = Date.now();
    while (Date.now() - started < 3000) {
      after = await attemptCount();
      if (after !== null && after > before) break;
      await sleep(200);
    }
    const posts = page.netSince(mark).requests.filter((q) => /\/api\/breach\/attempt/.test(q.url || '')).length;
    const delta = after - before;
    log_.push(`第${round}轮：点「${target.label}」(key=${target.key || '-'}) → attempts ${before}→${after} (Δ${delta})，POST ${posts} 次`);
    if (delta === 1) return { ok: true, delta: delta, rounds: round, log: log_.join('；'), before, after };
    if (delta > 1) return { ok: false, delta: delta, rounds: round, log: log_.join('；'), before, after, why: `一次点击记录了 ${delta} 次` };
    // 前端有 attemptBusy 门：等它释放再重试
    await page.waitFor(inPage('return /已记录|已经记录/.test(__text()) ? true : null;'), { timeout: 1500, interval: 120 }).catch(() => null);
    await sleep(250);
  }
  const final = await attemptCount();
  return { ok: false, delta: 0, rounds: 3, log: log_.join('；'), before: null, after: final, why: '3 次点击都没有被记录' };
}

async function assert8() {
  const base = await attemptCount();
  if (base === null) return bad('/api/state 里没有 state.attempts 数组，读不到基线与增量');
  if (!ctx.payloads) return skip(`前置 #5 未产出载荷卡，没有「这次成功了 / 被拒绝了」可点；当前 attempts=${base}`);

  const first = await recordAttempt('这次成功了');
  if (!first.ok) return bad(`「这次成功了」${first.why}：${first.log}`);
  const second = await recordAttempt('被拒绝了');
  if (!second.ok) return bad(`「被拒绝了」${second.why}：${second.log}`);

  return ok(
    `attempts ${base} → ${first.after}（这次成功了 +1，点 ${first.rounds} 次）→ ${second.after}（被拒绝了 +1，点 ${second.rounds} 次）`,
  );
}

async function assert9() {
  await page.gotoHash('#/equip');
  await page.waitFor(inPage('return __text().length > 20 || document.querySelectorAll(\'#main button\').length > 0;'), {
    timeout: 8000,
    label: '装备页渲染',
  });
  const r = await page.evalJS(
    inPage(String.raw`
    const btns = Array.from(document.querySelectorAll('#main button, #main [role=button]')).filter(__vis);
    const primary = btns.filter((b) => b.classList.contains('primary'));
    const oneKey = btns.filter((b) => /一键/.test(__label(b)));
    return {
      primaryCount: primary.length,
      oneKeyCount: oneKey.length,
      primaryLabels: primary.map((b) => __label(b)).slice(0, 6),
      oneKeyLabels: oneKey.map((b) => __label(b)).slice(0, 6),
      allLabels: btns.map((b) => __label(b)).filter(Boolean).slice(0, 12),
    };
  `),
  );
  const count = r.primaryCount || r.oneKeyCount;
  const labels = r.primaryCount ? r.primaryLabels : r.oneKeyLabels;
  if (count !== 1) {
    return bad(`主按钮 ${count} 个（期望恰好 1 个；button.primary ${r.primaryCount} 个、含「一键」${r.oneKeyCount} 个）；页面按钮：${r.allLabels.join('、')}`);
  }
  await page.click(labels[0]);
  try {
    await page.waitFor(inPage('return /已装备/.test(__text()) ? true : null;'), { timeout: 8000, interval: 200, label: '点主按钮后出现「已装备」' });
  } catch (e) {
    const snap = await page.snapshot();
    return bad(`${e.message} ｜ 页面文本前 200：${clip(snap.text, 200)}`);
  }
  const snap = await page.snapshot();
  const m = snap.text.match(/已装备[^\n]{0,60}/);
  return ok(`主按钮 1 个「${labels[0]}」；点后出现：${m ? m[0] : '已装备'}`);
}

﻿async function assert10() {
  await page.gotoHash('#/memory');
  await page.waitFor(inPage("return document.querySelector('#main iframe') ? true : null;"), {
    timeout: 12000,
    label: '记忆页出现内嵌面板 iframe',
  });
  const r = await page.evalJS(
    inPage(String.raw`
    const f = document.querySelector('#main iframe');
    const secs = document.querySelectorAll('#main > section').length;
    const text = __text();
    let inner = { ok: false };
    try {
      const d = f && f.contentDocument;
      if (d) inner = { ok: true, title: d.title || '', len: (d.body ? d.body.innerText.length : 0) };
    } catch (e) { inner = { ok: false, why: String(e && e.message) }; }
    return {
      hasFrame: !!f,
      src: f ? f.getAttribute('src') : null,
      width: f ? f.offsetWidth : 0,
      height: f ? f.offsetHeight : 0,
      sections: secs,
      hasSearch: /搜什么|搜索记忆/.test(text),
      inner: inner,
    };
  `),
  );
  const problems = [];
  if (!r.hasFrame) problems.push('没有 iframe');
  if (r.src !== '/embed/memory/') problems.push('iframe src 不是 /embed/memory/（实际 ' + r.src + '）');
  if (r.width < 300 || r.height < 300) problems.push('iframe 尺寸过小 ' + r.width + 'x' + r.height);
  if (r.sections > 1) problems.push('页面上还有 ' + r.sections + ' 个 section（应只剩内嵌面板）');
  if (r.hasSearch) problems.push('页面仍有自带搜索框（内容应只保留内嵌面板）');
  const detail = 'iframe src=' + r.src + ' · ' + r.width + 'x' + r.height + ' · 页面 section ' + r.sections + ' 个 · 面板内：' + (r.inner.ok ? r.inner.title + ' / ' + r.inner.len + ' 字符' : '读不到（' + (r.inner.why || '?') + '）');
  return problems.length ? bad(problems.join('；') + ' ｜ ' + detail) : ok(detail);
}
async function assert11() {
  await page.gotoHash('#/settings');
  await page.waitFor(inPage('return __text().length > 20 || document.querySelectorAll(\'#main input\').length > 0;'), {
    timeout: 8000,
    label: '设置页渲染',
  });
  const r = await page.evalJS(
    inPage(String.raw`
    const text = __text();
    const words = ${JSON.stringify(BANNED_SETTINGS_WORDS)};
    const fields = Array.from(document.querySelectorAll('#main input, #main textarea, #main select')).map((el) => {
      const lab = el.closest('label') ? (el.closest('label').innerText || '') : '';
      return [el.getAttribute('name') || '', el.id || '', el.placeholder || '', el.getAttribute('aria-label') || '', String(el.value || ''), lab].join(' | ');
    });
    const wordHits = words.filter((w) => text.toLowerCase().indexOf(w.toLowerCase()) >= 0);
    const pathContexts = [];
    let i = -1;
    while ((i = text.indexOf('路径', i + 1)) >= 0 && pathContexts.length < 6) pathContexts.push(text.slice(Math.max(0, i - 26), i + 4).replace(/\s+/g, ' '));
    const absPath = text.match(/[A-Za-z]:[\\/][^\s]{0,40}|\/home\/[^\s]{0,30}|\/root\/[^\s]{0,30}|\\\\[^\s]{0,40}/g) || [];
    const fieldHits = words.concat(['路径']).filter((w) => fields.some((f) => f.toLowerCase().indexOf(w.toLowerCase()) >= 0));
    return {
      wordHits: wordHits,
      pathCount: pathContexts.length,
      pathContexts: pathContexts,
      absPath: absPath.slice(0, 5),
      fieldHits: fieldHits,
      fields: fields.slice(0, 12),
      text: text.slice(0, 400),
    };
  `),
  );

  const hard = [];
  if (r.wordHits.length) hard.push(`禁用词：${r.wordHits.join('、')}`);
  if (r.fieldHits.length) hard.push(`输入字段/标签里出现：${r.fieldHits.join('、')}`);
  if (r.absPath.length) hard.push(`出现绝对路径字面量：${r.absPath.join(' , ')}`);
  if (hard.length) {
    return bad(`${hard.join('；')} ｜ 字段：${clip(r.fields.join(' ;; '), 220)} ｜ 文本：${clip(r.text, 200)}`);
  }
  const note = r.pathCount
    ? `「路径」出现 ${r.pathCount} 次但均不在字段/标签内（说明文案，按 §2.4 宽容处理），实际原文：${r.pathContexts.map((c) => '…' + c + '…').join(' ｜ ')}`
    : '无路径/令牌字段与文案';
  return ok(note);
}

async function assert12() {
  await page.gotoHash('#/breach');
  const before = await readMode();
  if (before.mode !== 'simple') return bad(`切换前不在 simple（当前 ${before.mode || '未知'}，依据 ${before.how || '无'}）`);
  const mark = page.netMark();
  const clicked = await page.click('#modeSwitch');
  try {
    await page.waitFor(inPage('return __nav().length === 8 ? true : null;'), {
      timeout: 8000,
      interval: 150,
      label: '点一次 #modeSwitch 后导航变 9 项',
    });
  } catch (e) {
    const diag = await page.evalJS(
      inPage(String.raw`
      const sw = document.querySelector('#modeSwitch');
      const nav = document.querySelector('#nav');
      return {
        ariaChecked: sw ? sw.getAttribute('aria-checked') : null,
        navMode: nav ? (nav.dataset.mode || null) : null,
        navCount: __nav().length,
      };
    `),
    );
    const net = page.netSince(mark);
    const posted = net.requests.filter((q) => /\/api\/settings/.test(q.url || '')).length;
    return bad(
      `点了一次「${clicked}」但导航没变 8 项：aria-checked=${diag.ariaChecked}、#nav[data-mode]=${diag.navMode}、导航 ${diag.navCount} 项；` +
        `期间 POST /api/settings ${posted} 次（若为 0 说明点击没有到达切换逻辑）`,
    );
  }

  const reach = {};
  // 记忆分发已从导航降级（宿主能运行时自助检索），#/assign 仍要能直达；#/inject 是骨架新增的注入区
  for (const hash of ['#/inject', '#/assign', '#/about', '#/breach']) {
    await page.gotoHash(hash);
    reach[hash] = await page.evalJS(inPage('return { hash: location.hash, len: __text().length, head: __text().slice(0, 120) };'));
  }
  const assignOk = reach['#/assign'].len > 40 && !/没有这个页面|找不到|404/.test(reach['#/assign'].head);
  const aboutOk = reach['#/about'].len > 40 && !/没有这个页面|找不到|404/.test(reach['#/about'].head);
  const injectOk = reach['#/inject'].len > 200 && !/没有这个页面|找不到|404/.test(reach['#/inject'].head);

  const after = await page.snapshot();
  // 宿主切换器是唯一的宿主入口：必须存在且正好三项
  const hostOpts = await page.evalJS(inPage("const s=document.querySelector('#hostSwitch'); return s ? [...s.options].map((o) => o.value) : [];")).catch(() => []);
  const problems = [];
  if (!(hostOpts.length === 3 && hostOpts.join(',') === 'dsh,mengbot,autokill')) {
    problems.push(`宿主切换器选项不对（${hostOpts.join(',') || '未找到'}）`);
  }
  if (after.navCount !== 8) problems.push(`导航 ${after.navCount} 项(期望8)[${after.nav.join('·')}]`);
  if (!injectOk) problems.push(`#/inject 内容不足（${reach['#/inject'].len} 字符）：「${clip(reach['#/inject'].head, 80)}」`);
  if (!assignOk) problems.push(`#/assign 内容不足（${reach['#/assign'].len} 字符）：「${clip(reach['#/assign'].head, 80)}」`);
  if (!aboutOk) problems.push(`#/about 内容不足（${reach['#/about'].len} 字符）：「${clip(reach['#/about'].head, 80)}」`);
  if (after.errors.exists && after.errors.len > 0) problems.push(`window.__apErrors 有 ${after.errors.len} 条：${clip(after.errors.sample.join(' | '), 200)}`);

  log(`  [info] 技术模式破甲页折叠组 details=${after.details} 个（契约 §2.5 期望 5 组；计数仅供参考，#12 判据是导航/可达/__apErrors）`);
  const detail = `点一次「${clicked}」；导航 ${after.navCount} 项 [${after.nav.join(' · ')}]；宿主切换器 ${hostOpts.join('/')}；#/inject ${reach['#/inject'].len} 字符、#/assign ${reach['#/assign'].len} 字符、#/about ${reach['#/about'].len} 字符；__apErrors=${after.errors.exists ? after.errors.len : '未定义(=0)'}；折叠组 details=${after.details}`;
  return problems.length ? bad(`${problems.join('；')} ｜ ${detail}`) : ok(detail);
}

async function assert13() {
  const before = await readMode();
  if (before.mode !== 'technical') return bad(`切回前不在 technical（当前 ${before.mode || '未知'}，依据 ${before.how || '无'}）`);
  const clicked = await page.click('#modeSwitch');
  await page.waitFor(inPage('return __nav().length === 5 ? true : null;'), {
    timeout: 8000,
    interval: 150,
    label: '再点一次 #modeSwitch 后导航回 6 项',
  });
  await page.gotoHash('#/breach');
  const snap = await page.snapshot();
  const banned = await page.evalJS(inPage(`return __banned(${JSON.stringify(BANNED_TEXT.source)});`));
  const problems = [];
  if (snap.navCount !== 5) problems.push(`导航 ${snap.navCount} 项(期望5)[${snap.nav.join('·')}]`);
  if (banned.hits.length) problems.push(`残留技术字段 ${banned.hits.length} 处`);
  const detail =
    `点一次「${clicked}」；导航 ${snap.navCount} 项 [${snap.nav.join(' · ')}]；禁用词命中 ${banned.hits.length} 处` +
    (banned.hits.length ? `：${banned.hits.slice(0, 5).map((h) => '「' + h.word + '」←…' + h.ctx + '…').join(' ｜ ')}` : '');
  return problems.length ? bad(detail) : ok(detail);
}

async function assert14() {
  await ensureMode('technical');
  await page.reload({ settle: 900 });
  const tech = await page.snapshot();

  await ensureMode('simple');
  await page.reload({ settle: 900 });
  const simple = await page.snapshot();

  const problems = [];
  if (tech.navCount !== 8) problems.push(`technical 刷新后导航 ${tech.navCount} 项(期望8)[${tech.nav.join('·')}]`);
  if (simple.navCount !== 5) problems.push(`simple 刷新后导航 ${simple.navCount} 项(期望5)[${simple.nav.join('·')}]`);
  const detail = `technical reload → ${tech.navCount} 项 [${tech.nav.join(' · ')}]；simple reload → ${simple.navCount} 项 [${simple.nav.join(' · ')}]`;
  return problems.length ? bad(`${problems.join('；')} ｜ ${detail}`) : ok(detail);
}

async function assert15() {
  mkdirSync(SHOT_DIR, { recursive: true });
  await page.ensureAlive();
  const rows = [];
  const problems = [];
  for (const mode of ['simple', 'technical']) {
    await ensureMode(mode);
    await page.gotoHash('#/breach');
    for (const [w, h] of WIDTHS) {
      await page.setViewport(w, h);
      // 轮询等布局稳定（连续两帧 scrollWidth 一致），不裸 sleep 赌时序
      let prev = -1;
      let stable = 0;
      for (let i = 0; i < 24 && stable < 2; i++) {
        const v = await page.evalJS(inPage('return document.documentElement.scrollWidth;')).catch(() => -2);
        if (v === prev) stable += 1;
        else {
          prev = v;
          stable = 0;
        }
        await sleep(80);
      }
      const m = await page.evalJS(
        inPage('const de = document.documentElement; return { scrollWidth: de.scrollWidth, innerWidth: window.innerWidth, clientWidth: de.clientWidth, errors: __errors() };'),
      );
      if (mode === 'technical' && w === 1280) {
        await page.evalJS('(() => { window.scrollTo(0, 0); return 0; })()');
        await sleep(150);
      }
      const bytes = await page.screenshot(join(SHOT_DIR, `${mode}-${w}.png`));
      let topNote = '';
      if (mode === 'technical' && w === 1280) {
        const topBytes = await page.screenshot(join(SHOT_DIR, 'technical-breach-top.png'));
        topNote = ` / 首屏 ${topBytes}B`;
      }
      rows.push(`${mode}@${w}×${h}: scrollWidth=${m.scrollWidth} innerWidth=${m.innerWidth} 截图 ${bytes}B${topNote}`);
      if (m.scrollWidth > m.innerWidth + 1) problems.push(`${mode}@${w} 横向溢出：scrollWidth=${m.scrollWidth} > innerWidth=${m.innerWidth}`);
      if (m.errors.exists && m.errors.len > 0) problems.push(`${mode}@${w} window.__apErrors=${m.errors.len}：${clip(m.errors.sample.join(' | '), 160)}`);
    }
  }
  await page.setViewport(1280, 900);
  const detail = rows.join(' ｜ ');
  return problems.length ? bad(`${problems.join('；')} ｜ ${detail}`) : ok(detail);
}

// ---- Chrome 生命周期 -----------------------------------------------------------

function findChrome() {
  for (const p of CHROME_CANDIDATES) if (p && existsSync(p)) return p;
  return null;
}

function portFree(port) {
  return new Promise((resolveP) => {
    const sock = netConnect({ host: '127.0.0.1', port });
    const done = (free) => {
      try {
        sock.destroy();
      } catch {
        /* empty */
      }
      resolveP(free);
    };
    sock.setTimeout(800);
    sock.on('connect', () => done(false));
    sock.on('timeout', () => done(true));
    sock.on('error', () => done(true));
  });
}

async function launchChrome(chromePath) {
  if (!(await portFree(CDP_PORT))) {
    throw new Error(`调试端口 ${CDP_PORT} 已被占用（可能是上次残留的 chrome）——先结束它，或设 PURGE_CDP_PORT 换端口`);
  }
  const profile = mkdtempSync(join(tmpdir(), 'ap-ux2-chrome-'));
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${profile}`,
    '--window-size=1280,900',
  ];
  const proc = spawn(chromePath, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const stderr = [];
  proc.stderr.on('data', (b) => {
    const t = b.toString('utf8').trim();
    if (t) {
      stderr.push(t);
      if (stderr.length > 40) stderr.shift();
    }
  });
  proc.stdout.on('data', () => {});

  const deadline = Date.now() + 20000;
  let wsUrl = null;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`, { signal: AbortSignal.timeout(1200) });
      if (r.ok) {
        const j = await r.json();
        if (j && j.webSocketDebuggerUrl) {
          wsUrl = j.webSocketDebuggerUrl;
          break;
        }
      }
    } catch {
      /* 还没起来 */
    }
    if (proc.exitCode !== null) break;
    await sleep(250);
  }
  if (!wsUrl) {
    killChrome(proc);
    rmProfile(profile);
    const tail = stderr.length ? ` | chrome stderr 尾部：${clip(stderr.slice(-3).join(' / '), 300)}` : '';
    throw new Error(`Chrome 调试端口 ${CDP_PORT} 20s 内没起来（chrome 退出码 ${proc.exitCode}）${tail}`);
  }
  return { proc, profile, wsUrl, stderr };
}

function killChrome(proc) {
  if (!proc) return;
  try {
    execFileSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
  } catch {
    /* 已经退出 */
  }
  try {
    proc.kill();
  } catch {
    /* empty */
  }
}

function rmProfile(dir) {
  if (!dir) return;
  for (let i = 0; i < 12; i++) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* chrome 还占着文件 */
    }
    if (!existsSync(dir)) return;
    sleepSync(300);
  }
}

// ---- 前置：HTTP ---------------------------------------------------------------

let stateModels = [];
let stateTechniques = [];

async function preflightHttp() {
  let ping;
  try {
    ping = await api('/api/ping', { timeout: 4000 });
  } catch (e) {
    return { ok: false, why: `服务 ${BASE} 不可达（${(e && e.message) || e}）——先起被测实例：$env:PURGE_WEB_PORT=8795; node web/server.mjs` };
  }
  if (!ping.ok) return { ok: false, why: `服务 ${BASE} 的 /api/ping 返回 HTTP ${ping.status}` };
  log(`  /api/ping → 200 version=${(ping.data && ping.data.version) || '?'}`);

  let sign;
  try {
    sign = await api('/api/agreement', { method: 'POST', body: JSON.stringify({ accepted: true, signer: 'ux2-probe' }) });
  } catch (e) {
    return { ok: false, why: `POST /api/agreement 失败：${e.message}` };
  }
  if (sign.status !== 200 && sign.status !== 409) {
    return { ok: false, why: `POST /api/agreement 返回 HTTP ${sign.status}：${clip(sign.text, 160)}` };
  }
  log(`  POST /api/agreement {accepted:true} → ${sign.status}`);

  let st;
  try {
    st = await api('/api/state');
  } catch (e) {
    return { ok: false, why: `GET /api/state 失败：${e.message}` };
  }
  if (st.status !== 200) return { ok: false, why: `GET /api/state 返回 HTTP ${st.status}（签署未生效？）` };

  stateModels = (st.data && st.data.models) || [];
  stateTechniques = (st.data && st.data.techniques) || [];
  if (!stateModels.length || !stateTechniques.length) {
    return { ok: false, why: `/api/state 里 models=${stateModels.length} / techniques=${stateTechniques.length}，契约要求都存在` };
  }
  log(`  /api/state → models ${stateModels.length} / techniques ${stateTechniques.length} / layers ${((st.data && st.data.layers) || []).length}`);
  const uiMode = st.data && st.data.state && st.data.state.settings && st.data.state.settings.uiMode;
  log(`  state.settings.uiMode = ${uiMode === undefined ? '未定义（后端 §1.1 待落地）' : uiMode}`);

  try {
    const rd = await api('/api/readiness', { timeout: 5000 });
    log(`  /api/readiness → HTTP ${rd.status}${rd.data && rd.data.level ? ' level=' + rd.data.level : ''}`);
  } catch (e) {
    log(`  /api/readiness → 请求失败（${e.message}）`);
  }
  return { ok: true };
}

// ---- 主流程 -------------------------------------------------------------------

let page = null;
let browser = null;
let chrome = null;
let exitCode = EXIT.ok;

const summary = () => ({
  pass: results.filter((r) => r.status === 'PASS').length,
  fail: results.filter((r) => r.status === 'FAIL').length,
  skip: results.filter((r) => r.status === 'SKIP').length,
  total: results.length,
});

function writeResults(header, diag) {
  const sm = summary();
  const out = [];
  out.push('autokill-purge · 双层体验浏览器端验收（test/ux2layer-ui.mjs）');
  out.push('='.repeat(78));
  for (const [k, v] of Object.entries(header)) out.push(`${k}: ${v}`);
  out.push('');
  if (diag && diag.length) {
    out.push('[诊断]');
    for (const d of diag) out.push('  ' + d);
    out.push('');
  }
  out.push('[日志]');
  out.push(...lines);
  out.push('');
  out.push(`[明细]  （共 ${sm.total} 条）`);
  for (const r of results) out.push(`${r.status}  ${r.n}. ${r.title}${r.detail ? '  — ' + r.detail : ''}`);
  out.push('');
  out.push(`summary: ${sm.pass} PASS / ${sm.fail} FAIL / ${sm.skip} SKIP`);
  out.push(`退出码: ${exitCode}（0=全通过 1=有 FAIL 2=阻塞）`);
  if (shots.length) {
    out.push('');
    out.push('[截图]');
    for (const s of shots) out.push(`  ${s.file}  ${s.bytes} B`);
  }
  if (jsLog.length) {
    out.push('');
    out.push('[页面控制台 / 未捕获异常]');
    for (const j of jsLog.slice(0, 80)) out.push(`  ${j.kind}: ${j.text}`);
  }
  writeFileSync(LOG_FILE, out.join('\n') + '\n', 'utf8');
  return sm;
}

async function main() {
  const startedAt = new Date();
  mkdirSync(SHOT_DIR, { recursive: true });
  const chromePath = findChrome();
  const diag = [];

  log('autokill-purge · 双层体验浏览器端验收');
  log(`基址: ${BASE}`);
  log(`Chrome: ${chromePath || '（找不到）'}`);
  log(`截图: ${SHOT_DIR}`);
  log('');

  if (!chromePath) {
    const why = `找不到 Chrome：候选路径都不存在。装 Chrome，或用 PURGE_CHROME_PATH 指向 chrome.exe。候选：${CHROME_CANDIDATES.join(' , ')}`;
    log('阻塞：' + why);
    record(0, 'SKIP', '前置：Chrome 可执行文件存在', why);
    diag.push(why);
    exitCode = EXIT.blocked;
    const sm = writeResults({ 时间: startedAt.toISOString(), 基址: BASE, Chrome: '（缺失）', 截图目录: SHOT_DIR }, diag);
    log('');
    log(`summary: ${sm.pass} PASS / ${sm.fail} FAIL / ${sm.skip} SKIP（阻塞，无浏览器断言可跑）`);
    log(`诊断：${why}`);
    return;
  }

  log('[前置] HTTP');
  const pre = await preflightHttp();
  if (!pre.ok) {
    log('阻塞：' + pre.why);
    record(0, 'SKIP', '前置：服务可达 + 协议已签 + 模型/技术存在', pre.why);
    diag.push(pre.why);
    exitCode = EXIT.blocked;
    const sm = writeResults({ 时间: startedAt.toISOString(), 基址: BASE, Chrome: chromePath, 截图目录: SHOT_DIR }, diag);
    log('');
    log(`summary: ${sm.pass} PASS / ${sm.fail} FAIL / ${sm.skip} SKIP（阻塞，无浏览器断言可跑）`);
    log(`诊断：${pre.why}`);
    return;
  }
  record(0, 'PASS', '前置：服务可达 + 协议已签 + 模型/技术存在', `models ${stateModels.length} / techniques ${stateTechniques.length}；基址 ${BASE}`);

  log('');
  log('[前置] Chrome + CDP');
  chrome = await launchChrome(chromePath);
  log(`  chrome pid=${chrome.proc.pid} 临时 profile=${chrome.profile}`);
  log(`  CDP ${chrome.wsUrl}`);

  browser = await new CDP(chrome.wsUrl).connect();
  const created = await browser.send('Target.createTarget', { url: 'about:blank' });
  const attached = await browser.send('Target.attachToTarget', { targetId: created.targetId, flatten: true });
  const sessionId = attached.sessionId;
  page = new Page(browser, sessionId, created.targetId);
  await page.install();
  log(`  target=${created.targetId} session=${sessionId}`);

  try {
    await browser.send('Browser.grantPermissions', { origin: BASE, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });
    log('  已授予 clipboard 读写权限（headless 下仍可能被拒，#7 会退化并写明原因）');
  } catch (e) {
    log(`  clipboard 授权失败：${e.message}`);
  }

  await page.setViewport(1280, 900);

  log('');
  log('[前置] 首屏加载');
  await page.navigate(BASE + '/', { settle: 900 });
  const snap = await page.snapshot();
  log(`  url=${snap.url} hash=${snap.hash} title=${snap.title}`);
  log(`  导航(${snap.navCount})：${snap.nav.join(' / ') || '（无）'}`);
  log(`  #modeSwitch：${snap.hasModeSwitch ? '存在「' + snap.modeSwitchText + '」aria-checked=' + snap.ariaChecked : '不存在'}`);
  log(`  页面文本前 300：${clip(snap.text, 300)}`);

  if (!snap.hasModeSwitch) {
    const why = '页面没有 #modeSwitch：前端双层尚未落地（web/public 仍是单层旧版）——等前端子任务交付后重跑本脚本';
    log('');
    log('阻塞：' + why);
    diag.push(why);
    const titles = [
      [1, '签署后落在 simple 破甲页（含「一键生成」+ 模型入口，导航 6 项）'],
      [2, 'simple 导航恰好 4 项，且无「记忆分发」「关于」'],
      [3, 'simple 破甲页首屏可交互元素 ≤ 24'],
      [4, 'simple 破甲页文本无 §2.6 禁用词'],
      [5, '填一句话 + 点「一键生成」→ 8s 内 ≥1 张载荷卡'],
      [6, '空任务点生成 → 人话提示、载荷数不增、无 /api/breach/build 请求'],
      [7, '第一张卡「复制」内容与卡片全文一致'],
      [8, '「这次成功了」/「被拒绝了」各让 attempts +1'],
      [9, '装备页恰好 1 个主按钮，点后出现「已装备」'],
      [10, '记忆页只剩内嵌面板（iframe /embed/memory/）'],
      [11, '设置页无 breakDir/pluginPath/memoryBase/token/令牌 字段'],
      [12, '点一次 #modeSwitch 切 technical：导航 9 项、#/assign #/about 可达、__apErrors=0'],
      [13, '再点一次切回 simple：导航 6 项、无残留技术字段'],
      [14, '刷新后模式保持（technical→9，simple→6）'],
      [15, '1280/390/320 三宽度无横向溢出 + __apErrors=0（含截图）'],
    ];
    for (const [n, title] of titles) record(n, 'SKIP', title, `前端双层未落地（无 #modeSwitch），本条无法判定；当前导航 ${snap.navCount} 项`);
    exitCode = EXIT.blocked;
    const sm = writeResults(
      { 时间: startedAt.toISOString(), 基址: BASE, Chrome: chromePath, 截图目录: SHOT_DIR, 阻塞原因: why },
      diag,
    );
    log('');
    log(`summary: ${sm.pass} PASS / ${sm.fail} FAIL / ${sm.skip} SKIP（阻塞：前端未落地，不是断言失败）`);
    log(`诊断：${why}`);
    return;
  }

  // The SPA can re-render once more after loadEventFired (/api/state lands late and the
  // nav + mode switch rebuild). Wait for two identical samples before asserting, otherwise
  // a slow first paint makes #1 look like "still in technical mode".
  await page
    .waitFor(
      inPage(String.raw`
      if (!window.__ux2Settle) window.__ux2Settle = { sig: '', n: 0 };
      const s = window.__ux2Settle;
      const nav = Array.from(document.querySelectorAll('#nav a')).map((a) => (a.textContent || '').trim()).join('|');
      const sw = document.querySelector('#modeSwitch');
      const mode = sw && sw.dataset ? (sw.dataset.mode || '') : '';
      const sig = nav + '#' + mode;
      if (nav && sig === s.sig) { s.n += 1; } else { s.sig = sig; s.n = 0; }
      return s.n >= 1 ? true : null;
    `),
      { timeout: 8000, interval: 250 },
    )
    .catch(() => null);
  const settled = await page.snapshot();
  log(`  稳定后：导航(${settled.navCount}) ${settled.nav.join(' / ') || '（无）'} · aria-checked=${settled.ariaChecked}`);

  log('');
  log('[断言]');
  await run(1, '签署后落在 simple 破甲页（含「一键生成」+ 模型入口，导航 6 项）', assert1);
  await run(2, 'simple 导航恰好 4 项，且无「记忆分发」「关于」', assert2);
  await run(3, 'simple 破甲页首屏可交互元素 ≤ 24', assert3);
  await run(4, 'simple 破甲页文本无 §2.6 禁用词', assert4);
  await run(5, '填一句话 + 点「一键生成」→ 8s 内 ≥1 张载荷卡', assert5);
  await run(6, '空任务点生成 → 光标回输入框、载荷数不增、无 /api/breach/build 请求', assert6);
  await run(7, '第一张卡「复制」内容与卡片全文一致', assert7);
  await run(8, '「这次成功了」/「被拒绝了」各让 attempts +1', assert8);
  await run(9, '装备页恰好 1 个主按钮，点后出现「已装备」', assert9);
  await run(10, '记忆页只剩内嵌面板（iframe /embed/memory/）', assert10);
  await run(11, '设置页无 breakDir/pluginPath/memoryBase/token/令牌 字段', assert11);
  await run(12, '点一次 #modeSwitch 切 technical：导航 9 项、#/assign #/about 可达、__apErrors=0', assert12);
  await run(13, '再点一次切回 simple：导航 6 项、无残留技术字段', assert13);
  await run(14, '刷新后模式保持（technical→9，simple→6）', assert14);
  await run(15, '1280/390/320 三宽度无横向溢出 + __apErrors=0（含截图）', assert15);

  try {
    const end = await ensureMode('simple');
    log('');
    log(`[收尾] 模式恢复为 simple（clicks=${end.clicks}，原 ${end.before || '未知'}）`);
  } catch (e) {
    log(`[收尾] 恢复 simple 失败：${e.message}`);
  }

  const sm = summary();
  exitCode = sm.fail > 0 ? EXIT.fail : EXIT.ok;
  writeResults(
    {
      时间: startedAt.toISOString(),
      基址: BASE,
      Chrome: chromePath,
      截图目录: SHOT_DIR,
      耗时: ((Date.now() - startedAt.getTime()) / 1000).toFixed(1) + 's',
    },
    diag,
  );

  log('');
  log(`summary: ${sm.pass} PASS / ${sm.fail} FAIL / ${sm.skip} SKIP`);
  if (sm.fail) log('有 FAIL —— 见上面逐条明细；详情已写进 test/ux2layer-ui-results.txt');
  log(`结果文件: ${LOG_FILE}`);
}

// ---- 入口 + 收尾 ---------------------------------------------------------------

let cleaning = false;
function cleanup() {
  if (cleaning) return;
  cleaning = true;
  try {
    if (browser) browser.close();
  } catch {
    /* empty */
  }
  if (chrome) {
    killChrome(chrome.proc);
    rmProfile(chrome.profile);
  }
}

process.on('SIGINT', () => {
  log('');
  log('[中断] 收到 Ctrl+C，清理 chrome 与临时 profile');
  cleanup();
  process.exit(EXIT.fail);
});
process.on('uncaughtException', (e) => {
  log('[致命] 未捕获异常：' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : String(e)));
  cleanup();
  process.exit(EXIT.fail);
});

try {
  await main();
} catch (e) {
  // 预期内的诊断型错误（chrome 起不来 / CDP 连不上）在这里变成一句话，而不是抛栈
  const msg = (e && e.message) || String(e);
  log('');
  log('[失败] ' + msg);
  if (!results.length) record(0, 'SKIP', '前置：浏览器就绪', msg);
  exitCode = EXIT.blocked;
  const sm = summary();
  try {
    writeResults({ 时间: new Date().toISOString(), 基址: BASE, Chrome: findChrome() || '（缺失）', 截图目录: SHOT_DIR }, [msg]);
  } catch {
    /* empty */
  }
  log(`summary: ${sm.pass} PASS / ${sm.fail} FAIL / ${sm.skip} SKIP`);
} finally {
  cleanup();
}

process.exitCode = exitCode;
