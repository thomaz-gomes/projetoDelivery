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
for(const f of files){
  let s = fs.readFileSync(f, 'utf8');
  const orig = s;
  // replace occurrences like: <TextInput "form.name" ... />
  s = s.replace(/<TextInput\s+\"([^\"]+)\"/g, '<TextInput v-model="$1"');
  s = s.replace(/<TextInput\s+'([^']+)'/g, '<TextInput v-model="$1"');
  if(s !== orig){
    try{
      fs.writeFileSync(f + '.bak.fix-textinput', orig, 'utf8');
      fs.writeFileSync(f, s, 'utf8');
      console.log('Updated', f);
      changed++;
    }catch(e){
      console.error('Failed to write', f, e.message);
    }
  }
}
console.log('Done. Files changed:', changed);
