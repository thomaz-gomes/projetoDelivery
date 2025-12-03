const fs = require('fs');
const path = require('path');

function walk(dir, cb){
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for(const e of entries){
    const p = path.join(dir, e.name);
    if(e.isDirectory()) walk(p, cb);
    else cb(p);
  }
}

const root = path.join(__dirname, '..', 'delivery-saas-frontend', 'src');
if(!fs.existsSync(root)){
  console.error('Root not found:', root);
  process.exit(1);
}

const files = [];
walk(root, (p)=>{ if(p.endsWith('.vue')) files.push(p) });
let changed = 0;

const openTagRegex = /<select\b([^>]*)\b(v-model(?:\.[\w]+)*\s*=\s*(?:"[^\"]*"|'[^']*'))([^>]*)>/gi;
for(const f of files){
  let s = fs.readFileSync(f, 'utf8');
  const orig = s;
  // Replace opening <select ... v-model="foo" ...> with <SelectInput ... v-model="foo" ...>
  s = s.replace(openTagRegex, (m, before, vmodelAttr, after) => {
    // rebuild attributes preserving order (before vmodelAttr after)
    return `<SelectInput ${before} ${vmodelAttr} ${after}>`;
  });
  // replace closing tag
  s = s.replace(/<\/select>/gi, '</SelectInput>');
  if(s !== orig){
    try{
      fs.writeFileSync(f + '.bak.select', orig, 'utf8');
      fs.writeFileSync(f, s, 'utf8');
      console.log('Updated', f);
      changed++;
    }catch(e){
      console.error('Failed to write', f, e.message);
    }
  }
}
console.log('Done. Files changed:', changed);
