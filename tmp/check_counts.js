const fs = require('fs');
const path = process.argv[2];
if(!path) { console.error('Usage: node check_counts.js <file>'); process.exit(2) }
const s = fs.readFileSync(path, 'utf8');
const c = (r) => (s.match(r)||[]).length;
console.log('backticks', c(/`/g));
console.log('single', c(/'/g));
console.log('double', c(/"/g));
console.log('openBraces', c(/{/g));
console.log('closeBraces', c(/}/g));
console.log('openParens', c(/\(/g));
console.log('closeParens', c(/\)/g));
console.log('openBrackets', c(/\[/g));
console.log('closeBrackets', c(/\]/g));
