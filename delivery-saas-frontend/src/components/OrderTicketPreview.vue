<template>
  <div class="ticket-preview p-3" ref="root">
      <div class="ticket-text">
        <pre class="ticket-mono">{{ ticketText }}</pre>
      </div>
      <div class="qr-wrap mt-2 text-center"><img :src="qrSrc" alt="qr" style="width:160px; height:160px;"/></div>
      <div class="text-center small text-muted mt-1">Escaneie para despachar</div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'

const props = defineProps({ order: { type: Object, required: true } })
const root = ref(null)

function formatCurrency(v){
  try{ return new Intl.NumberFormat('pt-BR',{ style: 'currency', currency: 'BRL' }).format(Number(v||0)) }catch(e){ return String(v||'0') }
}

const isIfood = computed(()=> {
  const o = props.order || {}
  return String(o.channel||o.source||'').toLowerCase().includes('ifood') || !!o.ifood
})

function padNumber(n) {
  if (n == null || n === '') return n || '';
  return String(n).toString().padStart(2, '0');
}

const paddedDisplay = computed(() => {
  const o = props.order || {}
  const d = o.displayId ?? o.displaySimple ?? o.display ?? null
  if (d != null) return padNumber(d)
  // try short id
  return String((o.id || '')).slice(0, 6)
})

const customerName = computed(() => {
  const o = props.order || {}
  return o.customer?.name || o.customer?.fullName || o.customerName || o.customer?.email || '-'
})
const addressLine = computed(() => {
  const o = props.order || {}
  const formatObj = (addr) => {
    if (!addr) return '';
    if (addr.formatted) return addr.formatted;
    const street = addr.street || addr.streetName || '';
    const number = addr.number || addr.streetNumber || '';
    const complement = addr.complement || addr.complemento || '';
    const neighborhood = addr.neighborhood || '';
    const city = addr.city || '';
    const reference = addr.reference || addr.ref || '';
    const obs = addr.observation || addr.observacao || '';
    const base = [street, number].filter(Boolean).join(' ');
    const parts = [base, complement, neighborhood, city].filter(Boolean);
    if (reference) parts.push('Ref: ' + reference);
    if (obs) parts.push('Obs: ' + obs);
    return parts.join(' | ') || '-';
  }
  // many payload shapes - try prioritized fields
  if (typeof o.address === 'string') return o.address
  if (o.address && typeof o.address === 'object') return formatObj(o.address)
  if (typeof o.customerAddress === 'string') return o.customerAddress
  if (o.customer && o.customer.address) {
    const ca = o.customer.address;
    if (typeof ca === 'string') return ca
    return formatObj(ca)
  }
  // payload fallbacks
  const maybe = o.payload?.delivery?.deliveryAddress || o.payload?.deliveryAddress || o.deliveryAddress || o.addressFormatted
  if (maybe) return (typeof maybe === 'string') ? maybe : (maybe.formatted || formatObj(maybe))
  return '-'
})
const phoneLine = computed(() => {
  const o = props.order || {}
  return o.customer?.whatsapp || o.customer?.phone || o.customerPhone || o.contact || o.phone || '-'
})

const ifoodLocator = computed(()=> {
  const o = props.order || {}
  return o.ifood?.externalCode || o.externalCode || o.ifoodExternalCode || null
})
const pickupCode = computed(()=> {
  const o = props.order || {}
  return o.pickupCode || o.pickup_code || o.retrievalCode || null
})

function sumItems(items){
  try{
    let s = 0
    for(const it of (items||[])){
      const qty = Number(it.quantity || 1) || 1
      const unit = Number(it.price || it.unitPrice || 0) || 0
      let optsSum = 0
      const opts = it.options || it.selectedOptions || []
      for(const op of opts) {
        const p = Number(op.price || op.unitPrice || 0) || 0
        const oq = Number(op.quantity || op.qty || 1) || 1
        optsSum += p * oq
      }
      s += (unit * qty) + (optsSum * qty)
    }
    return s
  }catch(e){ return 0 }
}

