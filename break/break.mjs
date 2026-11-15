// break: the hands of the gear. AutoKill reads a target; this decides where to cut, cuts a copy,
// and proves what changed. It never edits the original in place.
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { readPe, rvaToFile, fileToRva } from './pe.mjs';

const KEYWORDS = ['licen', 'serial', 'activat', 'regist', 'trial', 'expire', 'valid', 'signature', 'verif', 'auth', 'token', 'hwid', 'subscri', 'entitle', 'unlock', 'purchase'];

function sha(buf) { return createHash('sha256').update(buf).digest('hex'); }
function hx(n) { return '0x' + Number(n).toString(16).toUpperCase(); }
function bytesOf(text) { return Buffer.from(String(text).replace(/[^0-9a-fA-F]/g, ''), 'hex'); }

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

// x64: 48 8D 0D/15 rel32 (lea) and 48 8B 0D/15 (mov) referencing [rip+disp]
function refScan(buf, pe, targetVa) {
  const hits = [];
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
      if (va === targetVa) hits.push({ fileOffset: i, section: s.name });
    }
  }
  return hits;
}

function info(file) {
  const buf = readFileSync(file);
  const pe = readPe(buf);
  return {
    file: file, bytes: buf.length, sha256: sha(buf), machine: pe.machineName,
    imageBase: hx(pe.imageBase), entryRva: hx(pe.entryRva), dotnet: pe.dotnet,
    sections: pe.sections.map((s) => ({ name: s.name, vaddr: hx(s.vaddr), rawPtr: hx(s.rawPtr), rawSize: s.rawSize, vsize: s.vsize, entropy: s.entropy, executable: s.executable })),
    packingSignals: pe.packed
  };
}

function scan(file, keywords, minLen) {
  const buf = readFileSync(file);
  const pe = readPe(buf);
  const words = keywords && keywords.length ? keywords.map((k) => k.toLowerCase()) : KEYWORDS;
  const strings = asciiStrings(buf, minLen).filter((s) => {
    const low = s.text.toLowerCase();
    return words.some((k) => low.includes(k));
  });
  const found = strings.slice(0, 200).map((s) => {
    const rva = fileToRva(pe, s.fileOffset);
    const va = rva == null ? null : pe.imageBase + rva;
    const refs = va == null ? [] : refScan(buf, pe, va);
    return { text: s.text.slice(0, 80), fileOffset: hx(s.fileOffset), refs: refs.length, refSites: refs.slice(0, 8).map((r) => hx(r.fileOffset)) };
  });
  found.sort((a, b) => b.refs - a.refs);
  return { file: file, strings: found.length, candidates: found.slice(0, 40), note: 'A reference site is where the code loads that string: where to look, not proof of a check.' };
}
function plan(file) {
  const s = scan(file, null, 6);
  const steps = [];
  for (const c of s.candidates.filter((x) => x.refs > 0).slice(0, 8)) {
    steps.push({
      string: c.text, at: c.fileOffset, refs: c.refs,
      proposals: [
        { id: 'nop-load', what: 'replace the 7-byte load with NOPs so the string is never read', command: 'break patch <file> --at ' + c.refSites[0] + ' --nop 7' },
        { id: 'invert-branch', what: 'flip the conditional jump that follows it, once AutoKill confirms a comparison', command: 'break invert <file> --at <offset>' }
      ]
    });
  }
  const next = steps.length
    ? 'Open AutoKill native_function_show at one of those offsets, confirm the comparison, then patch a copy.'
    : 'No licence string reached by code. Ask AutoKill for comparisons instead, then patch by explicit offset.';
  return { file: file, hasStrings: s.strings, steps: steps, next: next };
}

function backup(file, buf, at) {
  if (!Number.isFinite(at) || at < 0 || at >= buf.length) throw new Error('offset ' + hx(at) + ' is outside the file');
  const bak = file + '.bak';
  if (!existsSync(bak)) copyFileSync(file, bak);
  return bak;
}

