const fs=require('fs'); const p='d:/Users/gomes/Documents/GitHub/projetoDelivery/delivery-saas-frontend/src/views/PublicMenu.vue'; const s=fs.readFileSync(p,'utf8'); const start=s.indexOf('<script'); const openClose=s.indexOf('>', start); const end = s.indexOf('</script>', openClose); const script = s.slice(openClose+1, end); const lines = script.split(/\r?\n/);
let cum=0; let maxCum=0; let maxLine=0; for(let i=0;i<lines.length;i++){ for(const ch of lines[i]){ if(ch==='{') cum++; if(ch==='}') cum--; } if(cum>maxCum){ maxCum=cum; maxLine=i+1 } }
console.log('maxCum',maxCum,'maxLine',maxLine);
// print region around maxLine
const from=Math.max(1,maxLine-8); const to=Math.min(lines.length,maxLine+8);
for(let i=from;i<=to;i++){ console.log((i).toString().padStart(4,' ')+': '+lines[i-1]) }

// Now do same for parens
cum=0; maxCum=0; maxLine=0; for(let i=0;i<lines.length;i++){ for(const ch of lines[i]){ if(ch==='(') cum++; if(ch===')') cum--; } if(cum>maxCum){ maxCum=cum; maxLine=i+1 } }
console.log('\nparen maxCum',maxCum,'maxLine',maxLine);
const from2=Math.max(1,maxLine-6); const to2=Math.min(lines.length,maxLine+6);
for(let i=from2;i<=to2;i++){ console.log((i).toString().padStart(4,' ')+': '+lines[i-1]) }
