// src/services/marketing/templateRenderer.js

/**
 * Build Cloud API template components from variableMap and message context.
 *
 * variableMap shape: { "1": {source:'field', value:'customer.firstName'}, ... }
 *
 * Returns the shape the local Meta adapter expects:
 *   { name, languageCode, components: [...] }
 *
 * Components (subset Meta supports):
 *   { type: 'body',   parameters: [{type:'text', text:'Maria'}, ...] }
 *   { type: 'button', sub_type: 'url', index: '0', parameters: [{type:'text', text:'foo'}] }
 */
export function renderTemplate(message, template, variableMap) {
  const components = []
  const bodyVars = Object.keys(variableMap || {})
    .filter(k => /^\d+$/.test(k))
    .sort((a, b) => Number(a) - Number(b))

  if (bodyVars.length > 0) {
    components.push({
      type: 'body',
      parameters: bodyVars.map(k => ({
        type: 'text',
        text: resolveVariable(message, variableMap[k]),
      })),
    })
  }

  // URL button with {{N}} dynamic URL part
  const buttonsComp = (template.components || []).find(c => c.type === 'BUTTONS')
  if (buttonsComp?.buttons) {
    buttonsComp.buttons.forEach((btn, idx) => {
      if (btn.type === 'URL' && /\{\{\d+\}\}/.test(btn.url || '')) {
        const m = btn.url.match(/\{\{(\d+)\}\}/)
        const varNum = m[1]
        const mapping = variableMap?.[`url_${varNum}`] || variableMap?.[varNum]
        if (mapping) {
          components.push({
            type: 'button',
            sub_type: 'url',
            index: String(idx),
            parameters: [{ type: 'text', text: resolveVariable(message, mapping) }],
          })
        }
      }
    })
  }

  return {
    name: template.name,
    languageCode: template.language || 'pt_BR',
    components,
  }
}

function resolveVariable(message, mapping) {
  if (!mapping) return ''
  if (mapping.source === 'field') return getFieldValue(message, mapping.value)
  if (mapping.source === 'campaign') {
    if (mapping.value === 'couponCode') return message.campaign?.coupon?.code || ''
    if (mapping.value === 'conversionWindowHours') return String(message.campaign?.conversionWindowHours ?? '')
  }
  if (mapping.source === 'static') return String(mapping.value ?? '')
  return ''
}

function getFieldValue(message, path) {
  if (path === 'customer.firstName') {
    return (message.customer?.fullName || '').split(/\s+/)[0] || ''
  }
  // generic nested path (e.g. 'customer.email' or 'campaign.name')
  const parts = String(path || '').split('.')
  let cur = { customer: message.customer, campaign: message.campaign }
  for (const p of parts) {
    if (cur == null) return ''
    cur = cur[p]
  }
  return String(cur ?? '')
}
