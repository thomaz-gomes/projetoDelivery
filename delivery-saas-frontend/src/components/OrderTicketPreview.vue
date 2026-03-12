<template>
  <div class="receipt-wrapper">
    <div class="receipt-paper">
      <div class="receipt-tear-top"></div>
      <div class="receipt-body">
        <div
          v-for="(line, i) in renderedLines"
          :key="i"
          :class="line.cls"
          :style="line.style"
          v-html="line.html"
        ></div>
        <!-- QR Code (rendered visually, not ESC/POS) -->
        <div v-if="qrSrc" class="rp-center" style="margin-top:8px">
          <div class="rp-muted">Rastreie seu pedido:</div>
          <img :src="qrSrc" class="rp-qr-img" alt="QR" />
        </div>
      </div>
      <div class="receipt-tear-bottom"></div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import api from '@/api.js'

const props = defineProps({
  order: { type: Object, required: true },
  printerSetting: { type: Object, default: null },
})

// ── Printer settings ──────────────────────────────────────────────────────────
const _fetchedSetting = ref(null)
onMounted(async () => {
  if (props.printerSetting) return
  try {
    const { data } = await api.get('/agent-setup')
    if (data.printerSetting) _fetchedSetting.value = data.printerSetting
  } catch (_) {}
})
const _ps = computed(() => props.printerSetting || _fetchedSetting.value)
const settingsHeaderName = computed(() => _ps.value?.headerName || '')
const settingsHeaderCity = computed(() => _ps.value?.headerCity || '')

// ── Helpers numéricos (idênticos ao templateEngine.js) ────────────────────────
function toNum(v) { if (v == null) return 0; const n = Number(v); return isFinite(n) ? n : 0 }
function fmtN(v) { return toNum(v).toFixed(2).replace('.', ',') }
function _fmt(v) { return 'R$ ' + fmtN(v) }

// ── Payment label (idêntico ao templateEngine.js _paymentLabel) ───────────────
function paymentLabel(p) {
  const base = p._systemLabel || p.method || p.name || p.tipo || p.paymentMethod || ''
  if (String(base).toLowerCase().includes('voucher')) return base
  const isPrepaid = p.prepaid === true || String(p.type || '').toUpperCase() === 'ONLINE'
  return `${base} - ${isPrepaid ? 'Pago Online' : 'Cobrar do cliente'}`
}

// ── QR Code ───────────────────────────────────────────────────────────────────
const qrSrc = computed(() => {
  const o = props.order || {}
  const url = o.qrText || o.trackingUrl || o.externalUrl || o.url || ''
  if (!url) return ''
  try { return `https://chart.googleapis.com/chart?cht=qr&chs=300x300&chl=${encodeURIComponent(url)}` }
  catch (_) { return '' }
})

