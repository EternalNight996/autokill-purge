#!/usr/bin/env node
// make-7s-fixture.mjs — reproduce a >=7-section PE fixture for AC-3.1 (option (a)).
// Copies _smoke/sample.exe -> _smoke/sample-7s.exe and appends one `.test` section.
// The original sample.exe is NEVER read-modified; only the copy is written.
//
// PE edits (all read from the file, nothing hardcoded):
//   COFF NumberOfSections (e_lfanew+6)  += 1
//   one 40-byte section header at end of section table:
//     Name ".test", VirtualSize = SizeOfRawData = FileAlignment,
//     VirtualAddress = alignUp(SizeOfImage, SectionAlignment),
//     PointerToRawData = alignUp(fileSize, FileAlignment),
//     Characteristics = 0xC0000040 (READ|WRITE|CNT_INITIALIZED_DATA)
//   SizeOfImage (optOff+56)             = alignUp(newVAddr + vsize, SectionAlignment)
//   SizeOfInitializedData (optOff+8)    += SizeOfRawData
//   file tail padded with zeros to cover the new raw range.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, '_smoke', 'sample.exe');
const DST = join(ROOT, '_smoke', 'sample-7s.exe');

const alignUp = (v, a) => Math.ceil(v / a) * a;
const hx = (n) => '0x' + n.toString(16);
function fail(msg) { console.error('make-7s-fixture: ' + msg); process.exit(1); }

if (!existsSync(SRC)) fail('source _smoke/sample.exe missing');

const buf = readFileSync(SRC);

const e_lfanew = buf.readUInt32LE(0x3c);
if (buf.readUInt32LE(e_lfanew) !== 0x00004550) fail('no PE signature at e_lfanew');
const numSections = buf.readUInt16LE(e_lfanew + 6);
const optSize = buf.readUInt16LE(e_lfanew + 20);
const optOff = e_lfanew + 24;
const magic = buf.readUInt16LE(optOff);
if (magic !== 0x20b && magic !== 0x10b) fail('unexpected optional-header magic ' + hx(magic));

const sectionAlignment = buf.readUInt32LE(optOff + 32);
const fileAlignment = buf.readUInt32LE(optOff + 36);
const sizeOfImage = buf.readUInt32LE(optOff + 56);
const sizeOfInitData = buf.readUInt32LE(optOff + 8);
const secOff = optOff + optSize;

const firstRawPtr = buf.readUInt32LE(secOff + 20);
const tableEnd = secOff + numSections * 40;
if (tableEnd + 40 > firstRawPtr) {
  fail('no room for a section header: table end ' + hx(tableEnd) + ' + 40 > firstRawPtr ' + hx(firstRawPtr));
}

const virtualSize = fileAlignment;
const virtualAddress = alignUp(sizeOfImage, sectionAlignment);
const sizeOfRawData = fileAlignment;
const pointerToRawData = alignUp(buf.length, fileAlignment);
const characteristics = 0xC0000040;

const out = Buffer.concat([buf, Buffer.alloc(pointerToRawData + sizeOfRawData - buf.length)]);

// write the new 40-byte section header
const h = tableEnd;
out.write('.test\0\0\0', h, 'latin1');      // Name [0..8)
out.writeUInt32LE(virtualSize, h + 8);      // VirtualSize
out.writeUInt32LE(virtualAddress, h + 12);  // VirtualAddress
out.writeUInt32LE(sizeOfRawData, h + 16);   // SizeOfRawData
out.writeUInt32LE(pointerToRawData, h + 20); // PointerToRawData
out.writeUInt32LE(0, h + 24);               // PointerToRelocations
out.writeUInt32LE(0, h + 28);               // PointerToLinenumbers
out.writeUInt16LE(0, h + 32);               // NumberOfRelocations
out.writeUInt16LE(0, h + 34);               // NumberOfLinenumbers
out.writeUInt32LE(characteristics, h + 36); // Characteristics

out.writeUInt16LE(numSections + 1, e_lfanew + 6); // NumberOfSections += 1

const newSizeOfImage = alignUp(virtualAddress + virtualSize, sectionAlignment);
out.writeUInt32LE(newSizeOfImage, optOff + 56);             // SizeOfImage
out.writeUInt32LE(sizeOfInitData + sizeOfRawData, optOff + 8); // SizeOfInitializedData

writeFileSync(DST, out);

console.log('wrote ' + DST);
console.log('  sections: ' + numSections + ' -> ' + (numSections + 1));
console.log('  .test: vaddr=' + hx(virtualAddress) + ' vsize=' + hx(virtualSize)
  + ' rawPtr=' + hx(pointerToRawData) + ' rawSize=' + hx(sizeOfRawData));
console.log('  SizeOfImage: ' + hx(sizeOfImage) + ' -> ' + hx(newSizeOfImage));
console.log('  SizeOfInitializedData: ' + hx(sizeOfInitData) + ' -> ' + hx(sizeOfInitData + sizeOfRawData));
console.log('  file size: ' + buf.length + ' -> ' + out.length);
