import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync(process.argv[2], { readOnly: true });
const tables = db.prepare("select name, type from sqlite_master where type in ('table','view') order by name").all();
console.log('tables:', tables.map(t => t.name).join(', '));
for (const t of tables) {
  const cols = db.prepare('pragma table_info(' + t.name + ')').all().map(c => c.name + ':' + c.type);
  const n = db.prepare('select count(*) c from ' + t.name).get();
  console.log('- ' + t.name + ' (' + n.c + ') ' + cols.join(' '));
}