// ── Build context (replica EXATA do buildContext do templateEngine.js) ─────────
function buildContext(order) {
  const createdAt = order.createdAt ? new Date(order.createdAt) : new Date()
  const pad2 = n => String(n).padStart(2, '0')

  const rawType = String(order.orderType || order.type || '').toLowerCase()
  const tipo = rawType === 'delivery' ? 'DELIVERY'
    : rawType === 'pickup' ? 'RETIRADA'
    : rawType === 'mesa'   ? 'MESA'
    : rawType              ? rawType.toUpperCase()
    : 'PEDIDO'
  const tipo_delivery = rawType === 'delivery'

  const da = (order.deliveryAddress && typeof order.deliveryAddress === 'object') ? order.deliveryAddress : {}
  const street       = da.street || da.streetName || da.logradouro || ''
  const streetNumber = da.number || da.streetNumber || da.numero || ''
  const complement   = da.complement || da.complemento || ''
  const neighborhood = da.neighborhood || da.bairro || da.district || ''
  const city         = da.city || da.cidade || ''
  const reference    = da.reference || da.referencia || ''
  const flatAddress  = order.address || ''

  const pl = order.payload || {}
  const ifoodPl = pl.order || pl

  // Pagamentos
  const ifoodPmtsBc = ifoodPl.payments || null
  const rawPayments = Array.isArray(order.payments) ? order.payments
    : (ifoodPmtsBc?.methods && Array.isArray(ifoodPmtsBc.methods)) ? ifoodPmtsBc.methods
    : Array.isArray(ifoodPmtsBc) ? ifoodPmtsBc
    : Array.isArray(pl.paymentConfirmed) ? pl.paymentConfirmed
    : (pl.payment && typeof pl.payment === 'object') ? [pl.payment]
    : []

  const loja_nome = settingsHeaderName.value || order.headerName || order.store?.name || order.storeName || pl.storeName || 'Delivery'
  const totalItensCount = (order.items || []).reduce((s, i) => s + (i.quantity || 1), 0)

  // Data curta
  const meses = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez']
  const hora = `${pad2(createdAt.getHours())}:${pad2(createdAt.getMinutes())}`
  const data_curta = `${pad2(createdAt.getDate())}/${meses[createdAt.getMonth()]} - ${hora}`

  const localizador_bc = ifoodPl.customer?.phones?.[0]?.localizer || ifoodPl.customer?.phone?.localizer || ''
  const localizador_suffix = localizador_bc ? `, Localizador: ${localizador_bc}` : ''

  // Totais — mesmo cálculo do templateEngine.js
  // Preferir itens do payload (unitPrice correto)
  const payloadItems = ifoodPl.items || pl.items || null
  const calcItems = (payloadItems && payloadItems.length > 0) ? payloadItems : (order.items || [])
  let calcSubtotal = 0
  for (const it of calcItems) {
    const qty = Number(it.quantity || 1)
    const base = toNum(it.unitPrice || it.price || 0)
    const opts = (it.subitems || it.garnishItems || it.options || [])
      .reduce((s, o) => s + toNum(o.unitPrice || o.price || 0) * Number(o.quantity || 1), 0)
    calcSubtotal += (base * qty) + (opts * qty)
  }

  const subtotalVal = toNum(order.subtotal) || calcSubtotal
  const taxaVal     = toNum(order.deliveryFee || 0)
  const acrescimoVal = toNum(ifoodPl.total?.additionalFees ?? 0)
  let descontoVal = toNum(order.discount || order.couponDiscount || 0)
  if (descontoVal <= 0 && Array.isArray(ifoodPl.benefits) && ifoodPl.benefits.length > 0) {
    for (const b of ifoodPl.benefits) descontoVal += toNum(b.value || 0)
  }
  const totalVal = toNum(order.total)

  // Troco
  const trocoRaw = toNum(order.payment?.changeFor || order.changeFor || ifoodPl.payments?.methods?.find(m => m.cash)?.cash?.changeFor || 0)

  // Itens com opções — mesmo formato do buildContext do templateEngine.js
  const items = (order.items || []).map(item => {
    const qty = item.quantity || 1
    const base = toNum(item.price)
    const optsSum = Array.isArray(item.options)
      ? item.options.reduce((s, o) => s + toNum(o.price || 0) * Number(o.quantity || 1), 0)
      : 0
    const itemTotal = (base * qty) + (optsSum * qty)
    const optLines = Array.isArray(item.options) && item.options.length > 0
      ? item.options.map(o => {
          const op = toNum(o.price || 0)
          const oqty = Number(o.quantity || 1)
          const totalQty = oqty * qty
          const totalSuffix = qty > 1 ? ` (${totalQty} total)` : ''
          if (oqty > 1) {
            return `   -${oqty}x ${o.name || ''}${op > 0 ? ': R$ ' + fmtN(op) : ''}${totalSuffix}`
          }
          return `   + ${o.name || ''}${op > 0 ? ': R$ ' + fmtN(op) : ''}${totalSuffix}`
        }).join('\n')
      : ''
    return {
      qtd: String(qty),
      nome: item.name || item.productName || '',
      obs: item.notes || item.observation || '',
      preco_val: fmtN(itemTotal),
      tem_opcoes: !!(Array.isArray(item.options) && item.options.length > 0),
      opcoes: optLines,
    }
  })

  // Se payload tem itens com subitems mas order.items não (DB sem opções), usar payload
  const payloadRenderedItems = (payloadItems && payloadItems.length > 0)
    ? payloadItems.map(it => {
        const qty = Number(it.quantity || 1)
        const base = toNum(it.unitPrice || it.price || 0)
        const subs = it.subitems || it.garnishItems || it.options || []
        const optsSum = Array.isArray(subs) ? subs.reduce((s, o) => s + toNum(o.unitPrice || o.price || 0) * Number(o.quantity || 1), 0) : 0
        const itemTotal = (base * qty) + (optsSum * qty)
        const optLines = Array.isArray(subs) && subs.length > 0
          ? subs.map(o => {
              const op = toNum(o.unitPrice || o.price || 0)
              const oqty = Number(o.quantity || 1)
              const totalQty = oqty * qty
              const totalSuffix = qty > 1 ? ` (${totalQty} total)` : ''
              if (oqty > 1) return `   -${oqty}x ${o.name || o.description || ''}${op > 0 ? ': R$ ' + fmtN(op) : ''}${totalSuffix}`
              return `   + ${o.name || o.description || ''}${op > 0 ? ': R$ ' + fmtN(op) : ''}${totalSuffix}`
            }).join('\n')
          : ''
        return {
          qtd: String(qty),
          nome: it.name || it.productName || '',
          obs: it.observations || it.notes || '',
          preco_val: fmtN(itemTotal),
          tem_opcoes: !!(Array.isArray(subs) && subs.length > 0),
          opcoes: optLines,
        }
      })
    : null

  // Usar payload items (mais ricos) se disponíveis
  const finalItems = payloadRenderedItems || items

  // Pagamentos com label (Pago Online / Cobrar do cliente)
  const pagamentos = [
    ...rawPayments.map(p => ({
      metodo: paymentLabel(p),
      valor_num: fmtN(toNum(p.value || p.amount || p.valor || 0)),
    })),
    ...(descontoVal > 0 ? [{
      metodo: order.couponCode ? `Voucher (${order.couponCode})`
        : (ifoodPl.benefits?.[0]?.description || ifoodPl.benefits?.[0]?.title)
          ? `Voucher (${ifoodPl.benefits[0].description || ifoodPl.benefits[0].title})`
          : 'Voucher Desconto',
      valor_num: fmtN(descontoVal),
    }] : []),
  ]

  const link_pedido = order.qrText || order.trackingUrl || ''

  return {
    loja_nome,
    display_id:   order.displayId || order.displaySimple || order.id || '---',
    data_curta,
    hora,
    tipo,
    cliente_nome: order.customer?.name || order.customerName || pl.customerName || '',
    cliente_tel:  order.customer?.phone || order.customerPhone || pl.customerPhone || '',
    localizador_suffix,
    tipo_delivery,
    endereco_completo: flatAddress || [street, streetNumber, complement, neighborhood, city].filter(Boolean).join(', '),
    tem_obs: !!(order.notes || order.observation),
    obs_pedido: order.notes || order.observation || '',
    items: finalItems,
    total_itens_count: String(totalItensCount),
    subtotal_val: fmtN(subtotalVal),
    taxa_val: fmtN(taxaVal),
    acrescimo_val: fmtN(acrescimoVal),
    desconto_val: fmtN(descontoVal),
    total_val: fmtN(totalVal),
    pagamentos,
    tem_troco: trocoRaw > 0,
    troco: fmtN(trocoRaw),
    canal: order.source || order.channel || order.canal || pl.source || ifoodPl.salesChannel || '',
    tem_qr: !!link_pedido,
    link_pedido,
  }
}

