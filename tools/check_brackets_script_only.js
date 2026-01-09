const fs = require('fs');
const p = require('path').resolve(__dirname, 'tmp_publicmenu_script.js');
if(!fs.existsSync(p)){ console.error('tmp_publicmenu_script.js missing'); process.exit(2) }
const s = fs.readFileSync(p, 'utf8');
const lines = s.split('\n');
let pcount=0,bcount=0,scount=0;
for(let i=0;i<lines.length;i++){
  const line = lines[i];
  for(const ch of line){ if(ch==='(') pcount++; if(ch===')') pcount--; if(ch==='{') bcount++; if(ch==='}') bcount--; if(ch==='[') scount++; if(ch===']') scount--; }
  if(pcount<0 || bcount<0 || scount<0){ console.log('negative at', i+1, 'par', pcount, 'bra', bcount, 'sq', scount); process.exit(0); }
}
console.log('final counts -> par', pcount, 'bra', bcount, 'sq', scount);
for(let i=0;i<lines.length;i++){
  let pc=0,bc=0,sc=0;
  for(let j=0;j<=i;j++){
    for(const ch of lines[j]){ if(ch==='(') pc++; if(ch===')') pc--; if(ch==='{') bc++; if(ch==='}') bc--; if(ch==='[') sc++; if(ch===']') sc--; }
  }
  if(pc!==0 || bc!==0 || sc!==0){ console.log('non-zero at line', i+1, 'par', pc, 'bra', bc, 'sq', sc); break }
}
