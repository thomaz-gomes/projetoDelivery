import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import adapter from '../src/messaging/adapters/whatsappMeta.adapter.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const loadFixture = (name) =>
  JSON.parse(readFileSync(join(__dirname, `fixtures/meta-wa.${name}.json`), 'utf8'))

const account = {
  id: 'meta-acc-1',
  companyId: 'comp-1',
  provider: 'META_WA',
  externalId: '999888777666555',
  accessToken: 'enc:fake',
}

test('adapter metadata: provider META_WA, channel WHATSAPP', () => {
  assert.equal(adapter.provider, 'META_WA')
  assert.equal(adapter.channel, 'WHATSAPP')
})

test('parseInbound TEXT', async () => {
  const entry = loadFixture('text')
  const msgs = await adapter.parseInbound(entry, account)
  assert.equal(msgs.length, 1)
  const m = msgs[0]
  assert.equal(m.channel, 'WHATSAPP')
  assert.equal(m.provider, 'META_WA')
  assert.equal(m.type, 'TEXT')
  assert.equal(m.companyId, 'comp-1')
  assert.equal(m.providerAccountId, 'meta-acc-1')
  assert.equal(m.externalId, 'wamid.test_text_1')
  assert.ok(m.channelContactId.startsWith('55'))
  assert.equal(m.body, 'Olá pelo Meta Cloud')
  assert.equal(m.contactName, 'Alice Meta')
  assert.ok(m.timestamp instanceof Date)
})

test('parseInbound IMAGE has mimeType + mediaId; mediaUrl null until downloadMedia', async () => {
  const entry = loadFixture('image')
  const msgs = await adapter.parseInbound(entry, account)
  assert.equal(msgs.length, 1)
  const m = msgs[0]
  assert.equal(m.type, 'IMAGE')
  assert.equal(m.mimeType, 'image/jpeg')
  assert.equal(m.mediaId, '1099999888777666')
  assert.equal(m.mediaUrl, null)
  assert.equal(m.body, 'Confira a foto do produto')
})

test('parseInbound AUDIO has audio mime + mediaId; mediaUrl null', async () => {
  const entry = loadFixture('audio')
  const msgs = await adapter.parseInbound(entry, account)
  assert.equal(msgs.length, 1)
  const m = msgs[0]
  assert.equal(m.type, 'AUDIO')
  assert.ok(m.mimeType?.startsWith('audio/'))
  assert.equal(m.mediaId, '1099999888777777')
  assert.equal(m.mediaUrl, null)
})

test('parseInbound dedup by externalId across changes', async () => {
  const base = loadFixture('text')
  // Duplicate the single message inside changes[0].value.messages — should
  // dedup down to one.
  const dup = JSON.parse(JSON.stringify(base))
  const msg = dup.changes[0].value.messages[0]
  dup.changes[0].value.messages.push({ ...msg })
  const msgs = await adapter.parseInbound(dup, account)
  assert.equal(msgs.length, 1)
})

test('parseInbound skips non-messages events (statuses[])', async () => {
  const entry = {
    id: '111122223333444',
    changes: [
      {
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { phone_number_id: '999888777666555' },
          statuses: [
            {
              id: 'wamid.outbound_1',
              status: 'delivered',
              timestamp: '1715000000',
              recipient_id: '5571999990000',
            },
          ],
        },
      },
    ],
  }
  const msgs = await adapter.parseInbound(entry, account)
  assert.equal(msgs.length, 0)
})

test('parseInbound maps interactive button reply with reorder: prefix', async () => {
  const entry = {
    id: '111122223333444',
    changes: [
      {
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { phone_number_id: '999888777666555' },
          contacts: [{ wa_id: '5571999990000', profile: { name: 'Reorder' } }],
          messages: [
            {
              from: '5571999990000',
              id: 'wamid.test_btn_1',
              timestamp: '1715000300',
              type: 'interactive',
              interactive: {
                type: 'button_reply',
                button_reply: { id: 'reorder:order-abc', title: 'Repetir pedido' },
              },
            },
          ],
        },
      },
    ],
  }
  const msgs = await adapter.parseInbound(entry, account)
  assert.equal(msgs.length, 1)
  const m = msgs[0]
  assert.equal(m.type, 'TEXT')
  assert.deepEqual(m.reorderButton, { orderId: 'order-abc' })
})

test('parseInbound LOCATION extracts latitude/longitude', async () => {
  const entry = {
    id: '111122223333444',
    changes: [
      {
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { phone_number_id: '999888777666555' },
          contacts: [{ wa_id: '5571999990000', profile: { name: 'Loc' } }],
          messages: [
            {
              from: '5571999990000',
              id: 'wamid.test_loc_1',
              timestamp: '1715000400',
              type: 'location',
              location: { latitude: -12.97, longitude: -38.5, name: 'Salvador' },
            },
          ],
        },
      },
    ],
  }
  const msgs = await adapter.parseInbound(entry, account)
  assert.equal(msgs.length, 1)
  assert.equal(msgs[0].type, 'LOCATION')
  assert.equal(msgs[0].latitude, -12.97)
  assert.equal(msgs[0].longitude, -38.5)
})
