const url = 'http://127.0.0.1:8792/api/status';
try {
  const r = await fetch(url);
  const text = await r.text();
  console.log('status', r.status);
  console.log(text.slice(0, 800));
} catch (e) { console.log('fetch failed', e.message); }
