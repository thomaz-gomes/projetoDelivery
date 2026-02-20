<template>
  <div class="ticket-preview p-3" ref="root">
    <div class="ticket-text">
      <pre class="ticket-mono">{{ ticketText }}</pre>
    </div>
    <div v-if="qrSrc" class="qr-wrap mt-2 text-center">
      <img :src="qrSrc" alt="qr" style="width:160px; height:160px;"/>
      <div class="small text-muted mt-1">Escaneie para despachar</div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import api from '@/api.js'

const props = defineProps({
  order: { type: Object, required: true },
  // Quando passado pelo pai, evita fetch assíncrono (exibe imediatamente)
  printerSetting: { type: Object, default: null },
})

// ── Configurações do painel ───────────────────────────────────────────────────
// _fetchedSetting: carregado via /agent-setup quando a prop não foi fornecida
const _fetchedSetting = ref(null)

onMounted(async () => {
  if (props.printerSetting) return   // prop já fornecida pelo pai — não precisa buscar
  try {
    const { data } = await api.get('/agent-setup')
    if (data.printerSetting) _fetchedSetting.value = data.printerSetting
  } catch (_) { /* sem configuração de agente */ }
})

// Usa a prop se disponível, caso contrário usa o valor buscado assincronamente
const _ps = computed(() => props.printerSetting || _fetchedSetting.value)

const settingsHeaderName = computed(() => _ps.value?.headerName || '')
const settingsHeaderCity = computed(() => _ps.value?.headerCity || '')
const blockTemplate = computed(() => {
  const tpl = _ps.value?.receiptTemplate
  if (!tpl) return null
  try {
    const parsed = JSON.parse(tpl)
    if (parsed && parsed.v === 2 && Array.isArray(parsed.blocks)) return parsed.blocks
  } catch (_) { /* template texto — ignorar */ }
  return null
})

// ── QR Code ───────────────────────────────────────────────────────────────────
const qrSrc = computed(() => {
  const o = props.order || {}
  const url = o.qrText || o.trackingUrl || o.externalUrl || o.url || ''
  if (!url) return ''
  try { return `https://chart.googleapis.com/chart?cht=qr&chs=300x300&chl=${encodeURIComponent(url)}` }
  catch (_) { return '' }
})

// ── Helpers numéricos ─────────────────────────────────────────────────────────
function toNum(v) {
  if (v == null) return 0
  const n = Number(v)
  return isFinite(n) ? n : 0
}
function fmtN(v) {
  return toNum(v).toFixed(2).replace('.', ',')
}
function fmtBRL(v) {
  return 'R$ ' + fmtN(v)
}

