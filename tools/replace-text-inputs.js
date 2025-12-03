const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'delivery-saas-frontend', 'src');
const excludedTypes = new Set(['number','checkbox','radio','file','date','time','range','hidden','color','image']);

function readFiles(dir) {
  const results = [];
  const list = fs.readdirSync(dir);
  list.forEach(f => {
    const p = path.join(dir, f);
    const stat = fs.statSync(p);
    if (stat && stat.isDirectory()) {
      if (['node_modules', '.git'].includes(f)) return;
      results.push(...readFiles(p));
    } else if (/\.vue$/.test(f)) {
      results.push(p);
    }
  });
  return results;
}

function attrMatch(str, name) {
  const re = new RegExp(`\\b${name}=("([^"]*)"|'([^']*)'|([^\s>]+))`);
  const m = str.match(re);
  if (!m) return null;
  return m[2] || m[3] || m[4] || '';
}

function hasAttr(str, name) {
  return new RegExp(`\\b${name}(=|\\b)`).test(str);
}

function replaceInFile(file) {
  let s = fs.readFileSync(file, 'utf8');
  let original = s;
  // replace textarea with v-model
  s = s.replace(/<textarea([^>]*)v-model=(["'][^"']+["'])([^>]*)>[\s\S]*?<\\textarea>/gmi, (m, a1, vm, a2) => {
    // collect common attrs
    const rows = attrMatch(a1 + ' ' + a2, 'rows');
    const maxlength = attrMatch(a1 + ' ' + a2, 'maxlength');
    const inputClass = attrMatch(a1 + ' ' + a2, 'class') || '';
    const id = attrMatch(a1 + ' ' + a2, 'id');
    const placeholder = attrMatch(a1 + ' ' + a2, 'placeholder');
    let attrs = '';
    if (id) attrs += ` id=${JSON.stringify(id)}`;
    if (placeholder) attrs += ` placeholder=${JSON.stringify(placeholder)}`;
    if (rows) attrs += ` rows=${JSON.stringify(rows)}`;
    if (maxlength) attrs += ` maxlength=${JSON.stringify(maxlength)}`;
    if (inputClass) attrs += ` inputClass=${JSON.stringify(inputClass)}`;
    return `<TextareaInput ${vm}${attrs} />`;
  });

  // replace input elements that contain v-model and are not excluded types
  s = s.replace(/<input([^>]*)v-model=(["'][^"']+["'])([^>]*)\/?>(\r?\n)?/gmi, (m, a1, vm, a2) => {
    const allAttrs = (a1 + ' ' + a2).trim();
    const type = attrMatch(allAttrs, 'type');
    const typeLower = type ? String(type).replace(/['"]/g,'').toLowerCase() : null;
    if (typeLower && excludedTypes.has(typeLower)) return m; // skip
    // also skip inputs that are inside swal html strings (we can't safely replace)
    if (/swal2-input/.test(allAttrs)) return m;
    // preserve attributes we care about
    const placeholder = attrMatch(allAttrs, 'placeholder');
    const maxlength = attrMatch(allAttrs, 'maxlength');
    const required = /\brequired\b/.test(allAttrs) ? ' required' : '';
    const id = attrMatch(allAttrs, 'id');
    const cls = attrMatch(allAttrs, 'class') || '';
    const min = attrMatch(allAttrs, 'min');
    const max = attrMatch(allAttrs, 'max');
    const autocomplete = attrMatch(allAttrs, 'autocomplete');
    const inputmode = attrMatch(allAttrs, 'inputmode');
    const valueBind = attrMatch(allAttrs, ':value') || attrMatch(allAttrs, 'v-bind:value');
    const nativeInput = /@(input|change|keydown|keyup|blur|focus)=/.test(allAttrs);
    // keep inline event handlers intact by copying them through (best-effort)
    const events = [];
    const evRe = /(@[a-zA-Z-]+=("[^"]*"|'[^']*'))/g;
    let evm;
    while((evm = evRe.exec(allAttrs))){ events.push(evm[1]); }
    let attrs = '';
    if (id) attrs += ` id=${JSON.stringify(id)}`;
    if (placeholder) attrs += ` placeholder=${JSON.stringify(placeholder)}`;
    if (maxlength) attrs += ` maxlength=${JSON.stringify(maxlength)}`;
    if (min) attrs += ` min=${JSON.stringify(min)}`;
    if (max) attrs += ` max=${JSON.stringify(max)}`;
    if (autocomplete) attrs += ` autocomplete=${JSON.stringify(autocomplete)}`;
    if (inputmode) attrs += ` inputmode=${JSON.stringify(inputmode)}`;
    if (cls) attrs += ` inputClass=${JSON.stringify(cls)}`;
    if (valueBind) attrs += ` :value=${valueBind}`;
    if (required) attrs += ` required`;
    if (events.length) attrs += ' ' + events.join(' ');
    // preserve v-model exactly (including modifiers)
    return `<TextInput ${vm}${attrs} />` + (m.endsWith('\n') ? '\n' : '');
  });

  if (s !== original) {
    fs.writeFileSync(file + '.bak', original, 'utf8');
    fs.writeFileSync(file, s, 'utf8');
    console.log('Updated', file);
  }
}

const files = readFiles(root);
console.log('Found', files.length, 'vue files');
files.forEach(replaceInFile);
console.log('Done');
