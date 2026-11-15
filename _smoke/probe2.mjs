const base = process.argv[2] || 'http://127.0.0.1:8793';
const r = await fetch(base + '/api/status');
const j = await r.json();
console.log(JSON.stringify({ status: r.status, memory: j.memory, pending: j.pending, service: j.service.reachable, vault: j.vault.exists }, null, 2));
const c = await (await fetch(base + '/api/catalog')).json();
console.log(JSON.stringify({ items: c.items.length, present: c.items.filter(i => i.present).map(i => i.id) }));
