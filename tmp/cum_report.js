const fs=require('fs'); const p='d:/Users/gomes/Documents/GitHub/projetoDelivery/delivery-saas-frontend/src/views/PublicMenu.vue'; const s=fs.readFileSync(p,'utf8'); const start=s.indexOf('<script'); const openClose=s.indexOf('>', start); const end = s.indexOf('</script>', openClose); const script = s.slice(openClose+1, end); const lines = script.split(/\r?\n/);
let cum=0; const cumArr=[];
for(let i=0;i<lines.length;i++){ for(const ch of lines[i]){ if(ch==='{') cum++; if(ch==='}') cum--; } cumArr.push(cum); }
const final = cumArr[cumArr.length-1]; console.log('final cum',final);
// print last 120 lines with cum
const startLine = Math.max(1, lines.length-120);
for(let i=startLine;i<=lines.length;i++){ const c=cumArr[i-1]; console.log(String(i).padStart(4,' ')+" ("+String(c).padStart(3,' ')+"): "+lines[i-1]); }
fs.writeFileSync('d:/Users/gomes/Documents/GitHub/projetoDelivery/tmp/cum_report_out.txt', 'final cum '+final+'\n' + lines.slice(startLine-1).map((l,i)=> (startLine+i+': '+l)).join('\n'));
console.log('wrote cum_report_out.txt');
