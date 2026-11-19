/*!
 * MengBot · 对话框旁「装备」上拉抽屉（dsh-purge 外挂组件，不改 MengBot 自己的 bundle）
 *
 * 挂载方式：resources/ui/index.html 里加一行
 *   <script type="module" src="/assets/gear-drawer.js"></script>
 * 卸载：删掉那一行（或还原 index.html.dshpurge.bak）
 *
 * 行为：
 *   · 在聊天输入框（textarea）右侧插一个「⚙ 装备」胶囊按钮
 *   · 点它从屏幕底部向上滑出一层抽屉（上拉面板）
 *   · 抽屉里选 bot + 选装备档位 → 写 MengBot 的 BotRecord.gear
 *   · 写入走 autokill-purge 的本地服务 http://127.0.0.1:8792/api/mengbot/gear
 *   （该服务已开 CORS；没起服务时抽屉会明确提示，不静默失败）
 */
(() => {
  // autokill-purge 的控制台端口不固定（默认 8792，可被 PURGE_WEB_PORT 改）：启动时探一遍
  const API_PORTS = [8792, 8793, 8794, 8802];
  let API_BASE = null;
  const GEARS = [
    { id: '', label: '不装备', hint: '纯对话，不带工具集' },
    { id: 'redteam', label: '红队全装', hint: '侦察/打点/横向/权限维持一条链' },
    { id: 'recon', label: '侦察刀', hint: '被动收集、资产测绘、指纹' },
    { id: 'lateral', label: '内网横向', hint: 'SMB / WinRM / 凭据复用' },
    { id: 'radio', label: '无线电 / IoT', hint: 'BLE、串口、固件' },
    { id: 're', label: '逆向研究', hint: '静态 + 动态 + 脱壳' },
    { id: 'custom', label: '自定义', hint: '按你的技能目录现配' },
  ];

  const CSS = `
  [data-mg-gear-btn]{
    all:unset;box-sizing:border-box;cursor:pointer;display:inline-flex;align-items:center;gap:5px;
    height:28px;padding:0 10px;border-radius:14px;font:500 12px/1 -apple-system,system-ui,"Segoe UI",sans-serif;
    color:#e7e7ea;background:rgba(255,255,255,.07);border:.5px solid rgba(255,255,255,.16);
    transition:background .15s,border-color .15s;white-space:nowrap;
  }
  [data-mg-gear-btn]:hover{background:rgba(255,255,255,.13);border-color:rgba(255,255,255,.3)}
  [data-mg-gear-btn][data-on="1"]{color:#0b0b0c;background:#9fe870;border-color:#9fe870;font-weight:600}
  [data-mg-gear-mask]{
    position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.45);opacity:0;
    transition:opacity .18s ease;pointer-events:none;
  }
  [data-mg-gear-mask][data-open="1"]{opacity:1;pointer-events:auto}
  [data-mg-gear-drawer]{
    position:fixed;left:0;right:0;bottom:0;z-index:2147483001;
    transform:translateY(100%);transition:transform .22s cubic-bezier(.32,.72,0,1);
    background:#141416;border-top:.5px solid rgba(255,255,255,.14);
    border-radius:18px 18px 0 0;padding:14px 16px calc(16px + env(safe-area-inset-bottom,0px));
    box-shadow:0 -12px 40px rgba(0,0,0,.5);
    font:13px/1.5 -apple-system,system-ui,"Segoe UI",sans-serif;color:#e7e7ea;
    max-height:72vh;overflow:auto;
  }
  [data-mg-gear-drawer][data-open="1"]{transform:translateY(0)}
  [data-mg-gear-drawer] .mgd-handle{width:38px;height:4px;border-radius:2px;background:rgba(255,255,255,.22);margin:0 auto 12px}
  [data-mg-gear-drawer] .mgd-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
  [data-mg-gear-drawer] .mgd-title{font-size:14px;font-weight:600;letter-spacing:.02em}
  [data-mg-gear-drawer] .mgd-x{all:unset;cursor:pointer;padding:4px 8px;border-radius:8px;color:#9a9aa2}
  [data-mg-gear-drawer] .mgd-x:hover{background:rgba(255,255,255,.08);color:#fff}
  [data-mg-gear-drawer] .mgd-row{display:flex;align-items:center;gap:8px;margin-bottom:10px}
  [data-mg-gear-drawer] select{all:unset;box-sizing:border-box;flex:1;cursor:pointer;padding:7px 10px;border-radius:9px;
    background:rgba(255,255,255,.07);border:.5px solid rgba(255,255,255,.16);color:#e7e7ea;font-size:12px}
  [data-mg-gear-drawer] .mgd-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
  [data-mg-gear-drawer] .mgd-item{all:unset;box-sizing:border-box;cursor:pointer;padding:10px 11px;border-radius:11px;
    background:rgba(255,255,255,.05);border:.5px solid rgba(255,255,255,.13);transition:all .15s}
  [data-mg-gear-drawer] .mgd-item:hover{background:rgba(255,255,255,.1)}
  [data-mg-gear-drawer] .mgd-item[data-pick="1"]{border-color:#9fe870;background:rgba(159,232,112,.14)}
  [data-mg-gear-drawer] .mgd-item b{display:block;font-size:12.5px;font-weight:600;margin-bottom:2px}
  [data-mg-gear-drawer] .mgd-item span{display:block;font-size:11px;line-height:1.35;color:#8d8d96}
  [data-mg-gear-drawer] .mgd-foot{display:flex;align-items:center;justify-content:space-between;margin-top:12px;gap:10px}
  [data-mg-gear-drawer] .mgd-save{all:unset;cursor:pointer;padding:9px 18px;border-radius:11px;background:#9fe870;color:#0b0b0c;font-weight:600;font-size:12.5px}
  [data-mg-gear-drawer] .mgd-save[disabled]{opacity:.45;cursor:not-allowed}
  [data-mg-gear-drawer] .mgd-msg{font-size:11.5px;color:#8d8d96;min-height:16px}
  [data-mg-gear-drawer] .mgd-msg[data-bad="1"]{color:#ff8a8a}
  [data-mg-gear-drawer] .mgd-msg[data-ok="1"]{color:#9fe870}
  [data-mg-gear-drawer] .mgd-prev{margin-top:12px;border-top:.5px solid rgba(255,255,255,.1);padding-top:9px}
  [data-mg-gear-drawer] .mgd-prev summary{cursor:pointer;font-size:11.5px;color:#9a9aa2}
  [data-mg-gear-drawer] .mgd-prev summary:hover{color:#e7e7ea}
  [data-mg-gear-drawer] .mgd-prev pre{margin:8px 0 0;white-space:pre-wrap;word-break:break-word;
    font:11px/1.55 ui-monospace,Consolas,"SF Mono",monospace;color:#c9c9d1;max-height:200px;overflow:auto;
    background:rgba(255,255,255,.04);border-radius:9px;padding:9px 10px}
  `;

  const state = { bots: [], botId: '', gear: '', open: false, busy: false };

  function el(tag, attrs, children) {
    const n = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (k === 'text') n.textContent = v;
      else if (k === 'style') n.setAttribute('style', v);
      else n.setAttribute(k, v);
    }
    for (const c of children || []) n.appendChild(c);
    return n;
  }

  function ensureStyle() {
    if (document.getElementById('mgd-style')) return;
    const s = el('style', { id: 'mgd-style' });
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  async function resolveBase() {
    if (API_BASE) return API_BASE;
    for (const p of API_PORTS) {
      try {
        const r = await fetch(`http://127.0.0.1:${p}/api/ping`, { cache: 'no-store' });
        if (r.ok) { API_BASE = `http://127.0.0.1:${p}`; return API_BASE; }
      } catch { /* 该端口没服务，试下一个 */ }
    }
    throw new Error('没找到 autokill-purge 服务（试过 ' + API_PORTS.join(' / ') + '）');
  }

  async function api(path, init) {
    const base = await resolveBase();
    const r = await fetch(base + path, init);
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.ok === false) throw new Error(j.detail || j.error || ('HTTP ' + r.status));
    return j;
  }

  async function loadBots() {
    const j = await api('/api/mengbot/bots');
    state.bots = j.bots || [];
    if (!state.botId && state.bots.length) state.botId = state.bots[0].id;
    const cur = state.bots.find((b) => b.id === state.botId);
    state.gear = (cur && cur.gear) || '';
  }

  // ---- 抽屉 ----
  let maskEl = null;
  let drawerEl = null;

  function buildDrawer() {
    if (drawerEl && drawerEl.isConnected) return;
    maskEl = el('div', { 'data-mg-gear-mask': '', 'data-open': '0' });
    maskEl.addEventListener('click', () => toggle(false));

    const botSel = el('select', { 'data-mg-bot': '' });
    const grid = el('div', { class: 'mgd-grid' });
    const msg = el('div', { class: 'mgd-msg', 'data-mg-msg': '' });
    const save = el('button', { class: 'mgd-save', 'data-mg-save': '', disabled: '1', text: '写入装备' });

    const head = el('div', { class: 'mgd-head' }, [
      el('div', { class: 'mgd-title', text: '装备 · 破甲档位' }),
      el('button', { class: 'mgd-x', 'data-mg-close': '', text: '✕' }),
    ]);

    drawerEl = el('div', { 'data-mg-gear-drawer': '', 'data-open': '0' }, [
      el('div', { class: 'mgd-handle' }),
      head,
      el('div', { class: 'mgd-row' }, [botSel]),
      grid,
      el('details', { class: 'mgd-prev' }, [
        el('summary', { text: '即将注入的系统提示词（点开看全文）' }),
        el('pre', { 'data-mg-prev': '', text: '（选一个装备档位后显示）' }),
      ]),
      el('div', { class: 'mgd-foot' }, [msg, save]),
    ]);
    drawerEl.querySelector('[data-mg-close]').addEventListener('click', () => toggle(false));
    document.body.append(maskEl, drawerEl);

    botSel.addEventListener('change', () => {
      state.botId = botSel.value;
      const cur = state.bots.find((b) => b.id === state.botId);
      state.gear = (cur && cur.gear) || '';
      render();
    });
    save.addEventListener('click', submit);
    render();
  }

  function render() {
    if (!drawerEl) return;
    const botSel = drawerEl.querySelector('[data-mg-bot]');
    botSel.innerHTML = '';
    for (const b of state.bots) botSel.appendChild(el('option', { value: b.id, text: b.name || b.id }));
    if (state.botId) botSel.value = state.botId;

    const grid = drawerEl.querySelector('.mgd-grid');
    grid.innerHTML = '';
    for (const g of GEARS) {
      const item = el('button', { class: 'mgd-item', 'data-gear': g.id, 'data-pick': g.id === state.gear ? '1' : '0' }, [
        el('b', { text: g.label }),
        el('span', { text: g.hint }),
      ]);
      item.addEventListener('click', () => { state.gear = g.id; render(); });
      grid.appendChild(item);
    }
    const save = drawerEl.querySelector('[data-mg-save]');
    save.disabled = state.busy ? '1' : '';
    void loadPreview(state.gear);   // 选中即预览"这次会注入什么"
  }

  function say(text, tone) {
    const m = drawerEl && drawerEl.querySelector('[data-mg-msg]');
    if (!m) return;
    m.textContent = text || '';
    m.removeAttribute('data-bad');
    m.removeAttribute('data-ok');
    if (tone) m.setAttribute(tone === 'ok' ? 'data-ok' : 'data-bad', '1');
  }

  // 「按需注入」的可视化：选中哪档，就把破甲台 /api/gear/<id> 会注入的那段 markdown 显示出来
  const previewCache = new Map();
  async function loadPreview(gear) {
    const pre = drawerEl && drawerEl.querySelector('[data-mg-prev]');
    if (!pre) return;
    if (!gear) { pre.textContent = '（不装备：系统提示词里不追加任何装备段，逐字节等于没有这个功能）'; return; }
    if (previewCache.has(gear)) { pre.textContent = previewCache.get(gear); return; }
    pre.textContent = '读取中…';
    try {
      const base = await resolveBase();
      const r = await fetch(base + '/api/gear/' + encodeURIComponent(gear), { cache: 'no-store' });
      const j = await r.json().catch(() => ({}));
      const md = String(j.markdown || '').trim();
      const text = md || '（该档没有阶段表：' + (j.error || 'custom 档由你自己配') + '）';
      previewCache.set(gear, text);
      pre.textContent = text;
    } catch (e) {
      pre.textContent = '取不到阶段表：' + (e.message || e) + '（控制台没起？）';
    }
  }

  async function submit() {
    if (state.busy || !state.botId) return;
    state.busy = true;
    render();
    say('写入中…');
    try {
      await api('/api/mengbot/gear', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirm: true, id: state.botId, gear: state.gear }),
      });
      say('已写入：' + (GEARS.find((g) => g.id === state.gear) || GEARS[0]).label + '（下次会话生效）', 'ok');
      await loadBots().catch(() => {});
      render();
    } catch (e) {
      say('写不进去：' + (e.message || e) + '（确认 autokill-purge 服务在 ' + API_BASE + ' 跑着）', 'bad');
    } finally {
      state.busy = false;
      render();
    }
  }

  async function toggle(open) {
    buildDrawer();
    const next = open === undefined ? !state.open : !!open;
    if (next && !state.bots.length) {
      say('读取 bot 列表…');
      try { await loadBots(); render(); say(''); }
      catch (e) { say('读不到 bot：' + (e.message || e) + '（先起 node web/server.mjs）', 'bad'); }
    }
    state.open = next;
    maskEl.setAttribute('data-open', next ? '1' : '0');
    drawerEl.setAttribute('data-open', next ? '1' : '0');
    syncButton();
  }

  // ---- 在对话框旁挂按钮 ----
  function findComposer() {
    const tas = [...document.querySelectorAll('textarea')].filter((t) => t.isConnected && t.offsetParent !== null && !t.disabled);
    if (!tas.length) return null;
    // 取最靠近视口底部的那个（聊天输入框）
    const ta = tas.sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom)[0];
    let host = ta.parentElement;
    for (let i = 0; i < 3 && host && host.parentElement; i++) {
      const cls = String(host.className || '');
      if (/rounded|border|ring/.test(cls)) break;
      host = host.parentElement;
    }
    return { ta, host: host || ta.parentElement };
  }

  let btnEl = null;
  function syncButton() {
    if (!btnEl) return;
    const label = btnEl.querySelector('[data-mg-gear-label]');
    const g = GEARS.find((x) => x.id === state.gear);
    if (label) label.textContent = g && g.id ? g.label : '装备';
    btnEl.setAttribute('data-on', state.gear ? '1' : '0');
    btnEl.title = state.gear ? ('当前装备：' + (g ? g.label : state.gear)) : '选择装备档位';
  }

  function mount() {
    ensureStyle();
    const c = findComposer();
    if (!c) return;
    if (btnEl && btnEl.isConnected) { syncButton(); return; }
    btnEl = el('button', { 'data-mg-gear-btn': '', type: 'button', 'aria-haspopup': 'dialog', title: '选择装备档位' }, [
      el('span', { text: '⚙' }),
      el('span', { 'data-mg-gear-label': '', text: '装备' }),
    ]);
    btnEl.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); toggle(); });
    // 插到输入框同一层、紧跟其后（"对话框旁边"）
    if (c.ta.parentElement) c.ta.parentElement.appendChild(btnEl);
    else c.host.appendChild(btnEl);
    syncButton();
  }

  // React 会重渲染，靠 Observer + 低频兜底保证挂载点存活
  const obs = new MutationObserver(() => { if (!btnEl || !btnEl.isConnected) mount(); });
  function boot() {
    if (!document.body) return setTimeout(boot, 200);
    obs.observe(document.body, { childList: true, subtree: true });
    mount();
    setInterval(() => { if (!btnEl || !btnEl.isConnected) mount(); }, 1500);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && state.open) toggle(false); });
    // 首次读一次 gear（服务没起就静默，等点开抽屉再提示）
    loadBots().then(() => { buildDrawer(); render(); syncButton(); }).catch(() => {});
  }
  boot();
})();
