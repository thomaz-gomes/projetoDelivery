const fs = require('fs');
const path = require('path');
const p = path.join(__dirname, '../delivery-saas-frontend/src/views/PublicMenu.vue');
const s = fs.readFileSync(p, 'utf8');
const startTag = '<script setup>';
const endTag = '</script>';
const si = s.indexOf(startTag);
const ei = s.indexOf(endTag, si+1);
if(si === -1 || ei === -1){
  console.error('script tags not found');
  process.exit(2);
}
const script = s.slice(si + startTag.length, ei);
// write extracted script for inspection
fs.writeFileSync(path.join(__dirname,'/tmp_publicmenu_script.js'), script, 'utf8');
console.log('Extracted script written to tools/tmp_publicmenu_script.js');
try{
  // try to create a Function to detect syntax errors
  new Function(script);
  console.log('No syntax errors detected by Function constructor.');
} catch(e) {
  console.error('Syntax error detected:', e && e.message);
  // attempt to report approximate line by mapping to original
  // Function errors use line numbers relative to the provided code; try to extract number
  const m = (e && e.stack) ? e.stack.split('\n')[0] : null;
  console.error('Stack head:', m);
  process.exit(1);
}
