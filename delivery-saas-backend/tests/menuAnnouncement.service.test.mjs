import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  validateAnnouncementInput,
  sanitizeAnnouncementInput,
  buildPublicAnnouncement,
} from '../src/services/menuAnnouncementService.js'

test('validateAnnouncementInput: invalid hex bannerBgColor rejected', () => {
  const r = validateAnnouncementInput({ bannerBgColor: 'red' })
  assert.equal(r.ok, false)
  assert.match(r.error, /bannerBgColor/)
})

test('validateAnnouncementInput: valid hex bannerBgColor accepted', () => {
  const r = validateAnnouncementInput({ bannerBgColor: '#1A2B3C' })
  assert.equal(r.ok, true)
})

test('validateAnnouncementInput: null bannerBgColor accepted', () => {
  const r = validateAnnouncementInput({ bannerBgColor: null })
  assert.equal(r.ok, true)
})

test('validateAnnouncementInput: invalid popupCtaUrl rejected', () => {
  const r = validateAnnouncementInput({ popupCtaUrl: 'not a url' })
  assert.equal(r.ok, false)
  assert.match(r.error, /popupCtaUrl/)
})

test('validateAnnouncementInput: https URL accepted', () => {
  const r = validateAnnouncementInput({ popupCtaUrl: 'https://x.com/promo' })
  assert.equal(r.ok, true)
})

test('validateAnnouncementInput: popupMessage > 500 chars rejected', () => {
  const r = validateAnnouncementInput({ popupMessage: 'a'.repeat(501) })
  assert.equal(r.ok, false)
  assert.match(r.error, /popupMessage/)
})

test('validateAnnouncementInput: bannerText > 200 chars rejected', () => {
  const r = validateAnnouncementInput({ bannerText: 'a'.repeat(201) })
  assert.equal(r.ok, false)
})

test('sanitizeAnnouncementInput: strips HTML tags', () => {
  const out = sanitizeAnnouncementInput({
    popupMessage: 'olá <script>x</script><b>oi</b>',
    bannerText: 'compre <a href="x">aqui</a>',
    popupTitle: '<h1>Promo</h1>',
  })
  assert.equal(out.popupMessage, 'olá xoi')
  assert.equal(out.bannerText, 'compre aqui')
  assert.equal(out.popupTitle, 'Promo')
})

test('sanitizeAnnouncementInput: passes booleans/urls untouched', () => {
  const out = sanitizeAnnouncementInput({
    popupEnabled: true,
    bannerEnabled: false,
    popupCtaUrl: 'https://x.com',
  })
  assert.equal(out.popupEnabled, true)
  assert.equal(out.bannerEnabled, false)
  assert.equal(out.popupCtaUrl, 'https://x.com')
})

test('buildPublicAnnouncement: returns null when both disabled', () => {
  const out = buildPublicAnnouncement({ popupEnabled: false, bannerEnabled: false })
  assert.equal(out, null)
})

test('buildPublicAnnouncement: includes only popup fields when popupEnabled', () => {
  const out = buildPublicAnnouncement({
    popupEnabled: true,
    bannerEnabled: false,
    popupTitle: 'T', popupMessage: 'M', popupButtonText: 'OK',
    popupCtaUrl: null, popupCtaLabel: null, popupImageUrl: null,
    bannerText: 'should be hidden', bannerBgColor: '#000',
    updatedAt: new Date('2026-06-05T12:00:00Z'),
  })
  assert.equal(out.popupEnabled, true)
  assert.equal(out.popupMessage, 'M')
  assert.equal(out.bannerEnabled, false)
  assert.equal(out.bannerText, undefined)
  assert.equal(out.updatedAt, '2026-06-05T12:00:00.000Z')
})

test('buildPublicAnnouncement: includes only banner fields when bannerEnabled', () => {
  const out = buildPublicAnnouncement({
    popupEnabled: false,
    bannerEnabled: true,
    popupMessage: 'hidden',
    bannerText: 'BUY NOW', bannerBgColor: '#FF0000',
    updatedAt: new Date('2026-06-05T12:00:00Z'),
  })
  assert.equal(out.bannerEnabled, true)
  assert.equal(out.bannerText, 'BUY NOW')
  assert.equal(out.popupMessage, undefined)
})
