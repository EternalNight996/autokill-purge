// break: the hands of the gear. AutoKill reads a target; this decides where to cut, cuts a copy,
// and proves what changed. It never edits the original in place: the first cut saves <file>.bak.
//
// Output contract (REQUIREMENTS.md v1.0, 5.1 / FR-8):
//   success -> {ok:true, command, file, ...}
//   error   -> {ok:false, error:{code, message, hint}}
// Exit codes: 0 success · 2 argument/usage · 3 expect mismatch · 4 not a PE · 5 locked/permission or unsafe restore.
//
// This file is both a CLI and a library: `run(command, args)` is exported for the web server, and
// running it directly (`node break.mjs ...`) exercises the CLI wrapper at the bottom.
import { readFileSync, writeFileSync, writeSync, copyFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPe, rvaToFile, fileToRva } from './pe.mjs';

const KEYWORDS = ['licen', 'serial', 'activat', 'regist', 'trial', 'expire', 'valid', 'signature', 'verif', 'auth', 'token', 'hwid', 'subscri', 'entitle', 'unlock', 'purchase'];

export class BreakError extends Error {
  constructor(code, message, hint) { super(message); this.code = code; this.hint = hint || ''; }
}

// The full argv of the command currently being run, for the journal's `argv` field. Set by run()
// before dispatch; synchronous, so no interleaving.
let currentArgv = [];

function sha(buf) { return createHash('sha256').update(buf).digest('hex'); }
function hx(n) { return '0x' + Number(n).toString(16).toUpperCase(); }
function hex2(b) { return b.toString(16).padStart(2, '0'); }

function bytesOf(text) {
  const clean = String(text).replace(/[^0-9a-fA-F]/g, '');
  if (clean.length === 0) throw new BreakError(2, 'empty hex value: ' + text, 'provide hex bytes, e.g. 488D15 or 90909090');
  if (clean.length % 2 !== 0) throw new BreakError(2, 'hex value has an odd number of digits: ' + text, 'each byte is exactly two hex digits');
  return Buffer.from(clean, 'hex');
}

function readTarget(file) {
  try {
    return readFileSync(file);
  } catch (e) {
    if (e.code === 'ENOENT') throw new BreakError(2, 'file not found: ' + file, 'check the path and try again');
    if (e.code === 'EACCES' || e.code === 'EPERM' || e.code === 'EBUSY') throw new BreakError(5, 'cannot read ' + file + ': ' + (e.message || e.code), 'close the file, or check its permissions');
    throw new BreakError(5, 'cannot read ' + file + ': ' + (e.message || e), '');
  }
}

function readPeOf(buf, file) {
  try {
    return readPe(buf);
  } catch (e) {
    throw new BreakError(4, String((e && e.message) || e), '当前只支持 PE：请提供 PE32/PE32+ 可执行文件');
  }
}

function writeAtomic(file, buf) {
  const tmp = file + '.tmp';
  writeFileSync(tmp, buf);
  renameSync(tmp, file);
}

function asciiStrings(buf, minLen) {
  const out = [];
  let start = -1;
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    const printable = b >= 0x20 && b <= 0x7e;
    if (printable) { if (start < 0) start = i; continue; }
    if (start >= 0 && i - start >= minLen) out.push({ fileOffset: start, text: buf.toString('latin1', start, i) });
    start = -1;
  }
  if (start >= 0 && buf.length - start >= minLen) out.push({ fileOffset: start, text: buf.toString('latin1', start, buf.length) });
  return out;
}

// One pass over the executable sections: build targetVA -> [{fileOffset, rva, instruction}].
// x64 RIP-relative loads only: 48 8D 0D/15 (lea) and 48 8B 0D/15 (mov) with a rel32 displacement.
function refIndex(buf, pe) {
  const map = new Map();
  for (const s of pe.sections) {
    if (!s.executable) continue;
    for (let i = s.rawPtr; i + 7 <= s.rawPtr + s.rawSize; i++) {
      if (buf[i] !== 0x48) continue;
      const op = buf[i + 1];
      const modrm = buf[i + 2];
      const ok = (op === 0x8d || op === 0x8b) && (modrm === 0x0d || modrm === 0x15);
      if (!ok) continue;
      const rel = buf.readInt32LE(i + 3);
      const rva = fileToRva(pe, i);
      if (rva == null) continue;
      const va = pe.imageBase + rva + 7 + rel;
      const entry = { fileOffset: i, rva: rva, instruction: buf.subarray(i, i + 7).toString('hex').toUpperCase() };
      const list = map.get(va) || [];
      list.push(entry);
      map.set(va, list);
    }
  }
  return map;
}

