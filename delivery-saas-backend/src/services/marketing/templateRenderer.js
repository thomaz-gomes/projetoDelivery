// src/services/marketing/templateRenderer.js

// Meta Cloud API requires absolute http(s) URLs for header image links.
// Campaigns persist the local upload path (e.g. "/public/uploads/...") so
// we resolve it against the configured public base URL at render time.
// BACKEND_URL is the codebase-wide convention (also used by routes/inbox.js);
// PUBLIC_API_URL / SERVER_BASE_URL kept for parity with utils.generateQrUrl.
function resolveMediaUrl(rawUrl) {
  if (!rawUrl) return null
  if (/^https?:\/\//i.test(rawUrl)) return rawUrl
  const base = process.env.BACKEND_URL
    || process.env.PUBLIC_API_URL
    || process.env.SERVER_BASE_URL
    || `http://localhost:${process.env.PORT || 3000}`
  const cleanBase = String(base).replace(/\/$/, '')
  const cleanPath = String(rawUrl).startsWith('/') ? rawUrl : `/${rawUrl}`
  return `${cleanBase}${cleanPath}`
}

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

  // IMAGE header: if the template's HEADER component has format=IMAGE and
  // the campaign has a mediaUrl set, pass it as the header parameter.
  // Without the header component in the send payload, Meta rejects the
  // send because the template was created with a header.
  const headerComp = (template.components || []).find(c => String(c.type).toUpperCase() === 'HEADER')
  if (headerComp && String(headerComp.format || '').toUpperCase() === 'IMAGE' && message.campaign?.mediaUrl) {
    components.push({
      type: 'header',
      parameters: [{ type: 'image', image: { link: resolveMediaUrl(message.campaign.mediaUrl) } }],
    })
  }

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
