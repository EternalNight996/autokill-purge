const base = 'http://127.0.0.1:8001/memory-eternal/api';
const keys = ['purge.gear.scan_packer_markers','purge.gear.rank_check_candidates','purge.gear.plan_unpack','purge.gear.audit_claims','purge.skill.autokill-purge','purge.flow.gear-install'];
const post = async (body) => { const r = await fetch(base + '/lookup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, json: await r.json().catch(() => ({})) }; };
console.log('A 6keys+filter:', JSON.stringify((await post({ keys, filter: { source: 'autokill-purge' } })).json.results.map(r => r.key.replace('purge.','') + '=' + r.state)));
console.log('B 6keys nofilter:', JSON.stringify((await post({ keys })).json.results.map(r => r.key.replace('purge.','') + '=' + r.state)));
console.log('C 1key:', JSON.stringify((await post({ keys: ['purge.gear.plan_unpack'] })).json.results.map(r => r.key.replace('purge.','') + '=' + r.state)));
