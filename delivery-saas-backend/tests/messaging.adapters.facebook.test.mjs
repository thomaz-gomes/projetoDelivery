import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import adapter from '../src/messaging/adapters/facebook.adapter.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const loadFixture = (name) =>
  JSON.parse(readFileSync(join(__dirname, `fixtures/meta-fb.${name}.json`), 'utf8'))

const account = {
  id: 'fb-acc-1',
  companyId: 'comp-1',
  provider: 'META_FB',
  externalId: '1234567890',
  accessToken: 'enc:fake',
}

test('adapter metadata: provider META_FB, channel FACEBOOK', () => {
  assert.equal(adapter.provider, 'META_FB')
  assert.equal(adapter.channel, 'FACEBOOK')
})

test('parseInbound TEXT', async () => {
  const entry = loadFixture('text')
  const msgs = await adapter.parseInbound(entry, account)
  assert.equal(msgs.length, 1)
  const m = msgs[0]
  assert.equal(m.channel, 'FACEBOOK')
  assert.equal(m.provider, 'META_FB')
  assert.equal(m.type, 'TEXT')
  assert.equal(m.companyId, 'comp-1')
  assert.equal(m.providerAccountId, 'fb-acc-1')
  assert.equal(m.externalId, 'm.fb_test_text_1')
  assert.equal(m.channelContactId, 'PSID_USER_1')
  assert.equal(m.body, 'Olá pelo Messenger')
  assert.ok(m.timestamp instanceof Date)
})

test('parseInbound IMAGE with attachment', async () => {
  const entry = loadFixture('image')
  const msgs = await adapter.parseInbound(entry, account)
  assert.equal(msgs.length, 1)
  const m = msgs[0]
  assert.equal(m.type, 'IMAGE')
  assert.equal(m.mediaUrl, 'https://scontent.fb.example/image.jpg')
  assert.equal(m.channelContactId, 'PSID_USER_2')
  assert.equal(m.body, null)
})

test('parseInbound dedup by externalId', async () => {
  const base = loadFixture('text')
  const dup = JSON.parse(JSON.stringify(base))
  // Duplicate the same message event — should dedup to one.
  dup.messaging.push(JSON.parse(JSON.stringify(dup.messaging[0])))
  const msgs = await adapter.parseInbound(dup, account)
  assert.equal(msgs.length, 1)
})

test('parseInbound skips is_echo (page-sent messages)', async () => {
  const entry = {
    id: '1234567890',
    time: 1715000200000,
    messaging: [
      {
        sender: { id: '1234567890' },
        recipient: { id: 'PSID_USER_1' },
        timestamp: 1715000200000,
        message: {
          mid: 'm.fb_echo_1',
          is_echo: true,
          text: 'Outbound from the page',
        },
      },
    ],
  }
  const msgs = await adapter.parseInbound(entry, account)
  assert.equal(msgs.length, 0)
})

test('parseInbound postback with reorder: prefix sets reorderButton.orderId', async () => {
  const entry = {
    id: '1234567890',
    time: 1715000300000,
    messaging: [
      {
        sender: { id: 'PSID_USER_3' },
        recipient: { id: '1234567890' },
        timestamp: 1715000300000,
        postback: {
          mid: 'm.fb_pb_1',
          title: 'Repetir pedido',
          payload: 'reorder:order-abc',
        },
      },
    ],
  }
  const msgs = await adapter.parseInbound(entry, account)
  assert.equal(msgs.length, 1)
  const m = msgs[0]
  assert.equal(m.channel, 'FACEBOOK')
  assert.equal(m.provider, 'META_FB')
  assert.equal(m.type, 'TEXT')
  assert.equal(m.channelContactId, 'PSID_USER_3')
  assert.deepEqual(m.reorderButton, { orderId: 'order-abc' })
})
