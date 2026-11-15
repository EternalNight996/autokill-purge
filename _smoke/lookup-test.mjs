import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync(process.argv[2], { readOnly: true });
const keys = ['gear.scan_packer_markers','gear.plan_unpack','skill.autokill-purge','flow.gear-install'];
const sql = "select path, status, kind from cards where body like '%' || ? || '%' or title like '%' || ? || '%' limit 5";
for (const key of keys) {
  const t0 = performance.now();
  const rows = db.prepare(sql).all(key, key);
  const ms = (performance.now() - t0).toFixed(1);
  console.log(key + ' -> ' + rows.length + ' row(s) in ' + ms + 'ms ' + JSON.stringify(rows.slice(0,2)));
}
const t1 = performance.now();
const all = db.prepare("select status, count(*) c from cards group by status").all();
console.log('status counts:', JSON.stringify(all), 'in', (performance.now()-t1).toFixed(1)+'ms');