// ── Construção do contexto (chaves do ReceiptTemplateEditor) ──────────────────
function buildContext(order) {
  const createdAt = order.createdAt ? new Date(order.createdAt) : new Date()
  const pad2 = n => String(n).padStart(2, '0')

  const rawType = String(order.orderType || order.type || '').toLowerCase()
  const tipo_pedido = rawType === 'delivery' ? 'DELIVERY'
    : rawType === 'pickup' ? 'RETIRADA'
    : rawType === 'mesa'   ? 'MESA'
    : rawType              ? rawType.toUpperCase()
    : ''

  // Endereço — filtra sentinel "-" do DB
  let endereco_cliente = ''
  const addr = order.address
  if (typeof addr === 'string' && addr && addr !== '-') {
    endereco_cliente = addr
  } else {
    const pl  = order.payload || {}
    const da  = (pl.delivery && pl.delivery.deliveryAddress) || pl.deliveryAddress || order.deliveryAddress
    if (da) {
      if (typeof da === 'string' && da !== '-') {
        endereco_cliente = da
      } else if (da && typeof da === 'object') {
        if (da.formattedAddress) {
          endereco_cliente = da.formattedAddress
        } else {
          endereco_cliente = [
            da.streetName || da.street || da.logradouro || '',
            da.streetNumber || da.number || da.numero    || '',
            da.complement   || da.complemento            || '',
            da.neighborhood || da.bairro                 || '',
            da.city         || da.cidade                 || '',
          ].filter(Boolean).join(', ')
        }
      }
    }
  }

  // Pagamentos — tenta vários campos
  const pl = order.payload || {}
  const rawPayments = Array.isArray(order.payments)              ? order.payments
    : Array.isArray(pl.paymentConfirmed)                         ? pl.paymentConfirmed
    : Array.isArray(pl.payments)                                 ? pl.payments
    : (pl.payment && typeof pl.payment === 'object')             ? [pl.payment]
    : []

  // Subtotal — campo não existe no schema, calcular dos itens
  const items = order.items || []
  const itemsTotal = items.reduce((s, i) => {
    const base     = toNum(i.price) * (i.quantity || 1)
    const optsSum  = Array.isArray(i.options)
      ? i.options.reduce((os, o) => os + toNum(o.price || 0), 0) * (i.quantity || 1)
      : 0
    return s + base + optsSum
  }, 0)

  const taxaVal     = toNum(order.deliveryFee || 0)
  const descontoVal = toNum(order.discount || order.couponDiscount || 0)
  const subtotalVal = toNum(order.subtotal) || itemsTotal
  const totalVal    = toNum(order.total)

  return {
    // Placeholders do ReceiptTemplateEditor
    header_name:       settingsHeaderName.value || order.headerName || order.storeName || order.store?.name || 'Delivery',
    header_city:       settingsHeaderCity.value || order.headerCity || '',
    display_id:        String(order.displayId || order.displaySimple || order.id || '---'),
    data_pedido:       `${pad2(createdAt.getDate())}/${pad2(createdAt.getMonth()+1)}/${createdAt.getFullYear()}`,
    hora_pedido:       `${pad2(createdAt.getHours())}:${pad2(createdAt.getMinutes())}`,
    tipo_pedido,
    nome_cliente:      order.customer?.name || order.customer?.fullName || order.customerName || '',
    telefone_cliente:  order.customer?.whatsapp || order.customer?.phone || order.customerPhone || '',
    endereco_cliente,
    subtotal:          subtotalVal > 0 ? fmtN(subtotalVal) : '0,00',
    taxa_entrega:      taxaVal > 0     ? fmtN(taxaVal)     : '',
    desconto:          descontoVal > 0 ? fmtN(descontoVal) : '',
    total:             totalVal > 0    ? fmtN(totalVal)    : '0,00',
    observacoes:       order.notes || order.observation || '',
    total_itens_count: String(items.reduce((s, i) => s + (i.quantity || 1), 0)),
    // Internos (usados pelo renderizador de blocos, não expostos no template texto)
    _items:       items,
    _rawPayments: rawPayments,
  }
}

function substituteVars(str, ctx) {
  return str.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const val = ctx[key]
    return (val !== undefined && val !== null) ? String(val) : ''
  })
}

// ── Renderizador de blocos para texto puro (preview no navegador) ─────────────
const COL = 42   // colunas do preview (browser usa fonte monoespaçada)

function renderBlocks(blocks, order) {
  const ctx   = buildContext(order)
  const lines = []

  function sep() { lines.push('-'.repeat(COL)) }
  function center(text) {
    const t   = String(text || '')
    const pad = Math.max(0, Math.floor((COL - t.length) / 2))
    lines.push(' '.repeat(pad) + t)
  }
  function padRight(left, right) {
    const gap = Math.max(1, COL - left.length - right.length)
    lines.push(left + ' '.repeat(gap) + right)
  }

  for (const block of blocks) {
    switch (block.t) {

      case 'sep':
        sep()
        break

      case 'text':
      case 'cond': {
        if (block.t === 'cond' && !ctx[block.key]) break
        const content = substituteVars(block.c || '', ctx)
        if (block.a === 'center') center(content)
        else lines.push(content)
        break
      }

      case 'items': {
        for (const item of (ctx._items || [])) {
          const qty      = item.quantity || 1
          const base     = toNum(item.price)
          const optsSum  = Array.isArray(item.options)
            ? item.options.reduce((s, o) => s + toNum(o.price || 0), 0)
            : 0
          const unitPrice = base + optsSum
          const total     = unitPrice * qty

          const nameStr  = `${qty}x ${item.name || ''}`
          const priceStr = fmtBRL(total)
          padRight(nameStr, priceStr)

          // Complementos / opções
          if (Array.isArray(item.options)) {
            for (const opt of item.options) {
              const optPrice = toNum(opt.price || 0)
              lines.push(`   + ${opt.name || ''}${optPrice > 0 ? ': ' + fmtBRL(optPrice) : ''}`)
            }
          }

          // Observação do item
          const obs = item.notes || item.observation || ''
          if (obs) lines.push(`   Obs: ${obs}`)
        }
        break
      }

      case 'payments': {
        for (const p of (ctx._rawPayments || [])) {
          const method = p.method || p.name || p.tipo || p.paymentMethod || ''
          const value  = toNum(p.value || p.amount || p.valor || 0)
          lines.push(`${method}: ${fmtBRL(value)}`)
        }
        break
      }

      case 'qr':
        // QR é renderizado visualmente abaixo do texto; aqui apenas espaço
        break
    }
  }

  return lines.join('\n')
}

