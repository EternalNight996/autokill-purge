const b = 'http://127.0.0.1:7999/memory-eternal/api';
async function j(method, path, body) {
  try {
    const r = await fetch(b + path, {
      method,
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const t = await r.text();
    console.log(method, path, '->', r.status, t.slice(0, 400));
  } catch (e) {
    console.log(method, path, 'ERR', e.message);
  }
}
(async () => {
  await j('GET', '/write');
  await j('POST', '/write', { title: 'probe', kind: 'tool', tags: [], body: 'x' });
  await j('POST', '/upsert', { card: { key: 'purge.probe.test', kind: 'tool', title: 'probe', body: 'probe card', source: 'autokill-purge' } });
})();
