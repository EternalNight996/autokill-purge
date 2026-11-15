// 知识库：直接读 dsh-purge 的 ~/.dsh/redteam/knowledge.db（SQLite，14225 POC + 169 笔记）。
//
// 只读打开（readOnly: true），不做任何写入 —— 写库仍归 dsh-purge 自己（它的 kb_note / poc 工具）。
// 用 Node 24 内置的 node:sqlite，零依赖。
import { DatabaseSync } from 'node:sqlite';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

function dbPath() {
  const home = process.env.DSH_HOME || join(process.env.USERPROFILE || '', '.dsh');
  return join(home, 'redteam', 'knowledge.db');
}

let cached = null;
function open() {
  const file = dbPath();
  if (!existsSync(file)) throw new Error('知识库不存在：' + file);
  if (cached && cached.file === file) return cached.db;
  const db = new DatabaseSync(file, { readOnly: true });
  cached = { file: file, db: db };
  return db;
}

const clip = (s, n) => {
  const t = String(s == null ? '' : s);
  return t.length > n ? t.slice(0, n) + '\n…（已截断，共 ' + t.length + ' 字符）' : t;
};

export function kbStats() {
  const file = dbPath();
  if (!existsSync(file)) return { ok: false, error: 'kb_missing', path: file };
  const db = open();
  const poc = db.prepare('SELECT COUNT(*) AS n FROM poc').get().n;
  const notes = db.prepare('SELECT COUNT(*) AS n FROM kb_note').get().n;
  const verified = db.prepare('SELECT COUNT(*) AS n FROM poc WHERE verified = 1').get().n;
  const byCategory = db.prepare('SELECT category, COUNT(*) AS n FROM poc GROUP BY category ORDER BY n DESC').all();
  const bySource = db.prepare('SELECT source, COUNT(*) AS n FROM poc GROUP BY source ORDER BY n DESC LIMIT 12').all();
  const noteSources = db.prepare('SELECT source, COUNT(*) AS n FROM kb_note GROUP BY source ORDER BY n DESC').all();
  return {
    ok: true, path: file, bytes: statSync(file).size,
    poc: poc, notes: notes, verified: verified,
    byCategory: byCategory, bySource: bySource, noteSources: noteSources,
  };
}

export function searchPoc({ q = '', category = '', limit = 30 } = {}) {
  const db = open();
  const n = Math.min(Math.max(Number(limit) || 30, 1), 200);
  const where = [];
  const args = [];
  if (q) {
    where.push('(title LIKE ? OR component LIKE ? OR cve LIKE ? OR description LIKE ? OR tags LIKE ?)');
    const like = '%' + q + '%';
    args.push(like, like, like, like, like);
  }
  if (category) { where.push('category = ?'); args.push(category); }
  const sql = 'SELECT id, code, title, kind, category, cve, component, severity, language, source, verified, hit_count, updated_at FROM poc'
    + (where.length ? ' WHERE ' + where.join(' AND ') : '')
    + ' ORDER BY (verified = 1) DESC, hit_count DESC, id DESC LIMIT ' + n;
  const rows = db.prepare(sql).all(...args);
  return { ok: true, q: q, category: category, count: rows.length, items: rows };
}

export function readPoc(id) {
  const db = open();
  const row = db.prepare('SELECT * FROM poc WHERE id = ?').get(Number(id));
  if (!row) return { ok: false, error: 'not_found', id: id };
  return {
    ok: true,
    item: Object.assign({}, row, {
      content: clip(row.content, 20000),
      description: clip(row.description, 4000),
      usage: clip(row.usage, 4000),
    }),
  };
}

export function searchNotes({ q = '', source = '', limit = 30 } = {}) {
  const db = open();
  const n = Math.min(Math.max(Number(limit) || 30, 1), 200);
  const where = [];
  const args = [];
  if (q) { where.push('(title LIKE ? OR body LIKE ? OR tags LIKE ?)'); const like = '%' + q + '%'; args.push(like, like, like); }
  if (source) { where.push('source = ?'); args.push(source); }
  const sql = 'SELECT id, source, kind, title, url, author, posted_at, tags FROM kb_note'
    + (where.length ? ' WHERE ' + where.join(' AND ') : '')
    + ' ORDER BY id DESC LIMIT ' + n;
  const rows = db.prepare(sql).all(...args);
  return { ok: true, q: q, source: source, count: rows.length, items: rows };
}

export function readNote(id) {
  const db = open();
  const row = db.prepare('SELECT * FROM kb_note WHERE id = ?').get(Number(id));
  if (!row) return { ok: false, error: 'not_found', id: id };
  return { ok: true, item: Object.assign({}, row, { body: clip(row.body, 20000) }) };
}

/** 最近更新的一批 POC（按 id 倒序），用于首页概览 */
export function recentPoc(limit = 8) {
  const db = open();
  const n = Math.min(Math.max(Number(limit) || 8, 1), 50);
  const rows = db.prepare('SELECT id, code, title, category, cve, component, severity, verified FROM poc ORDER BY id DESC LIMIT ' + n).all();
  return { ok: true, items: rows };
}