export function info(file) {
  const buf = readTarget(file);
  const pe = readPeOf(buf, file);
  return {
    ok: true, command: 'info', file: file, sha256: sha(buf),
    format: pe.pe32plus ? 'PE32+' : 'PE32', machine: pe.machineName,
    imageBase: hx(pe.imageBase), entryRva: hx(pe.entryRva), dotnet: pe.dotnet,
    sections: pe.sections.map((s) => ({ name: s.name, size: s.rawSize, vaddr: hx(s.vaddr), rawPtr: hx(s.rawPtr), vsize: s.vsize, entropy: s.entropy, executable: s.executable })),
    packerHints: pe.packed
  };
}

export function scan(file, keywords, minLen, minXrefs) {
  const buf = readTarget(file);
  const pe = readPeOf(buf, file);
  const words = keywords && keywords.length ? keywords.map((k) => k.toLowerCase()) : KEYWORDS;
  const matched = asciiStrings(buf, minLen).filter((s) => {
    const low = s.text.toLowerCase();
    return words.some((k) => low.includes(k));
  });
  const index = refIndex(buf, pe);
  const hits = matched.map((s) => {
    const rva = fileToRva(pe, s.fileOffset);
    const va = rva == null ? null : pe.imageBase + rva;
    const refs = va == null ? [] : (index.get(va) || []);
    return {
      string: s.text.slice(0, 80),
      offset: hx(s.fileOffset),
      xrefs: refs.map((r) => ({ rva: hx(r.rva), fileOffset: hx(r.fileOffset), instruction: r.instruction }))
    };
  });
  hits.sort((a, b) => b.xrefs.length - a.xrefs.length);
  const threshold = Number(minXrefs) || 0;
  const filtered = hits.filter((h) => h.xrefs.length >= threshold);
  const out = {
    ok: true, command: 'scan', file: file, matched: matched.length, minXrefs: threshold, hits: filtered,
    note: 'A reference site is where the code loads that string: where to look, not proof of a check.'
  };
  if (filtered.length > 1000) {
    out.hits = filtered.slice(0, 1000);
    out.truncated = true;
  }
  return out;
}

export function plan(file, stringFilter) {
  const s = scan(file, null, 6, 0);
  const want = stringFilter ? String(stringFilter).toLowerCase() : null;
  const candidates = [];
  for (const h of s.hits) {
    if (h.xrefs.length === 0) continue;
    if (want && !h.string.toLowerCase().includes(want)) continue;
    const site = h.xrefs[0];
    const refs = h.xrefs.length;
    const confidence = Math.round(Math.min(0.75, 0.4 + refs * 0.05) * 100) / 100;
    candidates.push({
      offset: site.fileOffset,
      expect: site.instruction,
      suggest: '90909090909090',
      reason: "code loads the string '" + h.string.slice(0, 48) + "' here (" + refs + ' reference site(s) total)',
      confidence: confidence,
      string: h.string,
      refs: refs
    });
    if (candidates.length >= 8) break;
  }
  const note = candidates.length
    ? 'Each candidate is a byte-level proposal. It is where the code reads a licence-looking string — confirm the compare-and-branch in AutoKill (step 3) before patching a copy.'
    : 'No licence string reached by code' + (want ? ' matching "' + stringFilter + '"' : '') + '. Ask AutoKill for comparisons instead, then patch by explicit offset.';
  return { ok: true, command: 'plan', file: file, filter: stringFilter || null, candidates: candidates, note: note };
}

