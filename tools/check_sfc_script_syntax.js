const fs = require('fs');
const path = require('path');
const file = path.resolve(process.argv[2] || 'delivery-saas-frontend/src/views/PublicMenu.vue');
const outFile = path.resolve('tools/check_sfc_script_report.json');
const txt = fs.readFileSync(file,'utf8');
const m = txt.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
let script = m ? m[1] : '';
// remove <script setup> attributes line if present - already handled
try{
  // Wrap in an async function to allow top-level await usage sometimes present
  new Function('(async ()=>{\n' + script + '\n})()');
  fs.writeFileSync(outFile, JSON.stringify({ ok: true }, null, 2), 'utf8');
  console.log('ok');
}catch(e){
  fs.writeFileSync(outFile, JSON.stringify({ ok: false, error: { message: e.message, stack: e.stack } }, null, 2), 'utf8');
  console.error('error');
}
