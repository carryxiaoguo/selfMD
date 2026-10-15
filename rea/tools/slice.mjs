// Slice a byte/char range of a file to stdout or a file.
// Usage: node slice.mjs <file> <startChar> <endChar> [--out out.txt] [--encoding utf8|utf16le] [--pretty]
import fs from 'node:fs';

const args = process.argv.slice(2);
const file = args[0];
const start = parseInt(args[1], 10);
const end = parseInt(args[2], 10);
const get = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const enc = get('--encoding', 'utf8');
const out = get('--out', null);

let text = fs.readFileSync(file).toString(enc);
let slice = text.slice(start, end);

// crude beautify: newline after ; { } for readability of minified code
if (args.includes('--pretty')) {
  slice = slice.replace(/([;{}])/g, '$1\n');
}

if (out) { fs.writeFileSync(out, slice); console.error(`wrote ${slice.length} chars -> ${out}`); }
else console.log(slice);
