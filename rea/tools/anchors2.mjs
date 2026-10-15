// Emit exact char offsets for anchors listed one-per-line in a file.
// Usage: node anchors2.mjs <file> <anchorsFile>
import fs from 'node:fs';

const file = process.argv[2];
const anchorFile = process.argv[3];
const text = fs.readFileSync(file, 'utf8');
const anchors = fs.readFileSync(anchorFile, 'utf8').split(/\r?\n/).filter((x) => x.trim().length);

console.log(`file: ${file}`);
console.log(`total chars: ${text.length}`);
console.log('');
console.log('offset'.padStart(9) + '  hits  anchor');
for (const a of anchors) {
  let from = 0, n = 0, first = -1;
  for (;;) {
    const i = text.indexOf(a, from);
    if (i < 0) break;
    if (first < 0) first = i;
    n++;
    from = i + 1;
    if (n > 50) break;
  }
  if (first < 0) console.log('  MISSING  ' + a);
  else console.log(String(first).padStart(9) + '  x' + String(n).padEnd(4) + ' ' + a);
}
