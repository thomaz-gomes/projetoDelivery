const fs = require('fs');
const path = 'c:/Users/gomes/projetoDelivery/delivery-saas-backend/src/routes/publicMenu.js';
const out = 'c:/Users/gomes/projetoDelivery/tmp/publicMenu_slice.js';
const s = fs.readFileSync(path,'utf8');
const lines = s.split(/\r?\n/);

async function test(n) {
  const slice = lines.slice(0,n).join('\n');
  fs.writeFileSync(out, slice, 'utf8');
  try {
    await import('file:///' + out.replace(/\\/g,'/'));
    return true;
  } catch (e) {
    return {ok:false, error: e && e.message ? e.message : String(e)};
  }
}

(async()=>{
  let lo = 1, hi = lines.length, bad = hi;
  while (lo <= hi) {
    const mid = Math.floor((lo+hi)/2);
    const r = await test(mid);
    if (r === true) {
      lo = mid + 1;
    } else {
      bad = mid;
      hi = mid - 1;
    }
  }
  console.log('First failing line approx:', bad);
  console.log('Context around failure:');
  console.log(lines.slice(Math.max(0,bad-5), bad+5).join('\n'));
})();
