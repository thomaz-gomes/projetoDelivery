const fs = require('fs');
const path = require('path');
const file = path.resolve(process.argv[2] || 'delivery-saas-frontend/src/views/PublicMenu.vue');
const outFile = path.resolve('tools/check_try_catch_report.json');
const txt = fs.readFileSync(file,'utf8');
const lines = txt.split(/\r?\n/);
const out = [];
for(let i=0;i<lines.length;i++){
  const line = lines[i];
  if(/\btry\s*\{/.test(line)){
    let found = false;
    for(let j=i+1;j<Math.min(lines.length,i+201);j++){
      if(/\bcatch\s*\(/.test(lines[j]) || /\bfinally\b/.test(lines[j])){ found = true; break }
    }
    if(!found) out.push({ line: i+1, context: lines.slice(Math.max(0,i-3), Math.min(lines.length,i+4)).join('\n') });
  }
}
fs.writeFileSync(outFile, JSON.stringify({ file, issues: out }, null, 2), 'utf8');
console.log('done');
