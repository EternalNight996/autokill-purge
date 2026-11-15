// Minimal PE reader: enough to place a patch, not a disassembler.
// Every number here comes from the file; nothing is guessed.

export function readPe(buf) {
  if (buf.length < 0x100 || buf.readUInt16LE(0) !== 0x5a4d) throw new Error('not a PE: no MZ signature');
  const peOff = buf.readUInt32LE(0x3c);
  if (peOff + 24 > buf.length || buf.readUInt32LE(peOff) !== 0x00004550) throw new Error('not a PE: no PE\0\0 signature');
  const machine = buf.readUInt16LE(peOff + 4);
  const sections = buf.readUInt16LE(peOff + 6);
  const optSize = buf.readUInt16LE(peOff + 20);
  const optOff = peOff + 24;
  const magic = buf.readUInt16LE(optOff);
  const pe32plus = magic === 0x20b;
  const entryRva = buf.readUInt32LE(optOff + 16);
  const imageBase = pe32plus ? Number(buf.readBigUInt64LE(optOff + 24)) : buf.readUInt32LE(optOff + 28);
  const dirsOff = optOff + (pe32plus ? 112 : 96);
  const clrRva = dirsOff + 14 * 8 <= optOff + optSize ? buf.readUInt32LE(dirsOff + 14 * 8) : 0;
  const secOff = optOff + optSize;
  const list = [];
  for (let i = 0; i < sections; i++) {
    const o = secOff + i * 40;
    const name = buf.toString('latin1', o, o + 8).replace(/\0+$/, '');
    const vsize = buf.readUInt32LE(o + 8);
    const vaddr = buf.readUInt32LE(o + 12);
    const rawSize = buf.readUInt32LE(o + 16);
    const rawPtr = buf.readUInt32LE(o + 20);
    const chars = buf.readUInt32LE(o + 36);
    const bytes = buf.subarray(rawPtr, Math.min(buf.length, rawPtr + rawSize));
    list.push({ name, vaddr, vsize, rawPtr, rawSize, executable: (chars & 0x20000000) !== 0, writable: (chars & 0x80000000) !== 0, entropy: entropy(bytes), bytes: rawSize });
  }
  const machineName = { 0x8664: 'x86-64', 0x14c: 'x86', 0xaa64: 'arm64', 0x1c0: 'arm' }[machine] || ('0x' + machine.toString(16));
  return { machine, machineName, pe32plus, entryRva, imageBase, sections: list, dotnet: clrRva > 0, packed: packSignals(list) };
}

export function entropy(bytes) {
  if (!bytes.length) return 0;
  const counts = new Uint32Array(256);
  for (const b of bytes) counts[b]++;
  let h = 0;
  for (const c of counts) if (c) { const p = c / bytes.length; h -= p * Math.log2(p); }
  return Number(h.toFixed(3));
}

function packSignals(sections) {
  const signals = [];
  for (const s of sections) {
    if (s.executable && s.entropy > 7.2 && s.bytes > 4096) signals.push(s.name + ' is executable with entropy ' + s.entropy + ' (compressed or encrypted)');
    if (s.vsize > s.rawSize * 4 && s.vsize - s.rawSize > 0x2000) signals.push(s.name + ' reserves ' + (s.vsize - s.rawSize) + ' bytes past its raw data (unpacks at run time)');
  }
  return signals;
}

export function rvaToFile(pe, rva) {
  for (const s of pe.sections) {
    const span = Math.max(s.vsize, s.rawSize);
    if (rva >= s.vaddr && rva < s.vaddr + span) {
      const delta = rva - s.vaddr;
      if (delta >= s.rawSize) return null;
      return s.rawPtr + delta;
    }
  }
  return null;
}

export function fileToRva(pe, off) {
  for (const s of pe.sections) {
    if (off >= s.rawPtr && off < s.rawPtr + s.rawSize) return s.vaddr + (off - s.rawPtr);
  }
  return null;
}
