'use strict'
const { app } = require('electron')
const path = require('path')
const fs = require('fs')

function configPath() {
  return path.join(app.getPath('userData'), 'config.json')
}

function load() {
  try {
    const raw = fs.readFileSync(configPath(), 'utf8')
    return JSON.parse(raw)
  } catch (e) {
    return null
  }
}

function save(cfg) {
  const dir = app.getPath('userData')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2), 'utf8')
  return true
}

module.exports = { load, save, configPath }
