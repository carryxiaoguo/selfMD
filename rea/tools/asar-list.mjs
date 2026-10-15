// Minimal ASAR reader: lists entries (and optionally extracts one file).
// Usage: node asar-list.mjs <archive.asar> [--grep <substr>] [--extract <inner/path> <outfile>]
import fs from 'node:fs';
import path from 'node:path';

const [archive, ...rest] = process.argv.slice(2);
if (!archive) { console.error('usage: asar-list.mjs <archive> [--grep s] [--extract p out]'); process.exit(2); }

const fd = fs.openSync(archive, 'r');
// asar: pickle header
// [0..3] uint32 = 4 (size of next pickle payload)
// [4..7] uint32 = header string size + padding info
// [8..11] uint32 = header json size
// [12..15] uint32 = header json string length
// [16..]  header json
const sizeBuf = Buffer.alloc(16);
fs.readSync(fd, sizeBuf, 0, 16, 0);
const headerJsonSize = sizeBuf.readUInt32LE(12);
const jsonBuf = Buffer.alloc(headerJsonSize);
fs.readSync(fd, jsonBuf, 0, headerJsonSize, 16);
const header = JSON.parse(jsonBuf.toString('utf8'));
const baseOffset = 8 + sizeBuf.readUInt32LE(4);
const dataStart = 16 + headerJsonSize;

const entries = [];
(function walk(node, prefix) {
  for (const [name, val] of Object.entries(node.files || {})) {
    const p = prefix ? `${prefix}/${name}` : name;
    if (val.files) walk(val, p);
    else entries.push({ path: p, size: val.size ?? 0, offset: val.offset != null ? Number(val.offset) : null, unpacked: !!val.unpacked });
  }
})(header, '');

entries.sort((a, b) => b.size - a.size);

const grepIdx = rest.indexOf('--grep');
if (grepIdx >= 0) {
  const needle = rest[grepIdx + 1];
  for (const e of entries) if (e.path.includes(needle)) console.log(`${String(e.size).padStart(11)}  ${e.path}${e.unpacked ? '  [unpacked]' : ''}`);
  process.exit(0);
}
const exIdx = rest.indexOf('--extract');
if (exIdx >= 0) {
  const inner = rest[exIdx + 1].replace(/\\/g, '/');
  const out = rest[exIdx + 2];
  const e = entries.find((x) => x.path === inner);
  if (!e) { console.error('not found: ' + inner); process.exit(1); }
  if (e.unpacked) {
    const src = path.join(archive + '.unpacked', inner);
    fs.copyFileSync(src, out);
    console.error(`copied unpacked ${src} -> ${out}`);
    process.exit(0);
  }
  const buf = Buffer.alloc(e.size);
  fs.readSync(fd, buf, 0, e.size, dataStart + e.offset);
  fs.writeFileSync(out, buf);
  console.error(`extracted ${inner} (${e.size} bytes) -> ${out}`);
  process.exit(0);
}

console.log(`# ${archive}: ${entries.length} files, header ${headerJsonSize}B, dataStart ${dataStart}`);
for (const e of entries) console.log(`${String(e.size).padStart(11)}  ${e.path}${e.unpacked ? '  [unpacked]' : ''}`);