// ── Layout fallback (quando não há template de blocos) ───────────────────────
function renderFallback(order) {
  const ctx   = buildContext(order)
  const lines = []

  function sep() { lines.push('-'.repeat(COL)) }
  function padRight(left, right) {
    const gap = Math.max(1, COL - left.length - right.length)
    lines.push(left + ' '.repeat(gap) + right)
  }

  lines.push(`#${ctx.display_id}  ${ctx.data_pedido} ${ctx.hora_pedido}`)
  if (ctx.tipo_pedido) lines.push(`Tipo: ${ctx.tipo_pedido}`)
  sep()
  lines.push(`Cliente:   ${ctx.nome_cliente || '—'}`)
  lines.push(`Telefone:  ${ctx.telefone_cliente || '—'}`)
  if (ctx.endereco_cliente) lines.push(`Endereço:  ${ctx.endereco_cliente}`)
  sep()
  lines.push('ITENS')
  lines.push('')
  for (const item of (ctx._items || [])) {
    const qty      = item.quantity || 1
    const base     = toNum(item.price)
    const optsSum  = Array.isArray(item.options)
      ? item.options.reduce((s, o) => s + toNum(o.price || 0), 0)
      : 0
    const unitPrice = base + optsSum
    padRight(`${qty}x ${item.name || ''}`, fmtBRL(unitPrice * qty))
    if (Array.isArray(item.options)) {
      for (const opt of item.options) {
        const optPrice = toNum(opt.price || 0)
        lines.push(`   + ${opt.name || ''}${optPrice > 0 ? ': ' + fmtBRL(optPrice) : ''}`)
      }
    }
    const obs = item.notes || item.observation || ''
    if (obs) lines.push(`   Obs: ${obs}`)
  }
  sep()
  lines.push(`Sub-total: ${fmtBRL(toNum(ctx.subtotal.replace(',', '.')))}`)
  if (ctx.taxa_entrega) lines.push(`Entrega:   ${fmtBRL(toNum(ctx.taxa_entrega.replace(',', '.')))}`)
  if (ctx.desconto)     lines.push(`Desconto:  -${fmtBRL(toNum(ctx.desconto.replace(',', '.')))}`)
  lines.push(`TOTAL:     ${fmtBRL(toNum(ctx.total.replace(',', '.')))}`)
  sep()
  if (ctx._rawPayments.length > 0) {
    for (const p of ctx._rawPayments) {
      const method = p.method || p.name || p.tipo || p.paymentMethod || ''
      const value  = toNum(p.value || p.amount || p.valor || 0)
      lines.push(`${method}: ${fmtBRL(value)}`)
    }
    sep()
  }
  if (ctx.observacoes) lines.push(`Obs: ${ctx.observacoes}`)

  return lines.join('\n')
}

// ── ticketText: decide qual renderer usar ─────────────────────────────────────
const ticketText = computed(() => {
  const o = props.order || {}
  if (blockTemplate.value) {
    return renderBlocks(blockTemplate.value, o)
  }
  return renderFallback(o)
})
</script>

<style scoped>
.ticket-preview {
  font-family: 'Courier New', Courier, monospace;
  max-width: 520px;
  border: 0;
  background: transparent;
}
.ticket-mono {
  font-family: 'Courier New', Courier, monospace;
  font-size: 13px;
  line-height: 1.4;
  white-space: pre;
  margin: 0;
}
.qr-wrap img { border: 0; }
</style>