function ensureBackup(file, buf, at) {
  if (!Number.isFinite(at) || at < 0 || at >= buf.length) throw new BreakError(2, 'offset ' + hx(at) + ' is outside the file (0..' + hx(buf.length) + ')', 'pass a file offset inside the file');
  const bak = file + '.bak';
  if (!existsSync(bak)) {
    const tmp = bak + '.tmp';
    copyFileSync(file, tmp);
    renameSync(tmp, bak);
  }
  return bak;
}

// Append one job line to <file>.purge/journal.jsonl atomically (temp file + rename).
export function journalPathOf(file) { return join(file + '.purge', 'journal.jsonl'); }

export function appendJournal(file, entry) {
  const dir = file + '.purge';
  mkdirSync(dir, { recursive: true });
  const jpath = join(dir, 'journal.jsonl');
  let lines = [];
  try { lines = readFileSync(jpath, 'utf8').split('\n').filter((l) => l.trim()); } catch { /* first write */ }
  lines.push(JSON.stringify(Object.assign({ at: new Date().toISOString() }, entry)));
  const tmp = jpath + '.tmp';
  writeFileSync(tmp, lines.join('\n') + '\n', 'utf8');
  renameSync(tmp, jpath);
}

export function readJournal(file) {
  try {
    const raw = readFileSync(journalPathOf(file), 'utf8');
    return raw.split('\n').filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

export function patch(file, at, expectHex, writeHex, nopLen) {
  const buf = readTarget(file);
  const bak = ensureBackup(file, buf, at);
  const before = Buffer.from(buf);
  let write;
  if (writeHex) write = bytesOf(writeHex);
  else if (nopLen) write = Buffer.alloc(nopLen, 0x90);
  else throw new BreakError(2, 'nothing to write: pass --write HEX or --nop N', 'provide the bytes to write, or a NOP count');
  if (at + write.length > buf.length) throw new BreakError(2, 'the write runs past the end of the file', 'shorten the write, or choose a smaller --at');
  if (expectHex) {
    const expect = bytesOf(expectHex);
    const actual = buf.subarray(at, at + expect.length);
    if (!actual.equals(expect)) {
      throw new BreakError(3, 'expected ' + expect.toString('hex').toUpperCase() + ' at ' + hx(at) + ', found ' + actual.toString('hex').toUpperCase() + ' - nothing written', 're-check the offset and the bytes; the file is unchanged');
    }
  }
  write.copy(buf, at);
  writeAtomic(file, buf);
  appendJournal(file, {
    command: 'patch', offset: at, before: before.subarray(at, at + write.length).toString('hex').toUpperCase(), after: write.toString('hex').toUpperCase(),
    sha_before: sha(before), sha_after: sha(buf), expect: expectHex || null, argv: currentArgv
  });
  return {
    ok: true, command: 'patch', file: file, offset: hx(at),
    before: before.subarray(at, at + write.length).toString('hex').toUpperCase(), after: write.toString('hex').toUpperCase(),
    shaBefore: sha(before), shaAfter: sha(buf), backup: bak
  };
}

const JCC_FLIP = { 0x74: 0x75, 0x75: 0x74, 0x7c: 0x7d, 0x7d: 0x7c, 0x7e: 0x7f, 0x7f: 0x7e, 0x72: 0x73, 0x73: 0x72, 0x76: 0x77, 0x77: 0x76, 0x78: 0x79, 0x79: 0x78, 0x84: 0x85, 0x85: 0x84, 0x8c: 0x8d, 0x8d: 0x8c, 0x8e: 0x8f, 0x8f: 0x8e, 0x82: 0x83, 0x83: 0x82, 0x86: 0x87, 0x87: 0x86 };
const JCC_NAME = { 0x74: 'jz', 0x75: 'jnz', 0x7c: 'jl', 0x7d: 'jge', 0x7e: 'jle', 0x7f: 'jg', 0x72: 'jb', 0x73: 'jae', 0x76: 'jbe', 0x77: 'ja', 0x78: 'js', 0x79: 'jns', 0x84: 'jz', 0x85: 'jnz', 0x8c: 'jl', 0x8d: 'jge', 0x8e: 'jle', 0x8f: 'jg', 0x82: 'jb', 0x83: 'jae', 0x86: 'jbe', 0x87: 'ja' };

export function invert(file, at) {
  const buf = readTarget(file);
  const bak = ensureBackup(file, buf, at);
  const before = Buffer.from(buf);
  let beforeHex, afterHex, from, to;
  if (buf[at] === 0x0f && JCC_FLIP[buf[at + 1]]) {
    from = JCC_NAME[buf[at + 1]];
    buf[at + 1] = JCC_FLIP[buf[at + 1]];
    to = JCC_NAME[buf[at + 1]];
    beforeHex = '0F ' + hex2(before[at + 1]).toUpperCase();
    afterHex = '0F ' + hex2(buf[at + 1]).toUpperCase();
  } else if (JCC_FLIP[buf[at]]) {
    from = JCC_NAME[buf[at]];
    buf[at] = JCC_FLIP[buf[at]];
    to = JCC_NAME[buf[at]];
    beforeHex = hex2(before[at]).toUpperCase();
    afterHex = hex2(buf[at]).toUpperCase();
  } else {
    throw new BreakError(3, 'the byte at ' + hx(at) + ' is ' + hex2(buf[at]).toUpperCase() + ', not a conditional jump (74/75, 7C/7D, 0F 84/85 ...)', 'point --at at a Jcc instruction to flip');
  }
  writeAtomic(file, buf);
  appendJournal(file, {
    command: 'invert', offset: at, before: beforeHex, after: afterHex,
    sha_before: sha(before), sha_after: sha(buf), expect: null, argv: currentArgv
  });
  return { ok: true, command: 'invert', file: file, offset: hx(at), before: beforeHex, after: afterHex, from: from, to: to, shaBefore: sha(before), shaAfter: sha(buf), backup: bak };
}

export function verify(a, b) {
  const A = readTarget(a);
  const B = readTarget(b);
  const n = Math.min(A.length, B.length);
  let diffCount = Math.abs(A.length - B.length);
  const diffs = [];
  for (let i = 0; i < n; i++) {
    if (A[i] !== B[i]) {
      diffCount++;
      if (diffs.length < 50) diffs.push({ offset: hx(i), before: hex2(A[i]), after: hex2(B[i]) });
    }
  }
  return {
    ok: true, command: 'verify', files: { before: a, after: b },
    shaBefore: sha(A), shaAfter: sha(B), same: sha(A) === sha(B),
    differingBytes: diffCount, diffs: diffs, diffsTruncated: diffCount > 50
  };
}

export function restore(file) {
  const bak = file + '.bak';
  if (!existsSync(bak)) throw new BreakError(2, 'no backup found: ' + bak, 'patch or invert first to create <file>.bak');
  const bakBuf = readTarget(bak);
  const bakSha = sha(bakBuf);
  const entries = readJournal(file);
  const first = entries.length ? entries[0] : null;
  if (!first || typeof first.sha_before !== 'string') {
    throw new BreakError(5, 'cannot verify the backup: no journal (or no sha_before) at ' + journalPathOf(file), 'the journal is missing, so the backup cannot be proven intact; restore is refused');
  }
  if (first.sha_before !== bakSha) {
    throw new BreakError(5, 'backup integrity check failed: ' + bak + ' sha256 (' + bakSha + ') does not match the first journal sha_before (' + first.sha_before + ')', 'the backup was modified; restore is refused to protect the original bytes');
  }
  const curBuf = readTarget(file);
  const curSha = sha(curBuf);
  copyFileSync(bak, file);
  appendJournal(file, { command: 'restore', offset: null, before: null, after: null, sha_before: curSha, sha_after: bakSha, expect: null, argv: currentArgv });
  return { ok: true, command: 'restore', file: file, restoredFrom: bak, sha: bakSha, shaBefore: curSha };
}

export function journal(file) {
  const entries = readJournal(file);
  return { ok: true, command: 'journal', file: file, count: entries.length, entries: entries };
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
      out[k] = v;
    } else out._.push(a);
  }
  return out;
}

