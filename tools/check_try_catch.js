const fs = require('fs');
const path = require('path');
const file = path.resolve(process.argv[2] || 'delivery-saas-frontend/src/views/PublicMenu.vue');
const txt = fs.readFileSync(file,'utf8');
const lines = txt.split(/\r?\n/);
const out = [];
for(let i=0;i<lines.length;i++){
  const line = lines[i];
  if(/\btry\s*\{/.test(line)){
    // search next 120 lines for catch or finally
    let found = false;
    for(let j=i+1;j<Math.min(lines.length,i+121);j++){
      if(/\bcatch\s*\(/.test(lines[j]) || /\bfinally\b/.test(lines[j])){ found = true; break }
    }
    if(!found) out.push({ line: i+1, context: lines.slice(Math.max(0,i-2), Math.min(lines.length,i+3)).join('\n') });
  }
}
if(out.length===0) console.log('OK: all try blocks have catch/finally nearby');
else {
  console.error('Missing catch/finally for the following try blocks:');
  out.forEach(o=>{
    console.error('--- at line', o.line);
    console.error(o.context);
  });
  process.exit(2);
}