// ── Template texto 80mm (MESMA string do defaultTemplate.js) ──────────────────
const TEMPLATE = `[ALIGN:center]
[BOLD:on]
[SIZE:2]
{{tipo}}
[SIZE:1]
[BOLD:off]
[ALIGN:right]
{{data_curta}}
[ALIGN:left]
[BOLD:on]
Pedido: #{{display_id}}
[BOLD:off]
{{cliente_nome}}
Telefone: {{cliente_tel}}{{localizador_suffix}}
{{#if tipo_delivery}}
{{endereco_completo}}
{{/if}}{{#if tem_obs}}
Obs: {{obs_pedido}}
{{/if}}[SEP]
[ROW:Qt.Descricao|Valor]

{{#each items}}[BOLD:on]
[ROW:{{qtd}}  {{nome}}|{{preco_val}}]
[BOLD:off]
{{#if tem_opcoes}}{{opcoes}}
{{/if}}{{#if obs}}   Obs: {{obs}}
{{/if}}
{{/each}}[SEP]
[ROW:Quantidade de itens:|{{total_itens_count}}]

[ROW:Total Itens(=)|{{subtotal_val}}]
[ROW:Taxa entrega(+)|{{taxa_val}}]
[ROW:Acrescimo(+)|{{acrescimo_val}}]
[ROW:Desconto(-)|{{desconto_val}}]
[ROW:TOTAL(=)|{{total_val}}]

[SEP]
[SIZE:1]
[INV:on]
[BOLD:on]
Forma de pagamento
[BOLD:off]
{{#each pagamentos}}[ROW:{{metodo}}|{{valor_num}}]
{{/each}}[INV:off]
{{#if tem_troco}}[BOLD:on]
Troco para R$ {{troco}}
[BOLD:off]
{{/if}}[SIZE:1]
[SEP:- ]
{{loja_nome}}
{{#if canal}}
Op: {{canal}}
{{/if}}`

