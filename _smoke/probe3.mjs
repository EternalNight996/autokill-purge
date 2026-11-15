const base = 'http://127.0.0.1:7999';
const j = async (p, opt) => { const r = await fetch(base + p, opt); const t = await r.text(); return { status: r.status, body: t.slice(0, 400) }; };
console.log('health:', JSON.stringify(await j('/api/health')));
const keys = ['purge.gear.scan_packer_markers','purge.gear.rank_check_candidates','purge.gear.plan_unpack','purge.gear.audit_claims','purge.skill.autokill-purge','purge.flow.gear-install'];
const look = await fetch(base + '/api/lookup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ keys, filter: { source: 'autokill-purge' } }) });
console.log('lookup status:', look.status);
console.log(JSON.stringify(await look.json()).slice(0, 900));
