// Context extractor for minified JS / binary strings.
// Usage: node ctx.mjs <file> <needle> [--window 300] [--max 20] [--encoding utf8|utf16le|both]
import fs from 'node:fs';

const args = process.argv.slice(2);
const file = args[0];
const needle = args[1];
const get = (flag, dflt) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : dflt; };
const win = parseInt(get('--window', '300'), 10);
const max = parseInt(get('--max', '20'), 10);
const enc = get('--encoding', 'utf8');

if (!file || !needle) { console.error('usage: ctx.mjs <file> <needle> [--window N] [--max N] [--encoding utf8|utf16le|both]'); process.exit(2); }

const buf = fs.readFileSync(file);

function scan(text, label, unit) {
  const hits = [];
  let from = 0;
  for (;;) {
    const i = text.indexOf(needle, from);
    if (i < 0) break;
    hits.push(i);
    from = i + needle.length;
    if (hits.length >= max) break;
  }
  if (!hits.length) return;
  console.log(`\n##### ${label}: ${hits.length}${hits.length >= max ? '+' : ''} hits for "${needle}" #####`);
  for (const i of hits) {
    const s = Math.max(0, i - win);
    const e = Math.min(text.length, i + needle.length + win);
    const off = unit === 'byte' ? `byte~${i}` : `char~${i}`;
    console.log(`\n--- [${off}] ---`);
    console.log(text.slice(s, e).replace(/\n/g, '\\n'));
  }
}

if (enc === 'utf8' || enc === 'both') scan(buf.toString('utf8'), `${file} (utf8)`, 'char');
if (enc === 'utf16le' || enc === 'both') scan(buf.toString('utf16le'), `${file} (utf16le)`, 'char');
