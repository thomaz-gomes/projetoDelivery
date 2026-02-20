<script setup>
import { onMounted, ref, computed } from 'vue';
import Swal from 'sweetalert2'
import { useRoute } from 'vue-router';
import api from '../api';
import { formatDateTime } from '../utils/dates'
import { bindLoading } from '../state/globalLoading.js';
import QRCode from 'qrcode';

const route = useRoute();
const orderId = route.params.id;

const order = ref(null);
const qrDataUrl = ref('');
const loading = ref(true);
bindLoading(loading);
const error = ref('');
  const assocLoading = ref(false);

function fmt(v) { return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
function sum(arr) { return arr.reduce((a, b) => a + Number(b || 0), 0); }

function prettyProvider(p) {
  if (!p) return null;
  const s = String(p).trim();
  const map = { IFOOD: 'iFood', UBER: 'Uber', UBEREATS: 'UberEats', RAPPI: 'Rappi' };
  const up = s.toUpperCase();
  if (map[up]) return map[up];
  const lower = s.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function getOrderStoreLabel(order) {
  if (!order) return null;
  // prefer explicit store relation
  const storeName = order.store?.name || order.company?.store?.name || order.payload?.store?.name || order.payload?.merchant?.name || order.payload?.restaurantName || order.payload?.storeName || null;
  const channel = order.payload?.integration?.provider || order.payload?.provider || order.payload?.adapter || order.payload?.platform || order.payload?.source?.provider || order.payload?.channel || order.integration?.provider || order.adapter || null;
  if (!storeName) return null;
  const pretty = prettyProvider(channel);
  return pretty ? `${storeName} (${pretty})` : storeName;
}

function getOrderStoreName(order) {
  if (!order) return null;
  return order.store?.name || order.company?.store?.name || order.payload?.store?.name || order.payload?.merchant?.name || order.payload?.restaurantName || order.payload?.storeName || null;
}

function getOrderChannelLabel(order) {
  if (!order) return null;
  const raw = order.payload?.integration?.provider || order.payload?.provider || order.payload?.adapter || order.payload?.platform || order.payload?.source?.provider || order.payload?.channel || order.integration?.provider || order.adapter || order.payload?.source || null;
  const map = { IFOOD: 'iFood', UBER: 'Uber', UBEREATS: 'UberEats', RAPPI: 'Rappi', PDV: 'PDV', POS: 'PDV', PUBLIC: 'Cardápio digital', WEB: 'Cardápio digital', MENU: 'Cardápio digital', 'CARDAPIO_DIGITAL': 'Cardápio digital' };
  if (!raw) {
    const src = order.customerSource || order.payload?.source || null;
    if (src) {
      const up = String(src).toUpperCase();
      if (map[up]) return map[up];
    }
    return null;
  }
  const up = String(raw).toUpperCase();
  if (map[up]) return map[up];
  const s = String(raw).toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// iFood: payload pode ser envelope { order: {...} } ou objeto direto
function resolveIfoodPayload(order) {
  const p = order?.payload || {};
  // envelope: { provider: "IFOOD", order: { payments, items, customer, delivery } }
  return p.order || p;
}

// Itens ricos do payload (têm subitems/options/observations)
const richItems = computed(() => {
  if (!order.value) return [];
  const ip = resolveIfoodPayload(order.value);
  const payloadItems = ip.items || null;
  if (payloadItems && payloadItems.length > 0) return payloadItems;
  return order.value.items || [];
});

// Campos iFood
const ifoodPickupCode = computed(() => {
  if (!order.value) return null;
  const ip = resolveIfoodPayload(order.value);
  return ip.delivery?.pickupCode || null;
});

const ifoodLocalizer = computed(() => {
  if (!order.value) return null;
  const ip = resolveIfoodPayload(order.value);
  return ip.customer?.phone?.localizer || null;
});

const totals = computed(() => {
  if (!order.value) return null;
  const payload = order.value.payload || {};
  const ip = resolveIfoodPayload(order.value); // unwrap iFood envelope
  const totalBlock = ip.total || payload.total || {};

  const itemsTotal = sum((order.value.items || []).map(i => i.price));
  const subTotal = Number(totalBlock.subTotal ?? itemsTotal);
  const deliveryFee = Number(order.value.deliveryFee ?? totalBlock.deliveryFee ?? 0);
  const additionalFees = Number(totalBlock.additionalFees ?? 0);
  const benefits = Number(totalBlock.benefits ?? 0); // descontos
  const orderAmount = Number(
    totalBlock.orderAmount ??
    order.value.total ??
    (subTotal + deliveryFee + additionalFees - benefits)
  );
  const qtyItems = sum(richItems.value.map(i => i.quantity ?? 1));

  // payments: tenta envelope iFood e fallback para payload direto
  const payments = ip.payments || payload.payments || {};
  const methods = payments.methods || [];
  const cash = sum(methods.filter(m => m.method === 'CASH').map(m => m.value));
  const prepaid = Number(payments.prepaid ?? sum(methods.filter(m => m.prepaid).map(m => m.value)));
  const pending = Number(payments.pending ?? (orderAmount - prepaid));
  const troco = cash > pending ? (cash - pending) : 0;

  return { subTotal, deliveryFee, additionalFees, benefits, orderAmount, qtyItems, cash, prepaid, pending, troco, methods };
});

onMounted(async () => {
  try {
    // 1) Detalhe do pedido
    const { data } = await api.get(`/orders/${orderId}`);
    order.value = data;

    // 2) Gera ticket (QR) e converte em imagem
    const { data: t } = await api.post(`/orders/${orderId}/tickets`);
    qrDataUrl.value = await QRCode.toDataURL(t.qrUrl, { width: 180, margin: 1 });

    loading.value = false;

    // 3) Auto-print
    setTimeout(() => window.print(), 300);
  } catch (e) {
    console.error(e);
    error.value = e?.response?.data?.message || 'Falha ao montar comanda';
    loading.value = false;
  }
});

function extractAddress(order) {
  if (!order) return '';
  const formatAddrObj = (addr) => {
    if (!addr) return '';
    const formatted = addr.formatted || addr.formattedAddress || addr.formatted_address;
    if (formatted) return String(formatted);
    const street = addr.street || addr.streetName || '';
    const number = addr.number || addr.streetNumber || '';
    const complement = addr.complement || addr.complemento || '';
    const neighborhood = addr.neighborhood || '';
    const city = addr.city || '';
    const state = addr.state || '';
    const postalCode = addr.postalCode || addr.zip || '';
    const reference = addr.reference || addr.ref || '';
    const observation = addr.observation || addr.observacao || '';
    const base = [street, number].filter(Boolean).join(', ');
    const tailParts = [neighborhood, city, state].filter(Boolean);
    if (postalCode) tailParts.push(postalCode);
    if (complement) tailParts.push('Comp: ' + complement);
    if (reference) tailParts.push('Ref: ' + reference);
    if (observation) tailParts.push('Obs: ' + observation);
    const tail = tailParts.filter(Boolean).join(' - ');
    return [base, tail].filter(Boolean).join(' | ');
  };

  if (order.address && typeof order.address === 'object') return formatAddrObj(order.address);
  if (typeof order.address === 'string' && order.address) return order.address;

  const maybeObj = order.payload?.delivery?.deliveryAddress || order.payload?.deliveryAddress || order.payload?.delivery?.address || order.payload?.order?.delivery?.address || order.payload?.shippingAddress || order.payload?.shipping?.address || order.payload?.rawPayload?.deliveryAddress || order.payload?.rawPayload?.address;
  if (maybeObj) {
    if (typeof maybeObj === 'string') return maybeObj;
    return formatAddrObj(maybeObj);
  }

  return order.address ||
    order.payload?.delivery?.deliveryAddress?.formattedAddress ||
    order.payload?.deliveryAddress?.formattedAddress ||
    order.payload?.delivery?.address?.formattedAddress ||
    order.payload?.order?.delivery?.address?.formattedAddress ||
    order.payload?.rawPayload?.address?.formattedAddress ||
    '';
}

function getAddressObj(order) {
  if (!order) return null;
  // prefer normalized delivery address
  const d = order.payload?.delivery?.deliveryAddress || order.payload?.deliveryAddress || order.payload?.rawPayload?.address || null;
  if (d) return d;
  if (order.address && typeof order.address === 'object') return order.address;
  return null;
}

function getMainAddress(order) {
  const a = getAddressObj(order);
  if (!a) return order.address || '';
  return a.formatted || a.formattedAddress || [a.street || a.streetName, a.number || a.streetNumber].filter(Boolean).join(', ');
}

async function associateCustomer() {
  if (!order.value) return;
  assocLoading.value = true;
  try {
    const { data } = await api.post(`/orders/${orderId}/associate-customer`);
  if (data && data.order) order.value = data.order;
  await Swal.fire({ icon: 'success', text: 'Cliente associado: ' + (data.customer?.fullName || 'ok') })
  } catch (e) {
  console.error(e);
  await Swal.fire({ icon: 'error', text: 'Falha ao associar cliente: ' + (e?.response?.data?.message || e?.message || 'erro') })
  } finally { assocLoading.value = false; }
}
</script>

<template>
  <div class="paper">
    <div v-if="loading" class="center">Gerando comanda...</div>
    <div v-else-if="error" class="center err">{{ error }}</div>
    <div v-else>
      <header class="hdr">
  <h1>
    {{ (getOrderStoreName(order) ? (getOrderStoreName(order) + (getOrderChannelLabel(order) ? ' | ' + getOrderChannelLabel(order) : '')) : (order.company?.name || 'Minha Empresa')) }}
  </h1>
  <div class="muted">Comanda / Pedido {{ order.displaySimple != null ? String(order.displaySimple).padStart(2,'0') : (order.displayId != null ? String(order.displayId).padStart(2,'0') : order.id.slice(0,6)) }}</div>
  <div class="muted">{{ formatDateTime(order?.createdAt) }}</div>
        <div v-if="order.payload && order.payload.nfe && order.payload.nfe.nProt" class="protocol small">Protocolo NFe: {{ order.payload.nfe.nProt }}</div>
      </header>

      <section class="sec">
        <div style="display:flex;gap:8px;align-items:center"><div><b>Cliente:</b> {{ order.customerName || '-' }}</div>
          <div>
            <button @click="associateCustomer" :disabled="assocLoading">{{ assocLoading ? 'Associando...' : 'Associar cliente' }}</button>
          </div>
        </div>
        <div v-if="ifoodLocalizer" class="small muted">Localizador: <b>{{ ifoodLocalizer }}</b></div>
        <div class="small">
          <b>Endereço:</b>
          <div>{{ getMainAddress(order) || '-' }}</div>
          <div v-if="getAddressObj(order) && (getAddressObj(order).streetNumber || getAddressObj(order).number)" class="muted">Nº: {{ getAddressObj(order).streetNumber || getAddressObj(order).number }}</div>
          <div v-if="getAddressObj(order) && (getAddressObj(order).complement || getAddressObj(order).complemento)" class="muted">Comp.: {{ getAddressObj(order).complement || getAddressObj(order).complemento }}</div>
          <div v-if="getAddressObj(order) && (getAddressObj(order).reference || getAddressObj(order).referencia)" class="muted">Ref.: {{ getAddressObj(order).reference || getAddressObj(order).referencia }}</div>
          <div v-if="getAddressObj(order) && (getAddressObj(order).observation || getAddressObj(order).observacao)" class="muted">Obs.: {{ getAddressObj(order).observation || getAddressObj(order).observacao }}</div>
          <div v-if="getAddressObj(order) && getAddressObj(order).neighborhood" class="muted">{{ getAddressObj(order).neighborhood }}</div>
        </div>
        <div v-if="ifoodPickupCode" class="pickup-code">
          <span class="muted small">Cód. Coleta:</span> <b>{{ ifoodPickupCode }}</b>
        </div>
      </section>

      <section class="sec">
        <div class="row head"><div>Qt.</div><div class="grow">Descrição</div><div>Valor</div></div>
        <div v-for="(it, idx) in richItems" :key="it.id || idx" class="row">
          <div>{{ it.quantity || 1 }}</div>
          <div class="grow">
            <div>{{ it.name }}</div>
            <div v-for="(sub, si) in (it.subitems || it.garnishItems || it.options || it.addons || [])" :key="si" class="notes">
              + {{ sub.quantity > 1 ? sub.quantity + 'x ' : '' }}{{ sub.name || sub.description }}
            </div>
            <div v-if="it.notes || it.observations || it.observation" class="notes">Obs: {{ it.notes || it.observations || it.observation }}</div>
          </div>
          <div>{{ fmt(it.totalPrice || it.price || (it.unitPrice * (it.quantity || 1))) }}</div>
        </div>
        <div class="muted small">Quantidade de itens: {{ totals.qtyItems }}</div>
      </section>

      <section class="sec totals">
        <div class="line"><span>Total itens(=)</span><span>{{ fmt(totals.subTotal) }}</span></div>
        <div class="line"><span>Taxa de entrega(+)</span><span>{{ fmt(totals.deliveryFee) }}</span></div>
        <div class="line"><span>Taxas adicionais(+)</span><span>{{ fmt(totals.additionalFees) }}</span></div>
        <div class="line"><span>Desconto(-)</span><span>{{ fmt(totals.benefits) }}</span></div>
        <div class="line total"><span>TOTAL(=)</span><span>{{ fmt(totals.orderAmount) }}</span></div>
      </section>

      <section class="sec">
        <div class="line"><span>Forma de pagamento</span></div>
        <div v-for="(m,idx) in totals.methods" :key="idx" class="line small">
          <span>{{ m.prepaid ? 'Online' : 'Loja' }} - {{ m.method }}</span>
          <span>{{ fmt(m.value) }}</span>
        </div>
        <div class="line"><span>Dinheiro</span><span>{{ fmt(totals.cash) }}</span></div>
        <div class="line"><span>- Receber</span><span>{{ fmt(totals.pending) }}</span></div>
        <div class="line"><span>- Troco</span><span>{{ fmt(totals.troco) }}</span></div>
      </section>

      <section class="sec center">
        <img v-if="qrDataUrl" :src="qrDataUrl" alt="QR" />
        <div class="muted small">Escaneie para despachar</div>
      </section>

    <footer class="center small muted">
  Status: {{ order.status }} • Pedido: {{ order.displaySimple != null ? String(order.displaySimple).padStart(2,'0') : (order.displayId != null ? String(order.displayId).padStart(2,'0') : order.id) }}
    </footer>
    </div>
  </div>
</template>

<style scoped>
/* estilo cupom 80mm */
.paper { width: 80mm; margin: 0 auto; padding: 8px; font: 14px/1.2 Arial, ui-sans-serif; color:#000; background:#fff; }
@media print { body { margin:0; } .paper { box-shadow:none; } }
.center { text-align:center; }
.hdr h1 { font-size:16px; margin:0 0 2px; text-transform: uppercase; }
.muted { color:#555; }
.small { font-size:12px; }
.sec { border-top: 1px dashed #999; padding-top:6px; margin-top:6px; }
.row { display:flex; gap:8px; margin:4px 0; }
.row .grow { flex:1; }
.row .notes { color:#444; font-size:12px; }
.pickup-code { margin-top:4px; font-size:14px; letter-spacing:1px; }
.row.head { font-weight:600; border-bottom:1px solid #eee; padding-bottom:4px; }
.totals .line { display:flex; justify-content:space-between; margin:2px 0; }
.totals .total { font-weight:700; border-top:1px solid #000; padding-top:4px; }
img { margin-top:6px; }
.err { color:crimson; }
.protocol { display:inline-block; margin-top:6px; background:#e6f7ea; color:#116633; padding:4px 8px; border-radius:6px; font-weight:600; }
</style>