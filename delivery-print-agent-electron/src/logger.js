'use strict';
/**
 * Logger simples: console + arquivo rotativo.
 * Log diário em %APPDATA%\DeliveryPrintAgent\logs\agent-YYYY-MM-DD.log
 */
const fs = require('fs');
const path = require('path');
const { getConfigDir } = require('./config');

const LOG_DIR = path.join(getConfigDir(), 'logs');
const MAX_LOG_FILES = 7; // manter últimos 7 dias

let _logFile = null;
let _lastDate = null;

function getLogPath() {
  const today = new Date().toISOString().slice(0, 10);
  return path.join(LOG_DIR, `agent-${today}.log`);
}

function getFileStream() {
  const today = new Date().toISOString().slice(0, 10);
  if (_lastDate !== today) {
    _lastDate = today;
    fs.mkdirSync(LOG_DIR, { recursive: true });
    _logFile = fs.createWriteStream(getLogPath(), { flags: 'a' });
    rotateLogs();
  }
  return _logFile;
}

function rotateLogs() {
  try {
    const files = fs.readdirSync(LOG_DIR)
      .filter(f => f.startsWith('agent-') && f.endsWith('.log'))
      .sort();
    while (files.length > MAX_LOG_FILES) {
      fs.unlinkSync(path.join(LOG_DIR, files.shift()));
    }
  } catch (_) {}
}

function format(level, msg, extra) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  let line = `[${ts}] [${level.padEnd(5)}] ${msg}`;
  if (extra !== undefined) {
    try {
      line += ' ' + (typeof extra === 'object' ? JSON.stringify(extra) : extra);
    } catch (_) {}
  }
  return line;
}

function write(level, msg, extra) {
  const line = format(level, msg, extra);
  console.log(line);
  try {
    getFileStream().write(line + '\n');
  } catch (_) {}
}

module.exports = {
  info:  (msg, extra) => write('INFO',  msg, extra),
  warn:  (msg, extra) => write('WARN',  msg, extra),
  error: (msg, extra) => write('ERROR', msg, extra),
  debug: (msg, extra) => {
    if (process.env.NODE_ENV === 'development') write('DEBUG', msg, extra);
  },
  getLogPath,
};