// Run one command against its remaining argv. The web server calls this directly (whitelist at the
// server), so the CLI and the API share exactly one implementation. Throws BreakError on failure.
export function run(command, argv) {
  const a = parseArgs(argv || []);
  currentArgv = [command, ...(argv || [])];
  const file = a._[0];
  const num = (v) => (v === undefined || v === 'true' || v === '' ? NaN : Number(v));
  switch (command) {
    case 'info':
      if (!file) throw new BreakError(2, 'info needs a file', 'usage: break info <file>');
      return info(file);
    case 'scan':
      if (!file) throw new BreakError(2, 'scan needs a file', 'usage: break scan <file> [--keywords a,b] [--min-xrefs N]');
      return scan(file, a.keywords ? String(a.keywords).split(',') : null, num(a['min-len']) || 6, num(a['min-xrefs']) || 0);
    case 'plan':
      if (!file) throw new BreakError(2, 'plan needs a file', 'usage: break plan <file> [--string S]');
      return plan(file, a.string);
    case 'patch':
      if (!file) throw new BreakError(2, 'patch needs a file', 'usage: break patch <file> --at 0xOFF (--write HEX | --nop N) [--expect HEX]');
      if (!Number.isFinite(num(a.at))) throw new BreakError(2, 'patch needs a numeric --at offset', 'usage: break patch <file> --at 0xA5638 --expect 488D15 --nop 7');
      return patch(file, num(a.at), a.expect, a.write, num(a.nop));
    case 'invert':
      if (!file) throw new BreakError(2, 'invert needs a file', 'usage: break invert <file> --at 0xOFF');
      if (!Number.isFinite(num(a.at))) throw new BreakError(2, 'invert needs a numeric --at offset', 'usage: break invert <file> --at 0xOFF');
      return invert(file, num(a.at));
    case 'verify':
      if (!file || !a._[1]) throw new BreakError(2, 'verify needs two files', 'usage: break verify <before> <after>');
      return verify(file, a._[1]);
    case 'restore':
      if (!file) throw new BreakError(2, 'restore needs a file', 'usage: break restore <file>');
      return restore(file);
    case 'journal':
      if (!file) throw new BreakError(2, 'journal needs a file', 'usage: break journal <file>');
      return journal(file);
    default:
      throw new BreakError(2, 'unknown command: ' + command + ' (try break help)', '');
  }
}

