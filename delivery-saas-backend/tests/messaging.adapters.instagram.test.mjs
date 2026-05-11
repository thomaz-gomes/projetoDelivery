import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import adapter from '../src/messaging/adapters/instagram.adapter.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const loadFixture = (name) =>
  JSON.parse(readFileSync(join(__dirname, `fixtures/meta-ig.${name}.json`), 'utf8'))

const account = {
  id: 'ig-acc-1',
  companyId: 'comp-1',
  provider: 'META_IG',
  externalId: '17841400000000000',
  accessToken: 'enc:fake',
}

test('adapter metadata: provider META_IG, channel INSTAGRAM', () => {
  assert.equal(adapter.provider, 'META_IG')
  assert.equal(adapter.channel, 'INSTAGRAM')
})

test('parseInbound TEXT', async () => {
  const entry = loadFixture('text')
  const msgs = await adapter.parseInbound(entry, account)
  assert.equal(msgs.length, 1)
  const m = msgs[0]
  assert.equal(m.channel, 'INSTAGRAM')
  assert.equal(m.provider, 'META_IG')
  assert.equal(m.type, 'TEXT')
  assert.equal(m.companyId, 'comp-1')
  assert.equal(m.providerAccountId, 'ig-acc-1')
  assert.equal(m.externalId, 'm.ig_test_text_1')
  assert.equal(m.channelContactId, 'IGSID_USER_1')
  assert.equal(m.body, 'Olá pelo Instagram')
  assert.ok(m.timestamp instanceof Date)
})

test('parseInbound IMAGE with attachment', async () => {
  const entry = loadFixture('image')
  const msgs = await adapter.parseInbound(entry, account)
  assert.equal(msgs.length, 1)
  const m = msgs[0]
  assert.equal(m.type, 'IMAGE')
  assert.equal(m.mediaUrl, 'https://scontent.cdninstagram.example/image.jpg')
  assert.equal(m.channelContactId, 'IGSID_USER_2')
  assert.equal(m.body, null)
})

test('parseInbound story_reply prefixes body with [Story reply]', async () => {
  const entry = loadFixture('story_reply')
  const msgs = await adapter.parseInbound(entry, account)
  assert.equal(msgs.length, 1)
  const m = msgs[0]
  assert.equal(m.type, 'TEXT')
  assert.equal(m.channelContactId, 'IGSID_USER_3')
  assert.equal(m.body, '[Story reply] Cool product!')
})

test('parseInbound story_mention attachment → IMAGE with body [Story mention]', async () => {
  const entry = {
    id: '17841400000000000',
    time: 1715000300000,
    messaging: [
      {
        sender: { id: 'IGSID_USER_4' },
        recipient: { id: '17841400000000000' },
        timestamp: 1715000300000,
        message: {
          mid: 'm.ig_story_mention_1',
          attachments: [
            {
              type: 'story_mention',
              payload: { url: 'https://scontent.cdninstagram.example/story_mention.jpg' },
            },
          ],
        },
      },
    ],
  }
  const msgs = await adapter.parseInbound(entry, account)
  assert.equal(msgs.length, 1)
  const m = msgs[0]
  assert.equal(m.type, 'IMAGE')
  assert.equal(m.body, '[Story mention]')
  assert.equal(m.mediaUrl, 'https://scontent.cdninstagram.example/story_mention.jpg')
  assert.equal(m.channelContactId, 'IGSID_USER_4')
})

test('parseInbound share attachment → IMAGE with mediaUrl', async () => {
  const entry = {
    id: '17841400000000000',
    time: 1715000400000,
    messaging: [
      {
        sender: { id: 'IGSID_USER_5' },
        recipient: { id: '17841400000000000' },
        timestamp: 1715000400000,
        message: {
          mid: 'm.ig_share_1',
          attachments: [
            {
              type: 'share',
              payload: { url: 'https://scontent.cdninstagram.example/shared_post.jpg' },
            },
          ],
        },
      },
    ],
  }
  const msgs = await adapter.parseInbound(entry, account)
  assert.equal(msgs.length, 1)
  const m = msgs[0]
  assert.equal(m.type, 'IMAGE')
  assert.equal(m.mediaUrl, 'https://scontent.cdninstagram.example/shared_post.jpg')
  assert.equal(m.body, '[Shared post]')
})

test('parseInbound dedup by externalId', async () => {
  const base = loadFixture('text')
  const dup = JSON.parse(JSON.stringify(base))
  dup.messaging.push(JSON.parse(JSON.stringify(dup.messaging[0])))
  const msgs = await adapter.parseInbound(dup, account)
  assert.equal(msgs.length, 1)
})

test('parseInbound skips is_echo (page-sent messages)', async () => {
  const entry = {
    id: '17841400000000000',
    time: 1715000500000,
    messaging: [
      {
        sender: { id: '17841400000000000' },
        recipient: { id: 'IGSID_USER_1' },
        timestamp: 1715000500000,
        message: {
          mid: 'm.ig_echo_1',
          is_echo: true,
          text: 'Outbound from the IG account',
        },
      },
    ],
  }
  const msgs = await adapter.parseInbound(entry, account)
  assert.equal(msgs.length, 0)
})

test('parseInbound ignores postback events (IG has no postbacks)', async () => {
  // Sanity check: if a postback-shaped event slips through, IG should not
  // emit a message for it (postbacks are a Facebook Pages feature only).
  const entry = {
    id: '17841400000000000',
    time: 1715000600000,
    messaging: [
      {
        sender: { id: 'IGSID_USER_6' },
        recipient: { id: '17841400000000000' },
        timestamp: 1715000600000,
        postback: {
          mid: 'm.ig_pb_1',
          title: 'Should be ignored',
          payload: 'reorder:order-xyz',
        },
      },
    ],
  }
  const msgs = await adapter.parseInbound(entry, account)
  assert.equal(msgs.length, 0)
})