const subtotal = computed(()=> sumItems(props.order?.items))
const discountAmount = computed(()=> Number(props.order?.discount || props.order?.discountAmount || 0) || 0)
const totalComputed = computed(()=> Number(props.order?.total || subtotal.value - discountAmount.value) || 0)
const paymentMethod = computed(()=> props.order?.paymentMethod || props.order?.payment || props.order?.payload?.payment?.method || '—')
const changeFor = computed(()=> Number(props.order?.changeFor || props.order?.paymentChange || props.order?.change || 0) || 0)

function prettyChannel(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  const up = s.toUpperCase();
  const map = {
    IFOOD: 'iFood',
    UBER: 'Uber',
    UBEREATS: 'UberEats',
    RAPPI: 'Rappi',
    PDV: 'PDV',
    POS: 'PDV',
    PUBLIC: 'Cardápio digital',
    WEB: 'Cardápio digital',
    MENU: 'Cardápio digital',
    'CARDAPIO_DIGITAL': 'Cardápio digital'
  };
  if (map[up]) return map[up];
  const lower = s.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

const channelLabel = computed(()=> {
  const o = props.order || {}
  const raw = o.channel || o.source || o.payload?.integration?.provider || o.payload?.provider || o.payload?.platform || null
  return prettyChannel(raw) || 'Canal de venda'
})

const qrSrc = computed(()=>{
  const o = props.order || {}
  const url = o.url || o.externalUrl || (window && window.location && window.location.href) || String(o.id || '')
  try{ return `https://chart.googleapis.com/chart?cht=qr&chs=300x300&chl=${encodeURIComponent(url)}` }catch(e){ return '' }
})

function padRight(str, len){
  str = String(str || '');
  if (str.length >= len) return str;
  return str + ' '.repeat(len - str.length);
}

const ticketText = computed(() => {
  const o = props.order || {}
  const lines = []
  lines.push(`#${paddedDisplay.value} - Cliente: ${customerName.value}`)
  lines.push(`Endereço: ${addressLine.value}`)
  lines.push(`Telefone: ${phoneLine.value}`)
  if (isIfood.value) {
    lines.push(`Localizador:${ifoodLocator.value || '-'}${pickupCode.value ? `\nCódigo de retirada: ${pickupCode.value}` : ''}`)
  }
  lines.push('------------------------------')
  lines.push('Itens do pedido')
  lines.push('')

  const nameCol = 30
  for (const it of (o.items || [])){
    const qty = Number(it.quantity || 1) || 1
    const name = `${qty}x ${it.name}`
    const price = formatCurrency((Number(it.price)||0) * qty)
    const left = padRight(name, nameCol)
    lines.push(`${left}${price}`)
    const opts = it.options || it.selectedOptions || []
    for (const op of opts){
      const oq = Number(op.quantity || op.qty || it.quantity || 1) || 1
      const optPrice = formatCurrency(Number(op.price || op.unitPrice || 0) * oq)
      lines.push(`-   ${oq}x ${op.name} — ${optPrice}`)
    }
    lines.push('')
  }

  lines.push('------------------------------')
  lines.push(`Sub-total = ${formatCurrency(subtotal.value)}`)
  if (discountAmount.value && discountAmount.value > 0) lines.push(`Desconto: ${formatCurrency(discountAmount.value)}`)
  lines.push('')
  lines.push(`TOTAL a cobrar: ${formatCurrency(Number(o.total || totalComputed.value) || 0)}`)
  lines.push(`Pagamento: ${paymentMethod.value}`)
  if (changeFor.value && changeFor.value > 0) lines.push(`Troco para ${formatCurrency(changeFor.value)}`)
  lines.push('==============================')
  lines.push(`${channelLabel.value} - ${o.storeName || o.companyName || ''}`)
  lines.push('Obrigado e bom apetite!')
  lines.push('==============================')
  return lines.join('\n')
})
</script>

<style scoped>
.ticket-preview{ font-family: 'Courier New', monospace; max-width:380px; border:1px dashed #ccc; background:#fff }
.ticket-mono { font-family: 'Courier New', monospace; font-size:13px; line-height:1.2; }
.ticket-preview{ font-family: 'Courier New', monospace; max-width:520px; border:0; background:transparent }
.ticket-summary div { padding:2px 0 }
.qr-wrap img{ border:0 }
</style>
