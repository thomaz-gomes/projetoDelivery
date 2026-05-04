<template>
  <div class="container-fluid px-4 py-4">

    <!-- Page Header -->
    <div class="d-flex align-items-center justify-content-between mb-4">
      <div class="d-flex align-items-center gap-3">
        <BaseButton variant="ghost" @click="$router.back()">
          <i class="bi bi-arrow-left me-1"></i>Voltar
        </BaseButton>
        <div v-if="order">
          <div class="d-flex align-items-center gap-2 flex-wrap">
            <h4 class="mb-0 fw-bold">Pedido #{{ formatOrderNumber(order) }}</h4>
            <span class="badge rounded-pill" :class="getStatusClass(order.status)">{{ getStatusLabel(order.status) }}</span>
          </div>
          <small class="text-muted">{{ formatDateTime(order.createdAt) }}</small>
        </div>
        <h4 v-else class="mb-0 fw-bold">Detalhes do Pedido</h4>
      </div>
      <div v-if="order && !order.payload?.nfe?.nProt">
        <BaseButton variant="outline" :loading="emitindoNfe" @click="emitirNfe">
          <i class="bi bi-receipt me-1"></i>Emitir NF-e
        </BaseButton>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="!order" class="text-center py-5">
      <div class="spinner-border" style="color: var(--primary)" role="status"></div>
      <p class="text-muted mt-3 mb-0">Carregando pedido...</p>
    </div>

    <div v-else class="row g-4">

      <!-- LEFT: itens + financeiro -->
      <div class="col-12 col-lg-8">

        <!-- Itens do Pedido -->
        <div class="card mb-4">
          <div class="card-body">
            <div class="section-header">
              <i class="bi bi-bag-check"></i>
              <span>Itens do Pedido</span>
            </div>
            <div class="table-responsive">
              <table class="table table-hover align-middle mb-0">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th class="text-center" style="width:60px">Qtd</th>
                    <th class="text-end" style="width:110px">Preço Unit.</th>
                    <th class="text-end" style="width:110px">Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  <template v-for="(it, idx) in order.items || []" :key="idx">
                    <tr>
                      <td>
                        <div class="fw-semibold small">{{ it.name }}</div>
                        <div v-if="it.options && it.options.length" class="mt-1">
                          <div v-for="(opt, optIdx) in it.options" :key="optIdx" class="option-line">
                            <i class="bi bi-plus"></i>
                            {{ opt.name }}<span v-if="opt.quantity > 1"> ({{ opt.quantity }}x)</span><span v-if="opt.price && Number(opt.price) > 0"> · {{ formatCurrency(opt.price) }}</span>
                          </div>
                        </div>
                        <div v-if="it.notes" class="option-line mt-1">
                          <i class="bi bi-chat-left-text me-1"></i>{{ it.notes }}
                        </div>
                      </td>
                      <td class="text-center small">{{ it.quantity }}</td>
                      <td class="text-end small">{{ formatCurrency(it.price) }}</td>
                      <td class="text-end small fw-semibold">{{ formatCurrency(Number(it.price || 0) * Number(it.quantity || 1)) }}</td>
                    </tr>
                  </template>
                </tbody>
              </table>
            </div>

            <!-- Totais -->
            <div class="mt-3 pt-3 border-top">
              <div class="d-flex justify-content-between mb-2">
                <span class="text-muted small">Subtotal</span>
                <span class="small">{{ formatCurrency(calculateSubtotal()) }}</span>
              </div>
              <div v-if="vouchers.storeDiscount > 0" class="d-flex justify-content-between mb-2">
                <span class="text-muted small">Desconto Loja</span>
                <span class="small text-danger">− {{ formatCurrency(vouchers.storeDiscount) }}</span>
              </div>
              <div v-if="order.orderType === 'DELIVERY'" class="d-flex justify-content-between mb-2">
                <span class="text-muted small">Taxa de entrega</span>
                <span class="small">{{ Number(order.deliveryFee || 0) > 0 ? formatCurrency(order.deliveryFee) : 'Grátis' }}</span>
              </div>
              <div v-if="Number(order.additionalFees || 0) > 0" class="d-flex justify-content-between mb-2">
                <span class="text-muted small">Taxa de serviço (iFood)</span>
                <span class="small">{{ formatCurrency(order.additionalFees) }}</span>
              </div>
              <div class="d-flex justify-content-between pt-2 border-top mt-1">
                <span class="fw-semibold">Total faturado</span>
                <span class="fw-bold" style="font-size:1.05rem; color:var(--primary)">{{ formatCurrency(storeRevenue(order)) }}</span>
              </div>
              <div v-if="vouchers.discountIfood > 0" class="d-flex justify-content-between mt-2">
                <span class="text-muted" style="font-size:0.78rem">Cliente pagou: {{ formatCurrency(order.total) }}</span>
                <span class="text-muted" style="font-size:0.78rem">iFood repassa: {{ formatCurrency(vouchers.discountIfood) }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Pagamento -->
        <div class="card mb-4">
          <div class="card-body">
            <div class="section-header">
              <i class="bi bi-wallet2"></i>
              <span>Pagamento</span>
            </div>
            <div class="row g-3">
              <div class="col-6">
                <span class="detail-label">Método</span>
                <span class="detail-value">{{ getPaymentMethod(order) }}</span>
              </div>
              <div v-if="getPaymentAmount(order)" class="col-6">
                <span class="detail-label">Valor pago</span>
                <span class="detail-value">{{ formatCurrency(getPaymentAmount(order)) }}</span>
              </div>
              <div v-if="getChangeFor(order)" class="col-6">
                <span class="detail-label">Troco para</span>
                <span class="detail-value">{{ formatCurrency(getChangeFor(order)) }}</span>
              </div>
              <div v-if="getChangeFor(order) && getPaymentAmount(order)" class="col-6">
                <span class="detail-label">Troco</span>
                <span class="detail-value">{{ formatCurrency(Number(getChangeFor(order)) - Number(getPaymentAmount(order))) }}</span>
              </div>
            </div>
            <div v-if="vouchers.voucherPayments.length > 0" class="border-top pt-3 mt-3">
              <div v-for="(vp, i) in vouchers.voucherPayments" :key="i" class="d-flex justify-content-between align-items-center mb-1">
                <span class="text-muted small"><i class="bi bi-ticket-perforated me-1"></i>{{ vp.label }}</span>
                <span class="fw-semibold small" style="color:var(--success)">{{ formatCurrency(vp.value) }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Cupom (condicional) -->
        <div v-if="order.couponCode" class="card mb-4">
          <div class="card-body">
            <div class="section-header">
              <i class="bi bi-tag"></i>
              <span>Cupom Utilizado</span>
            </div>
            <div class="row g-3">
              <div class="col-6">
                <span class="detail-label">Código</span>
                <span class="detail-value font-monospace">{{ order.couponCode }}</span>
              </div>
              <div class="col-6">
                <span class="detail-label">Desconto</span>
                <span class="detail-value" style="color:var(--success)">{{ formatCurrency(order.couponDiscount) }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- NF-e (condicional) -->
        <div v-if="order.payload?.nfe" class="card mb-4">
          <div class="card-body">
            <div class="section-header" style="color:var(--success)">
              <i class="bi bi-check-circle-fill" style="color:var(--success)"></i>
              <span>NF-e Emitida</span>
            </div>
            <div class="row g-3">
              <div class="col-md-4">
                <span class="detail-label">Protocolo</span>
                <span class="detail-value font-monospace small">{{ order.payload.nfe.nProt || '—' }}</span>
              </div>
              <div class="col-md-4">
                <span class="detail-label">cStat</span>
                <span class="detail-value">{{ order.payload.nfe.cStat || '—' }}</span>
              </div>
              <div class="col-md-4">
                <span class="detail-label">Autorização</span>
                <span class="detail-value">{{ order.payload.nfe.authorizedAt ? formatDateTime(order.payload.nfe.authorizedAt) : '—' }}</span>
              </div>
              <div v-if="order.payload.nfe.xMotivo" class="col-12">
                <span class="detail-label">Motivo</span>
                <span class="detail-value">{{ order.payload.nfe.xMotivo }}</span>
              </div>
            </div>
            <div class="d-flex gap-2 flex-wrap mt-3 pt-3 border-top">
              <button class="btn btn-sm btn-success" @click="imprimirDanfe" title="Imprimir DANFE na impressora fiscal">
                <i class="bi bi-printer-fill me-1"></i>Imprimir DANFE
              </button>
              <button class="btn btn-sm btn-outline-primary" @click="sendNfeEmail" title="Enviar XML por e-mail">
                <i class="bi bi-envelope me-1"></i>Enviar por e-mail
              </button>
              <button class="btn btn-sm btn-outline-secondary" @click="downloadNfeXml" title="Baixar XML">
                <i class="bi bi-download me-1"></i>Baixar XML
              </button>
            </div>
          </div>
        </div>

      </div>

      <!-- RIGHT: informações + cliente + endereço + entregador + histórico -->
      <div class="col-12 col-lg-4">

        <!-- Informações do Pedido -->
        <div class="card mb-4">
          <div class="card-body">
            <div class="section-header">
              <i class="bi bi-info-circle"></i>
              <span>Informações</span>
            </div>
            <div class="detail-list">
              <div class="detail-row">
                <span class="detail-label">Status</span>
                <span class="badge rounded-pill" :class="getStatusClass(order.status)">{{ getStatusLabel(order.status) }}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Tipo</span>
                <span class="detail-value">{{ getOrderType(order) }}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Origem</span>
                <span class="detail-value">{{ order.customerSource || 'PUBLIC' }}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Data</span>
                <span class="detail-value">{{ formatDateTime(order.createdAt) }}</span>
              </div>
              <div v-if="order.storeId" class="detail-row">
                <span class="detail-label">Loja</span>
                <span class="detail-value">{{ order.store?.name || order.storeId }}</span>
              </div>
              <div v-if="order.deliveryNeighborhood" class="detail-row">
                <span class="detail-label">Bairro</span>
                <span class="detail-value">{{ order.deliveryNeighborhood }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Cliente -->
        <div class="card mb-4">
          <div class="card-body">
            <div class="section-header">
              <i class="bi bi-person"></i>
              <span>Cliente</span>
            </div>
            <div class="detail-list">
              <div class="detail-row">
                <span class="detail-label">Nome</span>
                <span class="detail-value">
                  <router-link v-if="order.customerId" :to="`/customers/${order.customerId}`" class="text-decoration-none">
                    {{ order.customerName || order.customer?.fullName || order.customer?.name || '—' }}
                    <i class="bi bi-box-arrow-up-right ms-1" style="font-size:0.7rem;color:var(--text-muted)"></i>
                  </router-link>
                  <span v-else>{{ order.customerName || order.customer?.fullName || order.customer?.name || '—' }}</span>
                </span>
              </div>
              <div v-if="order.customerPhone" class="detail-row">
                <span class="detail-label">Telefone</span>
                <span class="detail-value">{{ order.customerPhone }}</span>
              </div>
              <div v-if="order.customer?.email" class="detail-row">
                <span class="detail-label">E-mail</span>
                <span class="detail-value small">{{ order.customer.email }}</span>
              </div>
              <div v-if="order.customerId" class="detail-row">
                <span class="detail-label">ID</span>
                <span class="detail-value font-monospace" style="font-size:0.75rem;color:var(--text-muted)">{{ order.customerId.slice(0, 8) }}…</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Endereço de Entrega (condicional) -->
        <div v-if="(order.orderType === 'DELIVERY' || order.address) && hasAddress(order)" class="card mb-4">
          <div class="card-body">
            <div class="section-header">
              <i class="bi bi-geo-alt"></i>
              <span>Endereço de Entrega</span>
            </div>
            <p class="mb-2 fw-semibold small">{{ getMainAddress(order) }}</p>
            <div class="text-muted" style="font-size:0.8rem;line-height:1.7">
              <div v-if="getAddressDetails(order).neighborhood"><strong>Bairro:</strong> {{ getAddressDetails(order).neighborhood }}</div>
              <div v-if="getAddressDetails(order).complement"><strong>Compl.:</strong> {{ getAddressDetails(order).complement }}</div>
              <div v-if="getAddressDetails(order).reference"><strong>Ref.:</strong> {{ getAddressDetails(order).reference }}</div>
              <div v-if="getAddressDetails(order).observation"><strong>Obs.:</strong> {{ getAddressDetails(order).observation }}</div>
            </div>
          </div>
        </div>

        <!-- Entregador (condicional) -->
        <div v-if="order.rider || order.riderId" class="card mb-4">
          <div class="card-body">
            <div class="section-header">
              <i class="bi bi-bicycle"></i>
              <span>Entregador</span>
            </div>
            <span class="detail-label">Nome</span>
            <span class="detail-value d-block mt-1">{{ order.rider?.name || order.riderId }}</span>
          </div>
        </div>

        <!-- Histórico de Status (condicional) -->
        <div v-if="order.histories && order.histories.length > 0" class="card mb-4">
          <div class="card-body">
            <div class="section-header">
              <i class="bi bi-clock-history"></i>
              <span>Histórico</span>
            </div>
            <div class="history-list">
              <div v-for="h in order.histories" :key="h.id" class="history-item">
                <div class="d-flex align-items-center gap-1 flex-wrap">
                  <span class="badge bg-light text-dark border">{{ h.from || 'Início' }}</span>
                  <i class="bi bi-arrow-right" style="font-size:0.6rem;color:var(--text-muted)"></i>
                  <span class="badge bg-primary">{{ h.to }}</span>
                </div>
                <span class="history-time">{{ formatDateTime(h.createdAt) }}</span>
              </div>
            </div>
          </div>
        </div>

      </div>

    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import Swal from 'sweetalert2';
import api from '../api';
import { formatDateTime } from '../utils/dates.js';
import { splitVoucherDiscounts, storeRevenue } from '../utils/orderUtils.js';

const route = useRoute();
const id = route.params.id;
const order = ref(null);
const vouchers = ref({ discountIfood: 0, discountMerchant: 0, voucherPayments: [], storeDiscount: 0 });
const emitindoNfe = ref(false);

function padNumber(n){ if (n == null || n === '') return null; return String(n).toString().padStart(2, '0'); }
function formatOrderNumber(o){
  if(!o) return '';
  if(o.displaySimple) return o.displaySimple;
  if(o.displayId !== undefined && o.displayId !== null){ const p = padNumber(o.displayId); return p ? p : String(o.displayId); }
  if(o.number !== undefined && o.number !== null) return String(o.number);
  return o.id ? String(o.id).slice(0,6) : '';
}

function formatCurrency(value) {
  if (value == null || isNaN(value)) return 'R$ 0,00';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value));
}

function calculateSubtotal() {
  if (!order.value?.items) return order.value?.subtotal || 0;
  return order.value.items.reduce((sum, item) => {
    let itemTotal = Number(item.price || 0) * Number(item.quantity || 1);
    if (item.options?.length) {
      for (const opt of item.options) {
        itemTotal += Number(opt.price || 0) * Number(opt.quantity || 1) * Number(item.quantity || 1);
      }
    }
    return sum + itemTotal;
  }, 0);
}

function getStatusLabel(status) {
  const labels = {
    'PENDING': 'Pendente',
    'PENDENTE_ACEITE': 'Pendente',
    'EM_PREPARO': 'Em preparo',
    'CONFIRMED': 'Confirmado',
    'PREPARING': 'Preparando',
    'PRONTO': 'Pronto',
    'READY': 'Pronto',
    'SAIU_PARA_ENTREGA': 'Saiu para entrega',
    'DELIVERING': 'Saiu para entrega',
    'CONCLUIDO': 'Concluído',
    'DELIVERED': 'Entregue',
    'CANCELADO': 'Cancelado',
    'CANCELLED': 'Cancelado',
    'FINISHED': 'Finalizado',
    'CONFIRMACAO_PAGAMENTO': 'Confirm. Pagamento',
  };
  return labels[status] || status || 'Pendente';
}

function getStatusClass(status) {
  const classes = {
    'PENDING': 'bg-warning text-dark',
    'PENDENTE_ACEITE': 'bg-warning text-dark',
    'EM_PREPARO': 'bg-primary',
    'CONFIRMED': 'bg-primary',
    'PREPARING': 'bg-primary',
    'PRONTO': 'bg-primary',
    'READY': 'bg-primary',
    'SAIU_PARA_ENTREGA': 'bg-primary',
    'DELIVERING': 'bg-primary',
    'CONCLUIDO': 'bg-success',
    'DELIVERED': 'bg-success',
    'FINISHED': 'bg-success',
    'CONFIRMACAO_PAGAMENTO': 'bg-warning text-dark',
    'CANCELADO': 'bg-danger',
    'CANCELLED': 'bg-danger',
  };
  return classes[status] || 'bg-secondary';
}

function getOrderType(order) {
  const types = {
    'DELIVERY': 'Entrega',
    'PICKUP': 'Retirada',
    'INDOOR': 'Mesa',
    'BALCAO': 'Balcão',
    'TAKEOUT': 'Retirada',
  };
  return types[order.orderType] || order.orderType || 'Entrega';
}

function hasAddress(o) {
  if (!o) return false;
  return !!(o.address || o.deliveryAddress || o.customerAddress || o.payload?.delivery?.deliveryAddress || o.payload?.rawPayload?.address);
}

function getMainAddress(o) {
  if (!o) return '-';
  const a = o.address || o.deliveryAddress || o.customerAddress || o.payload?.delivery?.deliveryAddress || o.payload?.rawPayload?.address;
  if (!a) return o.addressText || '-';
  if (typeof a === 'string') return a;
  const street = a.street || a.streetName || a.formatted || a.formattedAddress || '';
  const number = a.number || a.streetNumber || '';
  if (street && number) return `${street}, ${number}`;
  if (street) return street;
  if (a.formatted) return a.formatted;
  if (a.formattedAddress) return a.formattedAddress;
  return '-';
}

function getAddressDetails(o) {
  if (!o) return {};
  const a = o.address || o.deliveryAddress || o.customerAddress || o.payload?.delivery?.deliveryAddress || o.payload?.rawPayload?.address;
  if (!a || typeof a === 'string') return {};
  return {
    neighborhood: a.neighborhood,
    complement: a.complement,
    reference: a.reference,
    observation: a.observation || a.obs
  };
}

function getPaymentMethod(o) {
  if (!o) return '-';
  const method = o.paymentMethod ||
                 o.payment?.method ||
                 o.payment?.methodCode ||
                 o.payload?.payment?.method ||
                 o.payload?.rawPayload?.payment?.method;
  return method || '-';
}

function getPaymentAmount(o) {
  if (!o) return null;
  return o.payment?.amount ||
         o.payload?.payment?.amount ||
         o.payload?.rawPayload?.payment?.amount ||
         null;
}

function getChangeFor(o) {
  if (!o) return null;
  return o.payment?.changeFor ||
         o.payload?.payment?.changeFor ||
         o.payload?.rawPayload?.payment?.changeFor ||
         null;
}

async function emitirNfe() {
  const r = await Swal.fire({ title: 'Emitir NF-e?', text: `Pedido #${formatOrderNumber(order.value)}`, icon: 'question', showCancelButton: true, confirmButtonText: 'Emitir', cancelButtonText: 'Cancelar' });
  if (!r.isConfirmed) return;
  emitindoNfe.value = true;
  try {
    const { data } = await api.post('/nfe/emit-from-order', { orderId: id });
    if (data.success) {
      Swal.fire({ icon: 'success', title: 'NF-e Autorizada', text: `Protocolo: ${data.nProt}`, toast: true, timer: 4000, position: 'top-end', showConfirmButton: false });
      load();
    } else {
      Swal.fire({ icon: 'error', title: 'Erro NF-e', text: data.xMotivo || data.error });
    }
  } catch (e) {
    const errData = e.response?.data;
    let errorText = errData?.error || e.message;
    if (errData?.detail) {
      const d = errData.detail;
      if (d.httpStatus) errorText += `\nHTTP ${d.httpStatus}`;
      if (d.httpData) errorText += `\nResposta: ${d.httpData.substring(0, 300)}`;
    }
    Swal.fire({ icon: 'error', title: 'Erro ao emitir NF-e', text: errorText });
  } finally {
    emitindoNfe.value = false;
  }
}

async function imprimirDanfe() {
  try {
    const { data } = await api.post('/agent-print', { id: order.value.id, storeId: order.value.storeId, fiscal: true });
    if (data.ok) {
      Swal.fire({ icon: 'success', title: 'DANFE enviada para impressão', timer: 1500, showConfirmButton: false });
    } else {
      throw new Error(data.error || 'Falha ao enviar para impressão');
    }
  } catch (e) {
    Swal.fire({ icon: 'error', title: 'Erro ao imprimir DANFE', text: e.response?.data?.error || e.message });
  }
}

async function sendNfeEmail() {
  const { value: email, isConfirmed } = await Swal.fire({
    title: 'Enviar NF-e por e-mail',
    input: 'email',
    inputLabel: 'Endereço de e-mail',
    inputPlaceholder: 'cliente@exemplo.com',
    inputValue: order.value?.customer?.email || '',
    showCancelButton: true,
    confirmButtonText: 'Enviar',
    cancelButtonText: 'Cancelar',
    inputValidator: (v) => !v ? 'Informe um e-mail' : null,
  });
  if (!isConfirmed || !email) return;
  try {
    await api.post('/nfe/enviar-email', { orderId: id, email });
    Swal.fire({ icon: 'success', title: 'E-mail enviado', text: email, timer: 3000, toast: true, position: 'top-end', showConfirmButton: false });
  } catch (e) {
    Swal.fire({ icon: 'error', title: 'Erro ao enviar e-mail', text: e.response?.data?.error || e.message });
  }
}

async function downloadNfeXml() {
  try {
    const resp = await api.get(`/nfe/xml-by-order/${id}`, { responseType: 'blob' });
    const cd = resp.headers['content-disposition'] || '';
    const match = cd.match(/filename="([^"]+)"/);
    const filename = match ? match[1] : `nfe-${order.value?.displaySimple || id}.xml`;
    const url = URL.createObjectURL(new Blob([resp.data], { type: 'application/xml' }));
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (e) {
    Swal.fire({ icon: 'error', title: 'Erro ao baixar XML', text: e.response?.data?.error || e.message });
  }
}

async function load() {
  try {
    const { data } = await api.get(`/orders/${id}`);
    order.value = data?.order || data;
    vouchers.value = splitVoucherDiscounts(order.value);
  } catch (e) { console.error('load order failed', e); }
}

onMounted(() => { load(); });
</script>

<style scoped>
.section-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-primary);
  padding-bottom: 0.75rem;
  margin-bottom: 1rem;
  border-bottom: 1px solid var(--border-color);
}

.section-header i {
  color: var(--primary);
  font-size: 0.9rem;
}

.detail-label {
  display: block;
  font-size: 0.72rem;
  font-weight: 500;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 0.2rem;
}

.detail-value {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--text-primary);
}

.detail-list {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.detail-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
}

.detail-row .detail-label {
  margin-bottom: 0;
  flex-shrink: 0;
}

.detail-row .detail-value {
  text-align: right;
}

.option-line {
  font-size: 0.78rem;
  color: var(--text-secondary);
}

.history-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.history-item {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 0.5rem;
  padding-bottom: 0.75rem;
  border-bottom: 1px solid var(--border-color-soft);
}

.history-item:last-child {
  padding-bottom: 0;
  border-bottom: none;
}

.history-time {
  font-size: 0.72rem;
  color: var(--text-muted);
  white-space: nowrap;
  margin-top: 0.2rem;
  flex-shrink: 0;
}
</style>
