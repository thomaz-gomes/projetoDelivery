import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderTemplate } from '../src/services/marketing/templateRenderer.js'

test('renderTemplate maps body variables', () => {
  const message = {
    customer: { fullName: 'Maria Silva' },
    campaign: { conversionWindowHours: 48, coupon: { code: 'PIZZA30' } },
  }
  const template = { name: 'reactivation_30d', language: 'pt_BR', components: [] }
  const variableMap = {
    '1': { source: 'field',    value: 'customer.firstName' },
    '2': { source: 'campaign', value: 'couponCode' },
    '3': { source: 'campaign', value: 'conversionWindowHours' },
  }
  const result = renderTemplate(message, template, variableMap)
  assert.equal(result.name, 'reactivation_30d')
  assert.equal(result.languageCode, 'pt_BR')
  assert.equal(result.components[0].type, 'body')
  assert.deepEqual(result.components[0].parameters.map(p => p.text), ['Maria', 'PIZZA30', '48'])
})

test('renderTemplate handles missing variableMap', () => {
  const message = { customer: { fullName: 'Joao' }, campaign: { coupon: null, conversionWindowHours: 24 } }
  const template = { name: 't', language: 'pt_BR', components: [] }
  const result = renderTemplate(message, template, {})
  assert.equal(result.components.length, 0)
})

test('renderTemplate handles URL button with dynamic part', () => {
  const message = { customer: { fullName: 'Ana' }, campaign: {} }
  const template = {
    name: 'with_button',
    language: 'pt_BR',
    components: [{
      type: 'BUTTONS',
      buttons: [{ type: 'URL', url: 'https://example.com/promo/{{1}}' }],
    }],
  }
  const variableMap = { '1': { source: 'static', value: 'spring2026' } }
  const result = renderTemplate(message, template, variableMap)
  const btn = result.components.find(c => c.type === 'button')
  assert.ok(btn)
  assert.equal(btn.sub_type, 'url')
  assert.equal(btn.index, '0')
  assert.equal(btn.parameters[0].text, 'spring2026')
})