// ── Template engine (replica EXATA do processTemplate do templateEngine.js) ───
function resolveIfBlocks(tmpl, ctx) {
  let prev
  do {
    prev = tmpl
    tmpl = tmpl.replace(/\{\{#if (\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_, key, body) => {
      return ctx[key] ? body : ''
    })
  } while (tmpl !== prev)
  return tmpl
}

function resolveBlocks(tmpl, ctx) {
  tmpl = tmpl.replace(/\{\{#each (\w+)\}\}([\s\S]*?)\{\{\/each\}\}/g, (_, key, body) => {
    const arr = ctx[key]
    if (!Array.isArray(arr) || arr.length === 0) return ''
    return arr.map(item => {
      const merged = { ...ctx, ...item }
      const resolved = resolveIfBlocks(body, merged)
      return substituteVars(resolved, merged)
    }).join('')
  })
  tmpl = resolveIfBlocks(tmpl, ctx)
  return tmpl
}

function substituteVars(str, ctx) {
  return str.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_, key) => {
    const val = key.split('.').reduce((o, k) => (o != null ? o[k] : undefined), ctx)
    return val !== undefined && val !== null ? String(val) : ''
  })
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
}

// ── Parse template directives into renderable lines ───────────────────────────
const COL = 48  // 80mm = 48 colunas

