#!/usr/bin/env node
import fs from 'fs'
import path from 'path'

const args = process.argv.slice(2)
if (args.length < 2) {
  console.error('Usage: node merge_jsons.mjs output.json input1.json [input2.json ...]')
  process.exit(2)
}
const out = args[0]
const inputs = args.slice(1)
const result = {}
for (const f of inputs) {
  try {
    const buf = fs.readFileSync(f)
    const arr = JSON.parse(buf.toString())
    const name = path.basename(f).replace(/\.json$/i, '')
    result[name] = arr
    console.log('Merged', f)
  } catch (e) {
    console.error('Failed to read', f, e && e.message)
  }
}
fs.writeFileSync(out, JSON.stringify(result, null, 2))
console.log('Wrote', out)
