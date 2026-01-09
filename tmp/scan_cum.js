const fs=require('fs'); const p='d:/Users/gomes/Documents/GitHub/projetoDelivery/delivery-saas-frontend/src/views/PublicMenu.vue'; const s=fs.readFileSync(p,'utf8'); const start=s.indexOf('<script'); const openClose=s.indexOf('>', start); const end = s.indexOf('</script>', openClose); const script = s.slice(openClose+1, end); const lines = script.split(/\r?\n/);
let cumB=0, cumP=0; const outLines=[]; for(let i=0;i<lines.length;i++){ const line=lines[i]; for(const ch of line){ if(ch==='{') cumB++; else if(ch==='}') cumB--; if(ch==='(') cumP++; else if(ch===')') cumP--; } outLines.push({ln:i+1, cumB, cumP, text: line}); }
// find last index where cumB>0
let lastB=0; for(let i=0;i<outLines.length;i++){ if(outLines[i].cumB>0) lastB=i+1; }
let lastP=0; for(let i=0;i<outLines.length;i++){ if(outLines[i].cumP>0) lastP=i+1; }
let out='lastBracePositiveLine '+lastB+' lastParenPositiveLine '+lastP+'\n'; const from=Math.max(1,Math.min(lastB,lastP)-10); const to=Math.min(outLines.length, Math.max(lastB,lastP)+10);
for(let i=from;i<=to;i++){ const o=outLines[i-1]; out+=((String(o.ln).padStart(4,' '))+ ' cumB:'+String(o.cumB).padStart(3,' ')+' cumP:'+String(o.cumP).padStart(3,' ')+' | '+o.text)+'\n'; }
fs.writeFileSync('d:/Users/gomes/Documents/GitHub/projetoDelivery/tmp/scan_cum_out.txt', out, 'utf8'); console.log('wrote');
