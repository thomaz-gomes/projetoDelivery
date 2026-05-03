<template>
  <div class="container py-4" style="max-width:860px">
    <div class="d-flex align-items-center gap-2 mb-4">
      <button class="btn btn-link ps-0 text-decoration-none" @click="$router.back()">
        <i class="bi bi-arrow-left"></i> Voltar
      </button>
      <span class="text-muted">·</span>
      <span class="fw-semibold" v-if="order">Pedido {{ formatOrderNumber(order) }}</span>
    </div>

    <div v-if="!order" class="text-center py-5 text-muted">
      <div class="spinner-border spinner-border-sm me-2"></div> Carregando...
    </div>

    <div v-else class="vstack gap-3">

      <!-- Header card: status + tipo + origem + data + loja -->
      <div class="card">
        <div class="card-body">
          <div class="d-flex justify-content-between align-items-start flex-wrap gap-2 mb-3">
            <h5 class="mb-0 fw-bold">Pedido nº {{ formatOrderNumber(order) }}</h5>
            <span class="badge fs-6" :class="getStatusClass(order.status)">{{ getStatusLabel(order.status) }}</span>
          </div>
          <div class="row g-3 row-cols-2 row-cols-md-4">
            <div>
              <div class="text-muted small">Tipo</div>
              <div class="fw-semibold">{{ getOrderType(order) }}</div>
            </div>
            <div>
              <div class="text-muted small">Data / Hora</div>
              <div class="fw-semibold">{{ formatDateTime(order.createdAt) }}</div>
            </div>
            <div v-if="order.store?.name || order.storeId">
              <div class="text-muted small">Loja</div>
              <div class="fw-semibold">{{ order.store?.name || order.storeId }}</div>
            </div>
            <div v-if="order.customerSource && order.customerSource !== 'PUBLIC'">
              <div class="text-muted small">Origem</div>
              <div class="fw-semibold">{{ order.customerSource }}</div>
            </div>
            <div v-if="order.deliveryNeighborhood">
              <div class="text-muted small">Bairro</div>
              <div class="fw-semibold">{{ order.deliveryNeighborhood }}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Cliente -->
      <div class="card">
        <div class="card-body">
          <h6 class="fw-semibold mb-3"><i class="bi bi-person me-1"></i>Cliente</h6>
          <div class="row g-3">
            <div class="col-md-6">
              <div class="text-muted small">Nome</div>
              <div class="fw-semibold">
                <router-link v-if="order.customerId" :to="`/customers/${order.customerId}`" class="text-decoration-none">
                  {{ order.customerName || order.customer?.fullName || order.customer?.name || '-' }}
                  <i class="bi bi-box-arrow-up-right ms-1 small text-muted"></i>
                </router-link>
                <span v-else>{{ order.customerName || order.customer?.fullName || order.customer?.name || '-' }}</span>
              </div>
            </div>
            <div class="col-md-3" v-if="order.customerPhone">
              <div class="text-muted small">Telefone</div>
              <div class="fw-semibold">{{ order.customerPhone }}</div>
            </div>
            <div class="col-md-3" v-if="order.customer?.email">
              <div class="text-muted small">E-mail</div>
              <div class="fw-semibold small">{{ order.customer.email }}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Endereço de Entrega -->
      <div v-if="(order.orderType === 'DELIVERY' || order.address) && hasAddress(order)" class="card">
        <div class="card-body">
          <h6 class="fw-semibold mb-3"><i class="bi bi-geo-alt me-1"></i>Endereço de Entrega</h6>
          <div>{{ getMainAddress(order) }}</div>
          <div v-if="getAddressDetails(order).neighborhood" class="text-muted small mt-1">
            <strong>Bairro:</strong> {{ getAddressDetails(order).neighborhood }}
          </div>
          <div v-if="getAddressDetails(order).complement" class="text-muted small mt-1">
            <strong>Complemento:</strong> {{ getAddressDetails(order).complement }}
          </div>
          <div v-if="getAddressDetails(order).reference" class="text-muted small mt-1">
            <strong>Referência:</strong> {{ getAddressDetails(order).reference }}
          </div>
          <div v-if="getAddressDetails(order).observation" class="text-muted small mt-1">
            <strong>Observação:</strong> {{ getAddressDetails(order).observation }}
          </div>
        </div>
      </div>

      <!-- Itens do Pedido -->
      <div class="card">
        <div class="card-body">
          <h6 class="fw-semibold mb-3"><i class="bi bi-bag me-1"></i>Itens do Pedido</h6>
          <div class="table-responsive">
            <table class="table table-sm mb-0">
              <thead>
                <tr>
                  <th>Item</th>
                  <th class="text-center" style="width:60px">Qtd</th>
                  <th class="text-end" style="width:100px">Unit.</th>
                  <th class="text-end" style="width:110px">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                <template v-for="(it, idx) in order.items || []" :key="idx">
                  <tr>
                    <td>
                      <div class="fw-semibold">{{ it.name }}</div>
                      <div v-if="it.options && it.options.length" class="text-muted small mt-1">
                        <div v-for="(opt, optIdx) in it.options" :key="optIdx" class="ms-2">
                          + {{ opt.name }}<span v-if="opt.quantity > 1"> ({{ opt.quantity }}x)</span>
                          <span v-if="opt.price && Number(opt.price) > 0"> · {{ formatCurrency(opt.price) }}</span>
                        </div>
                      </div>
                      <div v-if="it.notes" class="text-muted small mt-1"><i class="bi bi-chat-dots me-1"></i>{{ it.notes }}</div>
                    </td>
                    <td class="text-center align-top">{{ it.quantity }}</td>
                    <td class="text-end align-top">{{ formatCurrency(it.price) }}</td>
                    <td class="text-end align-top">{{ formatCurrency(Number(it.price || 0) * Number(it.quantity || 1)) }}</td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>
          <div class="border-top pt-3 mt-3">
            <div class="d-flex justify-content-between mb-2">
              <span class="text-muted">Subtotal</span>
              <span>{{ formatCurrency(calculateSubtotal()) }}</span>
            </div>
            <div v-if="vouchers.storeDiscount > 0" class="d-flex justify-content-between mb-2">
              <span class="text-muted">Desconto Loja</span>
              <span class="text-danger">- {{ formatCurrency(vouchers.storeDiscount) }}</span>
            </div>
            <div v-if="order.orderType === 'DELIVERY'" class="d-flex justify-content-between mb-2">
              <span class="text-muted">Taxa de entrega</span>
              <span>{{ Number(order.deliveryFee || 0) > 0 ? formatCurrency(order.deliveryFee) : 'Grátis' }}</span>
            </div>
            <div v-if="Number(order.additionalFees || 0) > 0" class="d-flex justify-content-between mb-2">
              <span class="text-muted">Taxa de serviço</span>
              <span>{{ formatCurrency(order.additionalFees) }}</span>
            </div>
            <div class="d-flex justify-content-between pt-2 border-top fw-semibold">
              <span>Total faturado</span>
              <span class="fs-5">{{ formatCurrency(storeRevenue(order)) }}</span>
            </div>
            <div v-if="vouchers.discountIfood > 0" class="d-flex justify-content-between text-muted small mt-1">
              <span>Cliente pagou: {{ formatCurrency(order.total) }}</span>
              <span>iFood repassa: {{ formatCurrency(vouchers.discountIfood) }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Pagamento -->
      <div class="card">
        <div class="card-body">
          <h6 class="fw-semibold mb-3"><i class="bi bi-credit-card me-1"></i>Pagamento</h6>
          <div class="row g-3">
            <div class="col-md-4">
              <div class="text-muted small">Método</div>
              <div class="fw-semibold">{{ getPaymentMethod(order) }}</div>
            </div>
            <div class="col-md-4" v-if="getPaymentAmount(order)">
              <div class="text-muted small">Valor pago</div>
              <div class="fw-semibold">{{ formatCurrency(getPaymentAmount(order)) }}</div>
            </div>
            <div class="col-md-4" v-if="getChangeFor(order)">
              <div class="text-muted small">Troco para</div>
              <div class="fw-semibold">{{ formatCurrency(getChangeFor(order)) }}</div>
            </div>
          </div>
          <div v-if="vouchers.voucherPayments.length > 0" class="border-top pt-3 mt-2">
            <div v-for="(vp, i) in vouchers.voucherPayments" :key="i" class="d-flex justify-content-between align-items-center mb-1">
              <span class="text-muted"><i class="bi bi-ticket-perforated me-1"></i>{{ vp.label }}</span>
              <span class="text-success fw-semibold">{{ formatCurrency(vp.value) }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Entregador -->
      <div v-if="order.rider || order.riderId" class="card">
        <div class="card-body">
          <h6 class="fw-semibold mb-2"><i class="bi bi-person-badge me-1"></i>Entregador</h6>
          <div class="fw-semibold">{{ order.rider?.name || order.riderId }}</div>
        </div>
      </div>

      <!-- Cupom -->
      <div v-if="order.couponCode" class="card">
        <div class="card-body">
          <h6 class="fw-semibold mb-3"><i class="bi bi-ticket-perforated me-1"></i>Cupom</h6>
          <div class="d-flex gap-4">
            <div>
              <div class="text-muted small">Código</div>
              <div class="fw-semibold font-monospace">{{ order.couponCode }}</div>
            </div>
            <div>
              <div class="text-muted small">Desconto</div>
              <div class="fw-semibold text-success">{{ formatCurrency(order.couponDiscount) }}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Histórico de Status -->
      <div v-if="order.histories && order.histories.length > 0" class="card">
        <div class="card-body">
          <h6 class="fw-semibold mb-3"><i class="bi bi-clock-history me-1"></i>Histórico de Status</h6>
          <div class="vstack gap-2">
            <div v-for="h in order.histories" :key="h.id" class="d-flex justify-content-between align-items-center">
              <div class="d-flex align-items-center gap-2">
                <span class="badge bg-secondary">{{ h.from || 'Criado' }}</span>
                <i class="bi bi-arrow-right text-muted small"></i>
                <span class="badge bg-primary">{{ h.to }}</span>
              </div>
              <span class="text-muted small">{{ formatDateTime(h.createdAt) }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- NF-e -->
      <div v-if="order.payload?.nfe?.nProt" class="card border-success">
        <div class="card-body">
          <h6 class="fw-semibold mb-3 text-success"><i class="bi bi-receipt-cutoff me-1"></i>Nota Fiscal Eletrônica</h6>
          <div class="row g-3 mb-3">
            <div class="col-md-4">
              <div class="text-muted small">Protocolo</div>
              <div class="fw-semibold font-monospace">{{ order.payload.nfe.nProt }}</div>
            </div>
            <div class="col-md-4" v-if="order.payload.nfe.cStat">
              <div class="text-muted small">Status SEFAZ</div>
              <div class="fw-semibold">{{ order.payload.nfe.cStat }}</div>
            </div>
            <div class="col-md-4" v-if="order.payload.nfe.authorizedAt">
              <div class="text-muted small">Autorizado em</div>
              <div class="fw-semibold">{{ formatDateTime(order.payload.nfe.authorizedAt) }}</div>
            </div>
            <div class="col-12" v-if="order.payload.nfe.xMotivo">
              <div class="text-muted small">Motivo</div>
              <div>{{ order.payload.nfe.xMotivo }}</div>
            </div>
          </div>
          <div class="d-flex gap-2 flex-wrap">
            <button class="btn btn-sm btn-success" @click="imprimirDanfe" title="Imprimir DANFE na impressora fiscal">
              <i class="bi bi-printer-fill"></i> Imprimir DANFE
            </button>
            <button class="btn btn-sm btn-outline-primary" @click="sendNfeEmail" title="Enviar XML por e-mail">
              <i class="bi bi-envelope"></i> Enviar por e-mail
            </button>
            <button class="btn btn-sm btn-outline-secondary" @click="downloadNfeXml" title="Baixar XML">
              <i class="bi bi-download"></i> Baixar XML
            </button>
          </div>
        </div>
      </div>

      <!-- Emitir NF-e (only when no NF-e yet) -->
      <div v-else class="d-flex justify-content-end">
        <button class="btn btn-outline-success" @click="emitirNfe" :disabled="emitindoNfe">
          <span v-if="emitindoNfe" class="spinner-border spinner-border-sm me-1"></span>
          <i v-else class="bi bi-receipt me-1"></i> Emitir NF-e
        </button>
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

function padNumber(n) { if (n == null || n === '') return null; return String(n).padStart(2, '0'); }
function formatOrderNumber(o) {
  if (!o) return '';
  if (o.displaySimple) return o.displaySimple;
  if (o.displayId !== undefined && o.displayId !== null) { const p = padNumber(o.displayId); return p ? p : String(o.displayId); }
  if (o.number !== undefined && o.number !== null) return String(o.number);
  return o.id ? String(o.id).slice(0, 6) : '';
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
  const labels = { PENDING: 'Pendente', EM_PREPARO: 'Em preparo', CONFIRMED: 'Confirmado', PREPARING: 'Preparando', READY: 'Pronto', DELIVERING: 'Saiu para entrega', DELIVERED: 'Entregue', CONCLUIDO: 'Concluído', CANCELADO: 'Cancelado', CANCELLED: 'Cancelado', FINISHED: 'Finalizado' };
  return labels[status] || status || 'Pendente';
}

function getStatusClass(status) {
  const classes = { PENDING: 'bg-warning text-dark', EM_PREPARO: 'bg-info text-white', CONFIRMED: 'bg-info text-white', PREPARING: 'bg-info text-white', READY: 'bg-primary', DELIVERING: 'bg-primary', DELIVERED: 'bg-success', CONCLUIDO: 'bg-success', CANCELADO: 'bg-danger', CANCELLED: 'bg-danger', FINISHED: 'bg-success' };
  return classes[status] || 'bg-secondary';
}

function getOrderType(o) {
  const types = { DELIVERY: 'Entrega', PICKUP: 'Retirada', TAKEOUT: 'Retirada', BALCAO: 'Balcão', INDOOR: 'Mesa' };
  return types[o.orderType] || o.orderType || 'Entrega';
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
  return street || a.formatted || a.formattedAddress || '-';
}

function getAddressDetails(o) {
  if (!o) return {};
  const a = o.address || o.deliveryAddress || o.customerAddress || o.payload?.delivery?.deliveryAddress || o.payload?.rawPayload?.address;
  if (!a || typeof a === 'string') return {};
  return { neighborhood: a.neighborhood, complement: a.complement, reference: a.reference, observation: a.observation || a.obs };
}

function getPaymentMethod(o) {
  if (!o) return '-';
  return o.paymentMethod || o.payment?.method || o.payment?.methodCode || o.payload?.payment?.method || o.payload?.rawPayload?.payment?.method || '-';
}

function getPaymentAmount(o) {
  if (!o) return null;
  return o.payment?.amount || o.payload?.payment?.amount || o.payload?.rawPayload?.payment?.amount || null;
}

function getChangeFor(o) {
  if (!o) return null;
  return o.payment?.changeFor || o.payload?.payment?.changeFor || o.payload?.rawPayload?.payment?.changeFor || null;
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
.table thead th {
  background-color: #f8f9fa;
  font-weight: 600;
  border-bottom: 2px solid #dee2e6;
}
</style>
