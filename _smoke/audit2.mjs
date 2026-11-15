const probe = async (port) => {
  const out = { port };
  try { const h = await fetch('http://127.0.0.1:' + port + '/memory-eternal/api/health'); out.health = h.status; if (h.ok) { const j = await h.json(); out.version = j.version; out.cards = j.cards; out.pending = j.pending; out.quarantined = j.quarantined; out.schema = j.schema_version; out.writable = j.writable; } } catch (e) { out.health = 'err'; }
  try { const l = await fetch('http://127.0.0.1:' + port + '/memory-eternal/api/lookup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ keys: ['purge.gear.plan_unpack'] }) }); out.lookup = l.status; if (l.ok) { const j = await l.json(); out.plan_unpack = j.results && j.results[0] && j.results[0].state; } } catch (e) { out.lookup = 'err'; }
  try { const r = await fetch('http://127.0.0.1:' + port + '/api/health'); out.oldApiHealth = r.status; } catch (e) { out.oldApiHealth = 'err'; }
  return out;
};
console.log(JSON.stringify(await probe(7999), null, 0));
console.log(JSON.stringify(await probe(8001), null, 0));
