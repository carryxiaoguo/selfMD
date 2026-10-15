// Focused probes against main.node: engine markers, IPC channel names, delay imports.
import fs from 'node:fs';

const file = process.argv[2];
const b = fs.readFileSync(file);
const s8 = b.toString('latin1');
const s16 = b.toString('utf16le');

const markers = [
  'quickjs', 'QuickJS', 'duktape', 'Duktape', 'jerry', 'JerryScript', 'hermes', 'Hermes',
  'v8::', 'V8', 'node::', 'napi_', 'node_api', 'NODE_MODULE', 'electron', 'Electron',
  'ipcMain', 'ipcRenderer', 'ipc.', 'BYTECODE', 'bytecode', 'snapshot', 'Snapshot',
  'app.download', 'showOpenDialog', 'trashItem', 'showInFinder', 'imageUploader',
  'typora-user-images', 'picgo', 'uPic', 'mermaid', 'pandoc', 'sqlite', 'SQLite',
  'js_error', 'JS_Eval', 'JS_NewRuntime', 'embedder', 'source_hash',
];
console.log('=== marker scan (utf8 latin1) ===');
for (const m of markers) {
  const c8 = s8.split(m).length - 1;
  const c16 = s16.split(m).length - 1;
  if (c8 || c16) console.log(`  ${m.padEnd(22)} utf8=${c8} utf16le=${c16}`);
}
console.log('=== markers NOT found ===');
console.log('  ' + markers.filter((m) => !s8.includes(m) && !s16.includes(m)).join(', '));

// delay imports
function ent(buf) { if (!buf.length) return 0; const f = new Array(256).fill(0); for (const x of buf) f[x]++; let h = 0; for (const c of f) { if (!c) continue; const p = c / buf.length; h -= p * Math.log2(p); } return h; }
console.log(`=== .data entropy check ===`);
const pe = b.readUInt32LE(0x3c);
const optsz = b.readUInt16LE(pe + 20);
const secOff = pe + 24 + optsz;
const nsec = b.readUInt16LE(pe + 6);
const secs = [];
for (let i = 0; i < nsec; i++) {
  const o = secOff + i * 40;
  secs.push({ name: b.toString('latin1', o, o + 8).replace(/\0+$/, ''), vaddr: b.readUInt32LE(o + 12), vsize: b.readUInt32LE(o + 8), rawptr: b.readUInt32LE(o + 20), rawsize: b.readUInt32LE(o + 16) });
}
function rvaToOff(rva) { for (const s of secs) if (rva >= s.vaddr && rva < s.vaddr + Math.max(s.vsize, s.rawsize)) return s.rawptr + (rva - s.vaddr); return null; }
const ddOff = pe + 24 + (b.readUInt16LE(pe + 24) === 0x20b ? 112 : 96);

// delay import descriptor: attrs(4) nameRva(4) moduleHandle(4) iat(4) int(4) boundIat(4) unloadIat(4) timestamp(4)
const diRva = b.readUInt32LE(ddOff + 13 * 8);
let o = rvaToOff(diRva);
if (o) {
  console.log('=== delay imports ===');
  for (let k = 0; k < 20 && o; k++) {
    const attrs = b.readUInt32LE(o);
    const nameRva = b.readUInt32LE(o + 4);
    const intRva = b.readUInt32LE(o + 16);
    if (!attrs && !nameRva) break;
    const no = rvaToOff(nameRva);
    const dll = no != null ? b.toString('ascii', no, b.indexOf(0, no)) : '?';
    const funcs = [];
    let to = rvaToOff(intRva);
    for (let j = 0; to && j < 3000; j++) {
      const v = Number(b.readBigUInt64LE(to));
      if (v === 0) break;
      if ((BigInt(v) & 0x8000000000000000n) !== 0n) funcs.push('#' + (v & 0xffff));
      else { const fo = rvaToOff(v); funcs.push(fo != null ? b.toString('ascii', fo + 2, b.indexOf(0, fo + 2)) : '?'); }
      to += 8;
    }
    console.log(`  ${dll} (${funcs.length}):`);
    console.log('    ' + funcs.join(', '));
    o += 32;
  }
}
