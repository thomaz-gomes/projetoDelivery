const fs = require('fs');
const path = require('path');
const file = path.resolve(process.argv[2] || 'delivery-saas-frontend/src/views/PublicMenu.vue');
const outFile = path.resolve('tools/check_sfc_script_report3.json');
let txt = fs.readFileSync(file,'utf8');
const m = txt.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
let script = m ? m[1] : '';
// remove import/export statements (simple heuristic)
script = script.split(/\r?\n/).filter(l=>!/^\s*(import|export)\b/.test(l)).join('\n');
// replace import.meta occurrences
script = script.replace(/import\.meta/g, '({env:{}})');
try{
  new Function('(async ()=>{\n' + script + '\n})()');
  fs.writeFileSync(outFile, JSON.stringify({ ok: true }, null, 2), 'utf8');
  console.log('ok');
}catch(e){
  fs.writeFileSync(outFile, JSON.stringify({ ok: false, error: { message: e.message, stack: e.stack } }, null, 2), 'utf8');
  console.error('error');
}
