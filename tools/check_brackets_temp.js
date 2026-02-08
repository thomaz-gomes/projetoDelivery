const fs = require('fs');
const path = require('path');
const p = path.resolve(__dirname, '..', 'delivery-saas-frontend', 'src', 'views', 'PublicMenu.vue');
const s = fs.readFileSync(p, 'utf8');
let par=0, bra=0, sq=0;
const lines = s.split('\n');
for(let i=0;i<lines.length;i++){
  const line = lines[i];
  for(const ch of line){
    if(ch==='(') par++;
    if(ch===')') par--;
    if(ch==='{') bra++;
    if(ch==='}') bra--;
    if(ch==='[') sq++;
    if(ch===']') sq--;
  }
  if(par<0 || bra<0 || sq<0){
    console.log('Negative at line', i+1, 'par', par, 'bra', bra, 'sq', sq);
    process.exit(0);
  }
}
console.log('final counts -> par:', par, 'bra:', bra, 'sq:', sq);
// print nearby lines around any suspicious area where counts change sign

let cumulPar=0,cumulBra=0,cumulSq=0;
for(let i=0;i<lines.length;i++){
  const line = lines[i];
  for(const ch of line){
    if(ch==='(') cumulPar++;
    if(ch===')') cumulPar--;
    if(ch==='{') cumulBra++;
    if(ch==='}') cumulBra--;
    if(ch==='[') cumulSq++;
    if(ch===']') cumulSq--;
  }
  if(cumulPar<0 || cumulBra<0 || cumulSq<0){
    console.log('first negative at line', i+1, 'par', cumulPar, 'bra', cumulBra, 'sq', cumulSq);
    console.log(lines.slice(Math.max(0,i-5), i+5).map((l,idx)=>`${i-5+idx+1}: ${l}`).join('\n'));
    process.exit(0);
  }
}
// if none negative, print snapshot where counts are non-zero
for(let i=0;i<lines.length;i++){
  // compute counts up to line i
  let pcount=0,bcount=0,scount=0;
  for(let j=0;j<=i;j++){
    for(const ch of lines[j]){
      if(ch==='(') pcount++; if(ch===')') pcount--;
      if(ch==='{') bcount++; if(ch==='}') bcount--;
      if(ch==='[') scount++; if(ch===']') scount--;
    }
  }
  if(pcount!==0 || bcount!==0 || scount!==0){
    console.log('non-zero at line', i+1, 'par', pcount, 'bra', bcount, 'sq', scount);
  }
}
console.log('done');
