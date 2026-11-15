const base = 'http://127.0.0.1:8001/memory-eternal/api';
const post = async (p, body) => { const r = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, json: await r.json().catch(() => ({})) }; };
console.log('no filter:', JSON.stringify(await post('/lookup', { keys: ['purge.gear.plan_unpack'] })));
console.log('with filter:', JSON.stringify(await post('/lookup', { keys: ['purge.gear.plan_unpack'], filter: { source: 'autokill-purge' } })));
console.log('health:', JSON.stringify(await (await fetch(base + '/health')).json()).slice(0, 300));
