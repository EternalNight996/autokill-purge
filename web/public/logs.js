/* 系统日志抽屉（UI 级）：注入顶栏按钮 + 右侧抽屉
   · 实时：SSE /api/logs/stream；暂停后进来的条目进队列，恢复时补上
   · 过滤：级别（debug/info/warn/error 及以上）、标签、关键字
   · 动作：清空、导出（/api/logs/export 直接下载）、跳到最新
   · 未签署协议也能看（服务端把 /api/logs* 放进白名单），首启排查用 */
(function () {
  if (window.__apLogsInstalled) return;
  window.__apLogsInstalled = true;

  const MAX_ROWS = 1500;
  const S = {
    open: false,
    live: true,
    level: '',
    tag: '',
    q: '',
    rows: [],
    pending: [],
    since: 0,
    unreadError: 0,
    tags: [],
    stats: null,
    es: null,
  };

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  let mask, drawer, body, foot, btn, levelSel, tagSel, searchInput, liveBtn, badge, subTitle;

  function buildButton() {
    const right = document.querySelector('.topbar-right');
    if (!right || document.getElementById('apLogBtn')) return;
    btn = el('button', 'mode-switch ap-log-btn');
    btn.id = 'apLogBtn';
    btn.type = 'button';
    btn.title = '系统日志（Ctrl+`）';
    btn.innerHTML = '<span class="switch-label">日志</span><span class="ap-log-dot"></span>';
    btn.addEventListener('click', () => toggle());
    right.insertBefore(btn, right.firstChild);
    badge = btn.querySelector('.ap-log-dot');
  }

  function buildDrawer() {
    if (document.getElementById('apLogDrawer')) return;
    mask = el('div', 'ap-log-mask');
    mask.id = 'apLogMask';
    mask.addEventListener('click', () => setOpen(false));

    drawer = el('aside', 'ap-log-drawer');
    drawer.id = 'apLogDrawer';
    drawer.setAttribute('aria-label', '系统日志');

    const head = el('div', 'ap-log-head');
    const title = el('span', 'ap-log-title', '系统日志');
    subTitle = el('span', 'ap-log-sub', '连接中…');
    const spacer = el('span', 'ap-log-spacer');

    liveBtn = el('button', null, '实时');
    liveBtn.type = 'button';
    liveBtn.dataset.on = '1';
    liveBtn.addEventListener('click', () => {
      S.live = !S.live;
      liveBtn.dataset.on = S.live ? '1' : '0';
      liveBtn.textContent = S.live ? '实时' : '已暂停';
      if (S.live) { flushPending(); scrollToEnd(); }
      renderFoot();
    });

    levelSel = el('select');
    for (const [v, t] of [['', '全部级别'], ['debug', 'debug+'], ['info', 'info+'], ['warn', 'warn+'], ['error', '仅 error']]) {
      const o = el('option', null, t); o.value = v; levelSel.appendChild(o);
    }
    levelSel.addEventListener('change', () => { S.level = levelSel.value; reload(); });

    tagSel = el('select');
    tagSel.addEventListener('change', () => { S.tag = tagSel.value; reload(); });
    refreshTags();

    searchInput = el('input');
    searchInput.type = 'search';
    searchInput.placeholder = '搜索消息 / 标签';
    let tmr = null;
    searchInput.addEventListener('input', () => {
      clearTimeout(tmr);
      tmr = setTimeout(() => { S.q = searchInput.value; reload(); }, 180);
    });

    const clearBtn = el('button', null, '清空');
    clearBtn.type = 'button';
    clearBtn.addEventListener('click', async () => {
      if (!window.confirm('清空内存里的日志缓冲？（落盘文件保留）')) return;
      try { await fetch('/api/logs/clear', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirm: true }) }); } catch { /* ignore */ }
      S.rows = []; S.pending = []; S.since = 0; S.unreadError = 0; paint();
    });

    const exportBtn = el('a', null, '导出');
    exportBtn.href = '/api/logs/export';
    exportBtn.setAttribute('download', 'autokill-purge-logs.log');
    exportBtn.style.cssText = 'padding:4px 8px;border:1px solid #262630;border-radius:7px;color:#d7d7de;text-decoration:none';

    const closeBtn = el('button', null, '关闭');
    closeBtn.type = 'button';
    closeBtn.addEventListener('click', () => setOpen(false));

    head.append(title, subTitle, spacer, liveBtn, levelSel, tagSel, searchInput, clearBtn, exportBtn, closeBtn);

    body = el('div', 'ap-log-body');
    foot = el('div', 'ap-log-foot');
    drawer.append(head, body, foot);
    document.body.append(mask, drawer);
    paint();
    renderFoot();
  }

  function refreshTags() {
    if (!tagSel) return;
    const cur = tagSel.value;
    tagSel.innerHTML = '';
    const all = el('option', null, '全部标签'); all.value = ''; tagSel.appendChild(all);
    for (const t of S.tags) { const o = el('option', null, t); o.value = t; tagSel.appendChild(o); }
    tagSel.value = S.tags.includes(cur) ? cur : '';
  }

  function rowNode(e) {
    const row = el('div', 'ap-log-row');
    const time = el('time', null, String(e.at || '').slice(11));
    time.title = e.at || '';
    const lv = el('span', 'ap-log-lv', e.level || 'info');
    lv.dataset.lv = e.level || 'info';
    const tag = el('span', 'ap-log-tag', e.tag || '');
    tag.title = e.tag || '';
    const msg = el('span', 'ap-log-msg', e.msg || '');
    if (e.extra) {
      const extra = el('span', 'ap-log-extra', ' ' + JSON.stringify(e.extra));
      msg.appendChild(extra);
    }
    row.append(time, lv, tag, msg);
    return row;
  }

  function matches(e) {
    if (S.level) {
      const rank = { debug: 10, info: 20, warn: 30, error: 40 };
      if ((rank[e.level] || 20) < rank[S.level]) return false;
    }
    if (S.tag && e.tag !== S.tag) return false;
    if (S.q) {
      const n = S.q.toLowerCase();
      if (!(String(e.msg).toLowerCase().includes(n) || String(e.tag).toLowerCase().includes(n))) return false;
    }
    return true;
  }

  function appendRow(e) {
    if (!matches(e)) return;
    S.rows.push(e);
    if (S.rows.length > MAX_ROWS) S.rows.splice(0, S.rows.length - MAX_ROWS);
    if (!body) return;
    const nearBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 60;
    if (body.querySelector('.ap-log-empty')) body.innerHTML = '';
    body.appendChild(rowNode(e));
    while (body.childElementCount > MAX_ROWS) body.firstElementChild.remove();
    if (nearBottom) scrollToEnd();
  }

  function scrollToEnd() { if (body) body.scrollTop = body.scrollHeight; }

  function paint() {
    if (!body) return;
    body.innerHTML = '';
    if (!S.rows.length) { body.appendChild(el('div', 'ap-log-empty', '暂无日志（服务端缓冲为空，或当前过滤条件没有命中）')); }
    else { const frag = document.createDocumentFragment(); for (const e of S.rows) frag.appendChild(rowNode(e)); body.appendChild(frag); scrollToEnd(); }
    renderFoot();
  }

  function renderFoot() {
    if (!foot) return;
    const st = S.stats || {};
    const by = st.byLevel || {};
    foot.innerHTML = '';
    const parts = [
      ['缓冲', (st.buffered ?? S.rows.length) + ' / ' + (st.cap ?? '—')],
      ['error', String(by.error ?? 0)],
      ['warn', String(by.warn ?? 0)],
      ['info', String(by.info ?? 0)],
      ['debug', String(by.debug ?? 0)],
      ['落盘', st.dir ? 'data/logs' : '未启用'],
    ];
    for (const [k, v] of parts) {
      const s = el('span');
      s.append(el('span', null, k + ' '), el('b', null, v));
      foot.appendChild(s);
    }
    if (!S.live) foot.appendChild(el('span', null, '· 已暂停，' + S.pending.length + ' 条待补'));
  }

  async function reload() {
    try {
      const qs = new URLSearchParams({ limit: '400', level: S.level, q: S.q, tag: S.tag });
      const r = await fetch('/api/logs?' + qs.toString());
      const j = await r.json();
      if (!j || j.ok === false) throw new Error(j && j.error ? j.error : 'bad payload');
      S.stats = j.stats || null;
      S.tags = j.tags || [];
      S.rows = (j.entries || []).slice(-MAX_ROWS);
      S.since = S.rows.length ? S.rows[S.rows.length - 1].id : 0;
      refreshTags();
      paint();
      if (subTitle) subTitle.textContent = S.live ? '实时' : '已暂停';
    } catch (e) {
      if (subTitle) subTitle.textContent = '读取失败：' + (e && e.message ? e.message : e);
    }
  }

  function flushPending() {
    const q = S.pending;
    S.pending = [];
    for (const e of q) appendRow(e);
    renderFoot();
  }

  function connect() {
    if (S.es) { try { S.es.close(); } catch { /* ignore */ } }
    try {
      const es = new EventSource('/api/logs/stream');
      S.es = es;
      es.onopen = () => { if (subTitle) subTitle.textContent = S.live ? '实时' : '已暂停'; };
      es.onmessage = (ev) => {
        let e = null;
        try { e = JSON.parse(ev.data); } catch { return; }
        if (!e || !e.id) return;
        if (e.id <= S.since) return;
        S.since = e.id;
        if (e.level === 'error') { S.unreadError += 1; if (badge) badge.parentElement.dataset.hasError = '1'; }
        if (!S.live) { S.pending.push(e); if (S.pending.length > MAX_ROWS) S.pending.shift(); renderFoot(); return; }
        appendRow(e);
      };
      es.onerror = () => { if (subTitle) subTitle.textContent = '连接中断，3s 后重试'; setTimeout(connect, 3000); };
    } catch { setTimeout(connect, 3000); }
  }

  function setOpen(v) {
    S.open = v;
    if (!drawer) buildDrawer();
    drawer.dataset.open = v ? '1' : '0';
    mask.dataset.open = v ? '1' : '0';
    if (v) {
      S.unreadError = 0;
      if (badge) badge.parentElement.dataset.hasError = '0';
      reload().then(() => { if (S.live) scrollToEnd(); });
    }
  }
  function toggle() { setOpen(!S.open); }

  function boot() {
    buildButton();
    const mo = new MutationObserver(() => buildButton());
    mo.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('keydown', (e) => {
      if (e.ctrlKey && (e.key === '`' || e.code === 'Backquote')) { e.preventDefault(); toggle(); }
      if (e.key === 'Escape' && S.open) setOpen(false);
    });
    // 预取一次，让顶栏红点能反映历史错误
    fetch('/api/logs?limit=1').then((r) => r.json()).then((j) => {
      S.stats = j.stats || null;
      if (j.tags) { S.tags = j.tags; }
      renderFoot();
    }).catch(() => {});
    // logsStill=1：不连 SSE（截图 / 静态快照用，避免长连接把页面拖住）
    if (!/[?&]logsStill=1\b/.test(location.search)) connect();
    // 深链：?logs=1 直接打开抽屉（截图 / 排查用）
    if (/[?&]logs=1\b/.test(location.search)) setOpen(true);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
