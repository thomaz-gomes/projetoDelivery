const fs = require('fs');
const p = 'c:/Users/gomes/projetoDelivery/delivery-saas-backend/src/routes/publicMenu.js';
const s = fs.readFileSync(p, 'utf8');
let parenOpen = 0, parenClose = 0;
let braceOpen = 0, braceClose = 0;
let sq=0, dq=0, bt=0;
let runningBrace = 0;
const lines = s.split(/\r?\n/);
let maxRunning = 0, maxLine = 0;
let lastZeroLine = 0;
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  for (const ch of line) {
    if (ch === '(') parenOpen++;
    if (ch === ')') parenClose++;
    if (ch === '{') { braceOpen++; runningBrace++; }
    if (ch === '}') { braceClose++; runningBrace--; }
    if (ch === "'") sq++;
    if (ch === '"') dq++;
    if (ch === '`') bt++;
  }
  if (runningBrace > maxRunning) { maxRunning = runningBrace; maxLine = i+1 }
  if (runningBrace < 0) console.log('Negative running brace at line', i+1, 'content:', line.trim());
  if (runningBrace === 0) lastZeroLine = i+1
  // print some diagnostics near the peak
  if (Math.abs(i+1 - maxLine) < 5) {
    console.log('near-peak line', i+1, 'runningBrace', runningBrace, '->', line.trim())
  }
}
console.log('final runningBrace', runningBrace);
console.log('maxRunning', maxRunning, 'at line', maxLine);
console.log('lastZeroLine', lastZeroLine);
console.log('paren open', parenOpen, 'close', parenClose);
console.log('brace open', braceOpen, 'close', braceClose);
console.log('quotes single', sq, 'double', dq, 'backtick', bt);

// print last 200 chars to inspect potential trailing partial code
console.log('\n--- tail 400 chars ---\n');
console.log(s.slice(-400));