const HELP = [
  'break - cut a licence check out of a copy, and say exactly what changed',
  '',
  '  break info <file>                                     PE layout, section entropy, packing signals',
  '  break scan <file> [--keywords a,b] [--min-len 6] [--min-xrefs N]',
  '                                                        licence-looking strings and their code references',
  '  break plan <file> [--string S]                        ranked candidates with byte-level proposals',
  '  break patch <file> --at 0xOFF (--write HEX | --nop N) [--expect HEX]',
  '  break invert <file> --at 0xOFF                        flip a conditional jump (74/75, 0F 84/85 ...)',
  '  break verify <before> <after>                         sha256 and the differing bytes',
  '  break restore <file>                                  copy <file>.bak back over the file (validates .bak first)',
  '  break journal <file>                                  list the jobs recorded for <file>',
  '',
  'Offsets are file offsets. The first cut copies the file to <file>.bak, so nothing is lost.',
  'Jobs append to <file>.purge/journal.jsonl: {at, command, offset, before, after, sha_before, sha_after, expect, argv}.'
].join('\n');

function emit(obj) { writeSync(1, JSON.stringify(obj, null, 2) + '\n'); }

function cli(argv) {
  const cmd = argv[0];
  if (!cmd || cmd === 'help' || argv.includes('--help')) { writeSync(1, HELP + '\n'); return 0; }
  try {
    emit(run(cmd, argv.slice(1)));
    return 0;
  } catch (e) {
    if (e instanceof BreakError) {
      emit({ ok: false, error: { code: e.code, message: e.message, hint: e.hint || '' } });
      return e.code;
    }
    const code = (e && (e.code === 'EACCES' || e.code === 'EPERM' || e.code === 'EBUSY')) ? 5 : 2;
    emit({ ok: false, error: { code: code, message: String((e && e.message) || e), hint: '' } });
    return code;
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exit(cli(process.argv.slice(2)));
