import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import adapter from '../src/messaging/adapters/whatsappEvolution.adapter.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const loadFixture = (name) =>
  JSON.parse(readFileSync(join(__dirname, `fixtures/evolution.${name}.json`), 'utf8'))

const account = { id: 'inst-1', companyId: 'comp-1', instanceName: 'test' }

test('adapter metadata: provider EVOLUTION_WA, channel WHATSAPP', () => {
  assert.equal(adapter.provider, 'EVOLUTION_WA')
  assert.equal(adapter.channel, 'WHATSAPP')
})

test('parseInbound TEXT', async () => {
  const payload = loadFixture('text')
  const msgs = await adapter.parseInbound(payload, account)
  assert.equal(msgs.length, 1)
  const m = msgs[0]
  assert.equal(m.channel, 'WHATSAPP')
  assert.equal(m.provider, 'EVOLUTION_WA')
  assert.equal(m.type, 'TEXT')
  assert.equal(m.companyId, 'comp-1')
  assert.ok(m.externalId)
  assert.ok(m.channelContactId)
  assert.equal(m.body, 'Olá, gostaria de fazer um pedido')
  assert.equal(m.contactName, 'Alice Test')
  assert.ok(m.timestamp instanceof Date)
})

test('parseInbound IMAGE includes mediaUrl + mimeType', async () => {
  const payload = loadFixture('image')
  const msgs = await adapter.parseInbound(payload, account)
  assert.equal(msgs[0].type, 'IMAGE')
  assert.ok(msgs[0].mediaUrl)
  assert.ok(msgs[0].mimeType)
  assert.equal(msgs[0].body, 'Confira a foto do produto')
})

test('parseInbound AUDIO sets type AUDIO and audio mimeType', async () => {
  const payload = loadFixture('audio')
  const msgs = await adapter.parseInbound(payload, account)
  assert.equal(msgs[0].type, 'AUDIO')
  assert.ok(msgs[0].mimeType?.startsWith('audio/'))
  assert.ok(msgs[0].mediaUrl)
})

test('parseInbound dedup by externalId in same payload', async () => {
  const payload = loadFixture('text')
  const msgs = await adapter.parseInbound(payload, account)
  const ids = msgs.map((m) => m.externalId)
  assert.equal(new Set(ids).size, ids.length)
})

test('parseInbound skips group and broadcast messages', async () => {
  const payload = {
    data: [
      {
        key: { remoteJid: '120363012345@g.us', fromMe: false, id: 'GROUP1' },
        message: { conversation: 'group msg' },
        messageTimestamp: 1715000300,
      },
      {
        key: { remoteJid: 'status@broadcast', fromMe: false, id: 'BCAST1' },
        message: { conversation: 'status msg' },
        messageTimestamp: 1715000301,
      },
    ],
  }
  const msgs = await adapter.parseInbound(payload, account)
  assert.equal(msgs.length, 0)
})

test('parseInbound normalizes phone with 55 DDI', async () => {
  const payload = loadFixture('text')
  const msgs = await adapter.parseInbound(payload, account)
  assert.ok(msgs[0].channelContactId.startsWith('55'))
})
