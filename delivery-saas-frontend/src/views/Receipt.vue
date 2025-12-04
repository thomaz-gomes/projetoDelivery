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

const totals = computed(() => {
  if (!order.value) return null;
  const payload = order.value.payload || {};
  const totalBlock = payload.total || {};

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
  const qtyItems = sum((order.value.items || []).map(i => i.quantity ?? 1));

  const payments = payload.payments || {};
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
  return order.address ||
    order.payload?.delivery?.deliveryAddress?.formattedAddress ||
    order.payload?.deliveryAddress?.formattedAddress ||
    order.payload?.delivery?.address?.formattedAddress ||
    order.payload?.delivery?.address ||
    order.payload?.order?.delivery?.address?.formattedAddress ||
    order.payload?.order?.delivery?.address ||
    order.payload?.shippingAddress?.formattedAddress ||
    order.payload?.shipping?.address?.formattedAddress ||
    order.payload?.delivery_address?.formatted_address ||
    order.payload?.rawPayload?.deliveryAddress?.formattedAddress ||
    order.payload?.rawPayload?.address?.formatted ||
    order.payload?.rawPayload?.address?.formattedAddress ||
    order.payload?.rawPayload?.address?.formatted_address ||
    order.rawPayload?.neighborhood ||
    (typeof order.rawPayload?.address === 'string' ? order.rawPayload.address : null) ||
    '';
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
        <div class="small"><b>Endereço:</b> {{ extractAddress(order) || '-' }}</div>
      </section>

      <section class="sec">
        <div class="row head"><div>Qt.</div><div class="grow">Descrição</div><div>Valor</div></div>
        <div v-for="it in order.items" :key="it.id" class="row">
          <div>{{ it.quantity || 1 }}</div>
          <div class="grow">
            <div>{{ it.name }}</div>
            <div v-if="it.notes" class="notes">Obs: {{ it.notes }}</div>
          </div>
          <div>{{ fmt(it.price) }}</div>
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
.row.head { font-weight:600; border-bottom:1px solid #eee; padding-bottom:4px; }
.totals .line { display:flex; justify-content:space-between; margin:2px 0; }
.totals .total { font-weight:700; border-top:1px solid #000; padding-top:4px; }
img { margin-top:6px; }
.err { color:crimson; }
.protocol { display:inline-block; margin-top:6px; background:#e6f7ea; color:#116633; padding:4px 8px; border-radius:6px; font-weight:600; }
</style>