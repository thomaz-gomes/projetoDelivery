'use strict'

const MAX_FAILURES = 50

const buffer = []

function record(entry) {
  buffer.push(entry)
  while (buffer.length > MAX_FAILURES) buffer.shift()
  return entry
}

function list() {
  return buffer.slice()
}

function clear() {
  buffer.length = 0
}

function count() {
  return buffer.length
}

module.exports = { record, list, clear, count, MAX_FAILURES }
