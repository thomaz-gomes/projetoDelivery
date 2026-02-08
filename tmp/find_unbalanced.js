const fs=require('fs'); const p='d:/Users/gomes/Documents/GitHub/projetoDelivery/delivery-saas-frontend/src/views/PublicMenu.vue'; const s=fs.readFileSync(p,'utf8'); const start=s.indexOf('<script'); const openClose=s.indexOf('>', start); const end = s.indexOf('</script>', openClose); if(start<0||end<0){ console.error('script tags not found'); process.exit(2);} const script = s.slice(openClose+1, end); const lines = script.split(/\r?\n/);
let ob=0, cb=0, op=0, cp=0, obLine=null, opLine=null;
for(let i=0;i<lines.length;i++){
  const line=lines[i];
  for(const ch of line){
    if(ch==='{'){ ob++; if(obLine===null) obLine=i+1 }
    if(ch==='}'){ cb++; }
    if(ch==='('){ op++; if(opLine===null) opLine=i+1 }
    if(ch===')'){ cp++; }
  }
}
console.log('openBraces',ob,'closeBraces',cb,'firstOpenBraceLine',obLine);
console.log('openParens',op,'closeParens',cp,'firstOpenParenLine',opLine);
if(ob>cb) console.log('MORE OPEN BRACES by', ob-cb);
if(op>cp) console.log('MORE OPEN PARENS by', op-cp);
// find last few lines around end where imbalance may originate
let cumB=0,cumP=0; for(let i=0;i<lines.length;i++){ for(const ch of lines[i]){ if(ch==='{' ) cumB++; if(ch==='}') cumB--; if(ch==='(') cumP++; if(ch===')') cumP--; } if(cumB<0 || cumP<0) console.log('negative at', i+1, 'cumB',cumB,'cumP',cumP);}
console.log('done');
