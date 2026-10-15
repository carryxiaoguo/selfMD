// Emit exact char offsets for a list of anchor strings in a text file (for citation).
// Usage: node anchors.mjs <file> <anchor1> <anchor2> ...
import fs from 'node:fs';

const [file, ...anchors] = process.argv.slice(2);
const text = fs.readFileSync(file).toString('utf8');

function lineOf(idx) {
  let line = 1;
  for (let i = 0; i < idx; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

console.log(`file: ${file}`);
console.log(`total chars: ${text.length}, total lines: ${lineOf(text.length - 1)}`);
console.log('');
for (const a of anchors) {
  const hits = [];
  let from = 0;
  for (;;) {
    const i = text.indexOf(a, from);
    if (i < 0) break;
    hits.push(i);
    from = i + 1;
    if (hits.length > 6) break;
  }
  if (!hits.length) { console.log(`  MISSING  ${a}`); continue; }
  console.log(`  ${String(hits[0]).padStart(8)}  (line ~${lineOf(hits[0])})  x${hits.length}  ${a.slice(0, 70)}`);
}
