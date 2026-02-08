const fs = require('fs');
const p = 'd:/Users/gomes/Documents/GitHub/projetoDelivery/delivery-saas-frontend/src/views/PublicMenu.vue';
const s = fs.readFileSync(p,'utf8');
const start = s.indexOf('<script');
const openClose = s.indexOf('>', start);
const end = s.indexOf('</script>', openClose);
if(start<0||end<0){ console.error('script tags not found'); process.exit(2) }
const script = s.slice(openClose+1, end);
const lines = script.split(/\r?\n/);
for(let i=0;i<lines.length;i++){
  const line = lines[i];
  if(line.includes('<')) console.log((i+1)+':'+line);
}
console.log('--- end');
