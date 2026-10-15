// PE / binary triage for a .node native addon.
// Usage: node pe.mjs <file>
import fs from 'node:fs';

const file = process.argv[2];
const b = fs.readFileSync(file);
const log = (...a) => console.log(...a);

log(`file: ${file}`);
log(`size: ${b.length}`);

const s = b.toString('latin1');
const runs = s.match(/[ -~]{6,}/g) || [];
log(`ascii runs >=6: ${runs.length}`);
const interesting = runs.filter((r) => r.includes('.') || /^[A-Za-z_]{6,}$/.test(r));
log(`  long/symbolish sample: ${JSON.stringify([...runs].sort((a, c) => c.length - a.length).slice(0, 15))}`);

function ent(buf) {
  if (!buf || !buf.length) return 0;
  const f = new Array(256).fill(0);
  for (const x of buf) f[x]++;
  let h = 0;
  for (const c of f) { if (!c) continue; const p = c / buf.length; h -= p * Math.log2(p); }
  return h;
}
log(`whole-file entropy: ${ent(b).toFixed(3)} bits/byte`);

const mz = b[0] === 0x4d && b[1] === 0x5a;
log(`MZ: ${mz}`);
if (!mz) process.exit(0);

const pe = b.readUInt32LE(0x3c);
log(`e_lfanew: 0x${pe.toString(16)}  sig: ${JSON.stringify(b.toString('latin1', pe, pe + 4))}`);
const machine = b.readUInt16LE(pe + 4);
const nsec = b.readUInt16LE(pe + 6);
const tstamp = b.readUInt32LE(pe + 8);
const optsz = b.readUInt16LE(pe + 20);
const chars = b.readUInt16LE(pe + 22);
log(`machine: 0x${machine.toString(16)} (${machine === 0x8664 ? 'x64' : machine})  sections: ${nsec}  chars: 0x${chars.toString(16)} (DLL=${!!(chars & 0x2000)})`);
log(`timestamp: ${new Date(tstamp * 1000).toISOString()}`);

const optOff = pe + 24;
const magic = b.readUInt16LE(optOff);
const is64 = magic === 0x20b;
log(`optMagic: 0x${magic.toString(16)} (${is64 ? 'PE32+' : 'PE32'})`);
const ddOff = optOff + (is64 ? 112 : 96);
const dirs = ['export', 'import', 'resource', 'exception', 'security', 'basereloc', 'debug', 'arch', 'globalptr', 'tls', 'loadconfig', 'boundimport', 'iat', 'delayimport', 'clr', 'reserved'];
log('data directories:');
for (let i = 0; i < 16; i++) {
  const rva = b.readUInt32LE(ddOff + i * 8);
  const sz = b.readUInt32LE(ddOff + i * 8 + 4);
  if (rva || sz) log(`  ${dirs[i].padEnd(12)} rva=0x${rva.toString(16).padStart(8)} size=${sz}`);
}

const secOff = optOff + optsz;
const secs = [];
log('sections:');
for (let i = 0; i < nsec; i++) {
  const o = secOff + i * 40;
  const name = b.toString('latin1', o, o + 8).replace(/\0+$/, '');
  const vsize = b.readUInt32LE(o + 8);
  const vaddr = b.readUInt32LE(o + 12);
  const rawsize = b.readUInt32LE(o + 16);
  const rawptr = b.readUInt32LE(o + 20);
  const ch = b.readUInt32LE(o + 36);
  secs.push({ name, vaddr, vsize, rawptr, rawsize });
  const slice = rawsize ? b.subarray(rawptr, Math.min(rawptr + rawsize, b.length)) : null;
  log(`  ${name.padEnd(9)} vaddr=0x${vaddr.toString(16).padStart(7)} vsize=${String(vsize).padStart(8)} rawsize=${String(rawsize).padStart(8)} rawptr=0x${rawptr.toString(16).padStart(7)} ch=0x${ch.toString(16)} ent=${slice ? ent(slice).toFixed(2) : '-'}`);
}

function rvaToOff(rva) {
  for (const sec of secs) if (rva >= sec.vaddr && rva < sec.vaddr + Math.max(sec.vsize, sec.rawsize)) return sec.rawptr + (rva - sec.vaddr);
  return null;
}

// imports
const impRva = b.readUInt32LE(ddOff + 8);
const impSz = b.readUInt32LE(ddOff + 12);
if (impRva) {
  log('imports:');
  let off = rvaToOff(impRva);
  for (let k = 0; off && k < 200; k++) {
    const origFirst = b.readUInt32LE(off);
    const nameRva = b.readUInt32LE(off + 12);
    const firstThunk = b.readUInt32LE(off + 16);
    if (!origFirst && !nameRva && !firstThunk) break;
    const no = rvaToOff(nameRva);
    const dll = no != null ? b.toString('ascii', no, b.indexOf(0, no)) : '?';
    const funcs = [];
    const thunkRva = origFirst || firstThunk;
    let to = rvaToOff(thunkRva);
    for (let j = 0; to && j < 4000; j++) {
      const v = is64 ? Number(b.readBigUInt64LE(to)) : b.readUInt32LE(to);
      if (v === 0) break;
      const ordFlag = is64 ? 0x8000000000000000n : 0x80000000;
      if (is64 ? (BigInt(v) & ordFlag) !== 0n : (v & ordFlag) !== 0) funcs.push(`#${v & 0xffff}`);
      else { const fo = rvaToOff(v); funcs.push(fo != null ? b.toString('ascii', fo + 2, b.indexOf(0, fo + 2)) : '?'); }
      to += is64 ? 8 : 4;
    }
    log(`  ${dll} (${funcs.length}): ${funcs.slice(0, 40).join(', ')}${funcs.length > 40 ? ' ...' : ''}`);
    off += 20;
  }
}

// exports
const expRva = b.readUInt32LE(ddOff);
if (expRva) {
  const eo = rvaToOff(expRva);
  const nNames = b.readUInt32LE(eo + 24);
  const namesRva = b.readUInt32LE(eo + 32);
  const no = rvaToOff(namesRva);
  log(`exports (${nNames}):`);
  const out = [];
  for (let i = 0; i < Math.min(nNames, 200); i++) {
    const nr = b.readUInt32LE(no + i * 4);
    const so = rvaToOff(nr);
    out.push(b.toString('ascii', so, b.indexOf(0, so)));
  }
  log('  ' + out.join(', '));
}