function processToLines(template, ctx) {
  let resolved = resolveBlocks(template, ctx)
  resolved = substituteVars(resolved, ctx)

  const result = []
  // State
  let bold = false
  let sizeMult = 1
  let align = 'left'
  let invert = false

  for (const rawLine of resolved.split('\n')) {
    const trimmed = rawLine.trimEnd()
    if (!trimmed && !invert) { result.push({ html: '&nbsp;', cls: 'rp-line', style: '' }); continue }

    // Directives
    if (trimmed === '[SEP]' || trimmed === '[SEP:-]') {
      result.push({ html: '', cls: 'rp-sep', style: '' }); continue
    }
    if (trimmed === '[SEP:=]') {
      result.push({ html: '', cls: 'rp-sep rp-sep-double', style: '' }); continue
    }
    if (trimmed === '[SEP:- ]') {
      result.push({ html: '', cls: 'rp-sep rp-sep-spaced', style: '' }); continue
    }
    if (trimmed === '[CUT]') continue
    if (/^\[BOLD:(on|off)\]$/i.test(trimmed)) {
      bold = trimmed.toLowerCase().includes('on'); continue
    }
    if (/^\[SIZE:(\d)\]$/.test(trimmed)) {
      sizeMult = parseInt(trimmed.match(/\[SIZE:(\d)\]/)[1]); continue
    }
    if (/^\[ALIGN:(left|center|right)\]$/i.test(trimmed)) {
      align = trimmed.match(/\[ALIGN:(\w+)\]/i)[1].toLowerCase(); continue
    }
    if (/^\[FEED:(\d+)\]$/.test(trimmed)) continue
    if (/^\[INV:(on|off)\]$/i.test(trimmed)) {
      invert = trimmed.toLowerCase().includes('on'); continue
    }
    if (/^\[QR:(.+)\]$/.test(trimmed)) continue // QR handled by <img>

    // ROW directive
    if (/^\[ROW:(.+)\]$/.test(trimmed)) {
      const content = trimmed.match(/^\[ROW:(.+)\]$/)[1]
      const lastPipe = content.lastIndexOf('|')
      if (lastPipe > 0) {
        const left = escHtml(content.slice(0, lastPipe))
        const right = escHtml(content.slice(lastPipe + 1))
        const classes = ['rp-row']
        if (bold) classes.push('rp-bold')
        if (invert) classes.push('rp-inv')
        const style = sizeMult > 1 ? `font-size:${12.5 * sizeMult}px` : ''
        result.push({
          html: `<span class="rp-row-l">${left}</span><span class="rp-row-r">${right}</span>`,
          cls: classes.join(' '),
          style,
        })
        continue
      }
    }

    // Regular text line
    const classes = ['rp-line']
    if (bold) classes.push('rp-bold')
    if (align === 'center') classes.push('rp-center')
    if (align === 'right') classes.push('rp-right')
    if (invert) classes.push('rp-inv')
    const style = sizeMult > 1 ? `font-size:${12.5 * sizeMult}px` : ''
    result.push({ html: escHtml(trimmed), cls: classes.join(' '), style })
  }

  return result
}

// ── Computed: rendered lines ──────────────────────────────────────────────────
const renderedLines = computed(() => {
  const ctx = buildContext(props.order || {})
  return processToLines(TEMPLATE, ctx)
})
</script>

<style scoped>
.receipt-wrapper {
  display: flex;
  justify-content: center;
  padding: 8px 0;
}
.receipt-paper {
  width: 340px;
  background: #fefefe;
  box-shadow: 0 2px 8px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.04);
  font-family: 'Courier New', Courier, 'Lucida Console', monospace;
  font-size: 12.5px;
  line-height: 1.45;
  color: #1a1a1a;
  overflow: hidden;
}

/* Papel rasgado */
.receipt-tear-top,
.receipt-tear-bottom { height: 10px }
.receipt-tear-top {
  background:
    linear-gradient(135deg, #f0f0f0 33.33%, transparent 33.33%) 0 0 / 8px 10px,
    linear-gradient(225deg, #f0f0f0 33.33%, transparent 33.33%) 0 0 / 8px 10px;
}
.receipt-tear-bottom {
  background:
    linear-gradient(315deg, #f0f0f0 33.33%, transparent 33.33%) 0 0 / 8px 10px,
    linear-gradient(45deg, #f0f0f0 33.33%, transparent 33.33%) 0 0 / 8px 10px;
}

.receipt-body {
  padding: 4px 14px 14px;
}

/* ── Line types ── */
.rp-line {
  white-space: pre-wrap;
  word-break: break-word;
}
.rp-bold { font-weight: 700 }
.rp-center { text-align: center }
.rp-right { text-align: right }

/* Invertido (branco no preto) */
.rp-inv {
  background: #222;
  color: #fff;
  margin-left: -14px;
  margin-right: -14px;
  padding-left: 14px;
  padding-right: 14px;
}

/* Separadores */
.rp-sep {
  border-top: 1.5px dashed #888;
  margin: 4px 0;
  height: 0;
}
.rp-sep-double { border-top-style: double; border-top-width: 3px }
.rp-sep-spaced { border-top-style: dotted; border-top-width: 1.5px }

/* ROW: esquerda/direita */
.rp-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 6px;
  white-space: nowrap;
}
.rp-row-l {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.rp-row-r {
  flex-shrink: 0;
  text-align: right;
}

/* QR */
.rp-qr-img {
  width: 140px;
  height: 140px;
  margin-top: 4px;
  image-rendering: pixelated;
}
.rp-muted { color: #666 }
</style>