function patch(file, at, expectHex, writeHex, nopLen) {
  const buf = readFileSync(file);
  const bak = backup(file, buf, at);
  const before = Buffer.from(buf);
  let write;
  if (writeHex) write = bytesOf(writeHex);
  else if (nopLen) write = Buffer.alloc(nopLen, 0x90);
  else throw new Error('nothing to write: pass --write HEX or --nop N');
  if (at + write.length > buf.length) throw new Error('the write runs past the end of the file');
  if (expectHex) {
    const expect = bytesOf(expectHex);
    const actual = buf.subarray(at, at + expect.length);
    if (!actual.equals(expect)) throw new Error('expected ' + expect.toString('hex').toUpperCase() + ' at ' + hx(at) + ', found ' + actual.toString('hex').toUpperCase() + ' - nothing written');
  }
  write.copy(buf, at);
  writeFileSync(file, buf);
  return { file: file, backup: bak, at: hx(at), from: before.subarray(at, at + write.length).toString('hex').toUpperCase(), to: write.toString('hex').toUpperCase(), shaBefore: sha(before), shaAfter: sha(buf) };
}

const JCC = { 0x74: 0x75, 0x75: 0x74, 0x7c: 0x7d, 0x7d: 0x7c, 0x7e: 0x7f, 0x7f: 0x7e, 0x72: 0x73, 0x73: 0x72, 0x76: 0x77, 0x77: 0x76, 0x78: 0x79, 0x79: 0x78 };

function invert(file, at) {
  const buf = readFileSync(file);
  backup(file, buf, at);
  const before = Buffer.from(buf);
  const op = buf[at];
  if (op === 0x0f && JCC[buf[at + 1]]) {
    buf[at + 1] = JCC[buf[at + 1]];
    writeFileSync(file, buf);
    return { file: file, at: hx(at), was: hx(0x0f) + ' ' + hx(before[at + 1]), now: hx(0x0f) + ' ' + hx(buf[at + 1]), shaBefore: sha(before), shaAfter: sha(buf) };
  }
  if (!JCC[op]) throw new Error('the byte at ' + hx(at) + ' is ' + hx(op) + ', not a conditional jump (74/75, 7C/7D, 0F 84/85 ...)');
  buf[at] = JCC[op];
  writeFileSync(file, buf);
  return { file: file, at: hx(at), was: hx(op), now: hx(buf[at]), shaBefore: sha(before), shaAfter: sha(buf) };
}

function verify(a, b) {
  const A = readFileSync(a);
  const B = readFileSync(b);
  const n = Math.min(A.length, B.length);
  const diffs = [];
  for (let i = 0; i < n; i++) {
    if (A[i] !== B[i]) {
      diffs.push({ at: hx(i), before: A[i].toString(16).padStart(2, '0'), after: B[i].toString(16).padStart(2, '0') });
      if (diffs.length >= 50) break;
    }
  }
  return { before: { file: a, bytes: A.length, sha256: sha(A) }, after: { file: b, bytes: B.length, sha256: sha(B) }, same: sha(A) === sha(B), differingBytes: diffs.length, diffs: diffs };
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

const HELP = [
  'break - cut a licence check out of a copy, and say exactly what changed',
  '',
  '  break info <file>                                    PE layout, section entropy, packing signals',
  '  break scan <file> [--keywords a,b] [--min-len 6]     licence-looking strings and their code references',
  '  break plan <file>                                    ranked candidates with byte-level proposals',
  '  break patch <file> --at 0xOFF (--write HEX | --nop N) [--expect HEX]',
  '  break invert <file> --at 0xOFF                       flip a conditional jump (74/75, 0F 84/85 ...)',
  '  break verify <before> <after>                        sha256 and the differing bytes',
  '  break restore <file>                                 copy <file>.bak back over the file',
  '',
  'Offsets are file offsets. The first cut copies the file to <file>.bak, so nothing is lost.'
].join('\n');

const a = parseArgs(process.argv.slice(2));
const cmd = a._[0];
const file = a._[1];
const num = (v) => (v === undefined ? NaN : Number(v));

try {
  let out;
  if (!cmd || cmd === 'help' || a.help) { console.log(HELP); process.exit(0); }
  if (cmd === 'info') out = info(file);
  else if (cmd === 'scan') out = scan(file, a.keywords ? String(a.keywords).split(',') : null, num(a['min-len']) || 6);
  else if (cmd === 'plan') out = plan(file);
  else if (cmd === 'patch') out = patch(file, num(a.at), a.expect, a.write, num(a.nop));
  else if (cmd === 'invert') out = invert(file, num(a.at));
  else if (cmd === 'verify') out = verify(file, a._[2]);
  else if (cmd === 'restore') { copyFileSync(file + '.bak', file); out = { restored: file, from: file + '.bak' }; }
  else throw new Error('unknown command: ' + cmd + ' (try break help)');
  console.log(JSON.stringify(out, null, 2));
} catch (e) {
  console.error('break: ' + (e && e.message ? e.message : e));
  process.exit(1);
}
