import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync(process.argv[2], { readOnly: true });
const q = (sql) => db.prepare(sql).all();
console.log('kind:', JSON.stringify(q("select kind, count(*) c from cards group by kind order by c desc limit 8")));
console.log('source:', JSON.stringify(q("select source, count(*) c from cards group by source order by c desc limit 8")));
console.log('size:', JSON.stringify(q("select count(*) n, sum(length(body)) body_bytes, round(avg(length(body)),1) avg_body from cards")));
console.log('status:', JSON.stringify(q("select status, count(*) c from cards group by status")));
console.log('quarantine:', JSON.stringify(q("select count(*) n from quarantine")));
