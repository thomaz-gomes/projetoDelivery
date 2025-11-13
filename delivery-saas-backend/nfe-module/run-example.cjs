'use strict'
// Lightweight runner that uses ts-node register to execute TypeScript example
// using CommonJS runtime. This avoids ESM loader issues on some Node setups.
require('ts-node').register({ transpileOnly: true })
require('./src/example.ts')
