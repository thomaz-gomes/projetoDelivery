<template>
  <div class="container py-4">
    <button class="btn btn-link mb-3 ps-0" @click="$router.back()">← Voltar</button>
    <h2 class="mb-4">Detalhes do Pedido</h2>

    <div v-if="!order" class="alert alert-secondary">Carregando pedido...</div>

    <div v-else>
      <!-- Informações Principais -->
      <div class="card mb-3">
        <div class="card-body">
          <h5 class="card-title fw-semibold mb-3">Pedido nº {{ formatOrderNumber(order) }}</h5>
          <div class="row mb-2">
            <div class="col-md-6">
              <div class="mb-3">
                <span class="text-muted small d-block">Status</span>
                <span class="badge" :class="getStatusClass(order.status)">{{ getStatusLabel(order.status) }}</span>
              </div>
              <div class="mb-3">
                <span class="text-muted small d-block">Tipo</span>
                <strong>{{ getOrderType(order) }}</strong>
              </div>
              <div class="mb-3">
                <span class="text-muted small d-block">Origem</span>
                <strong>{{ order.customerSource || 'PUBLIC' }}</strong>
              </div>
            </div>
            <div class="col-md-6">
              <div class="mb-3">
                <span class="text-muted small d-block">Data / Hora</span>
                <strong>{{ formatDateTime(order.createdAt) }}</strong>
              </div>
              <div v-if="order.storeId" class="mb-3">
                <span class="text-muted small d-block">Loja</span>
                <strong>{{ order.store?.name || order.storeId }}</strong>
              </div>
              <div v-if="order.deliveryNeighborhood" class="mb-3">
                <span class="text-muted small d-block">Bairro</span>
                <strong>{{ order.deliveryNeighborhood }}</strong>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Informações do Cliente -->
      <div class="card mb-3">
        <div class="card-body">
          <h6 class="fw-semibold mb-3">Cliente</h6>
          <div class="row">
            <div class="col-md-6">
              <div class="mb-3">
                <span class="text-muted small d-block">Nome</span>
                <strong>{{ order.customerName || order.customer?.fullName || order.customer?.name || '-' }}</strong>
              </div>
              <div class="mb-3" v-if="order.customerPhone">
                <span class="text-muted small d-block">Telefone</span>
                <strong>{{ order.customerPhone }}</strong>
              </div>
            </div>
            <div class="col-md-6">
              <div v-if="order.customerId" class="mb-3">
                <span class="text-muted small d-block">ID do Cliente</span>
                <strong class="font-monospace small">{{ order.customerId }}</strong>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Endereço de Entrega -->
      <div v-if="(order.orderType === 'DELIVERY' || order.address) && hasAddress(order)" class="card mb-3">
        <div class="card-body">
          <h6 class="fw-semibold mb-3">Endereço de Entrega</h6>
          <div class="mb-0">
            <div class="mb-2">{{ getMainAddress(order) }}</div>
            <div v-if="getAddressDetails(order).neighborhood" class="text-muted small">
              <strong>Bairro:</strong> {{ getAddressDetails(order).neighborhood }}
            </div>
            <div v-if="getAddressDetails(order).complement" class="text-muted small">
              <strong>Complemento:</strong> {{ getAddressDetails(order).complement }}
            </div>
            <div v-if="getAddressDetails(order).reference" class="text-muted small">
              <strong>Referência:</strong> {{ getAddressDetails(order).reference }}
            </div>
            <div v-if="getAddressDetails(order).observation" class="text-muted small">
              <strong>Observação:</strong> {{ getAddressDetails(order).observation }}
            </div>
          </div>
        </div>
      </div>

      <!-- Itens do Pedido -->
      <div class="card mb-3">
        <div class="card-body">
          <h6 class="fw-semibold mb-3">Itens do Pedido</h6>
          <div class="table-responsive">
            <table class="table table-sm">
              <thead>
                <tr>
                  <th>Item</th>
                  <th class="text-center">Qtd</th>
                  <th class="text-end">Preço Unit.</th>
                  <th class="text-end">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                <template v-for="(it, idx) in order.items || []" :key="idx">
                  <tr>
                    <td>
                      <div class="fw-semibold">{{ it.name }}</div>
                      <div v-if="it.options && it.options.length" class="text-muted small mt-1">
                        <div v-for="(opt, optIdx) in it.options" :key="optIdx" class="ms-2">
                          + {{ opt.name }} <span v-if="opt.quantity > 1">({{ opt.quantity }}x)</span>
                          <span v-if="opt.price && Number(opt.price) > 0">· {{ formatCurrency(opt.price) }}</span>
                        </div>
                      </div>
                      <div v-if="it.notes" class="text-muted small mt-1"><strong>Obs:</strong> {{ it.notes }}</div>
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
              <span class="text-muted">Subtotal:</span>
              <strong>{{ formatCurrency(calculateSubtotal()) }}</strong>
            </div>
            <div v-if="order.deliveryFee" class="d-flex justify-content-between mb-2">
              <span class="text-muted">Taxa de entrega:</span>
              <strong>{{ formatCurrency(order.deliveryFee) }}</strong>
            </div>
            <div v-if="order.couponDiscount" class="d-flex justify-content-between mb-2">
              <span class="text-muted">Desconto:</span>
              <strong class="text-success">- {{ formatCurrency(order.couponDiscount) }}</strong>
            </div>
            <div class="d-flex justify-content-between pt-2 border-top">
              <span class="fw-semibold">Total:</span>
              <strong class="fs-5">{{ formatCurrency(order.total) }}</strong>
            </div>
          </div>
        </div>
      </div>

      <!-- Pagamento -->
      <div class="card mb-3">
        <div class="card-body">
          <h6 class="fw-semibold mb-3">Pagamento</h6>
          <div class="row">
            <div class="col-md-6">
              <div class="mb-3">
                <span class="text-muted small d-block">Método</span>
                <strong>{{ getPaymentMethod(order) }}</strong>
              </div>
              <div v-if="getPaymentAmount(order)" class="mb-3">
                <span class="text-muted small d-block">Valor pago</span>
                <strong>{{ formatCurrency(getPaymentAmount(order)) }}</strong>
              </div>
            </div>
            <div class="col-md-6">
              <div v-if="getChangeFor(order)" class="mb-3">
                <span class="text-muted small d-block">Troco para</span>
                <strong>{{ formatCurrency(getChangeFor(order)) }}</strong>
              </div>
              <div v-if="getChangeFor(order) && getPaymentAmount(order)" class="mb-3">
                <span class="text-muted small d-block">Troco</span>
                <strong>{{ formatCurrency(Number(getChangeFor(order)) - Number(getPaymentAmount(order))) }}</strong>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Entregador -->
      <div v-if="order.rider || order.riderId" class="card mb-3">
        <div class="card-body">
          <h6 class="fw-semibold mb-3">Entregador</h6>
          <div>
            <span class="text-muted small d-block">Nome</span>
            <strong>{{ order.rider?.name || order.riderId }}</strong>
          </div>
        </div>
      </div>

      <!-- Histórico de Status -->
      <div v-if="order.histories && order.histories.length > 0" class="card mb-3">
        <div class="card-body">
          <h6 class="fw-semibold mb-3">Histórico de Status</h6>
          <div class="timeline">
            <div v-for="(h, idx) in order.histories" :key="h.id" class="timeline-item mb-3">
              <div class="d-flex justify-content-between">
                <div>
                  <span class="badge bg-secondary">{{ h.from || 'Criado' }}</span>
                  <span class="mx-2">→</span>
                  <span class="badge bg-primary">{{ h.to }}</span>
                </div>
                <span class="text-muted small">{{ formatDateTime(h.createdAt) }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Cupom -->
      <div v-if="order.couponCode" class="card mb-3">
        <div class="card-body">
          <h6 class="fw-semibold mb-3">Cupom Utilizado</h6>
          <div class="row">
            <div class="col-md-6">
              <div class="mb-2">
                <span class="text-muted small d-block">Código</span>
                <strong>{{ order.couponCode }}</strong>
              </div>
            </div>
            <div class="col-md-6">
              <div class="mb-2">
                <span class="text-muted small d-block">Desconto</span>
                <strong class="text-success">{{ formatCurrency(order.couponDiscount) }}</strong>
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
import api from '../api';
import { formatDateTime } from '../utils/dates.js';

const route = useRoute();
const id = route.params.id;
const order = ref(null);

// use shared formatDateTime from utils/dates.js
function padNumber(n){ if (n == null || n === '') return null; return String(n).toString().padStart(2, '0'); }
function formatOrderNumber(o){
  if(!o) return '';
  if(o.displaySimple) return o.displaySimple;
  if(o.displayId !== undefined && o.displayId !== null){ const p = padNumber(o.displayId); return p ? p : String(o.displayId); }
  if(o.number !== undefined && o.number !== null) return String(o.number);
  return o.id ? String(o.id).slice(0,6) : '';
}

function formatAddress(o){
  if(!o) return '-';
  const a = o.address || o.deliveryAddress || o.customerAddress || o.payload?.delivery?.deliveryAddress;
  if(!a) return o.addressText || '-';
  const main = a.formatted || a.formattedAddress || [a.street || a.streetName, a.number || a.streetNumber].filter(Boolean).join(', ');
  const tail = []
  if(a.neighborhood) tail.push(a.neighborhood)
  if(a.complement) tail.push('Comp: ' + a.complement)
  if(a.reference) tail.push('Ref: ' + a.reference)
  if(a.observation) tail.push('Obs: ' + a.observation)
  if(a.city && !tail.includes(a.city)) tail.push(a.city)
  return [main, tail.filter(Boolean).join(' — ')].filter(Boolean).join(' | ')
}

function formatCurrency(value) {
  if (value == null || isNaN(value)) return 'R$ 0,00';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value));
}

function calculateSubtotal() {
  if (!order.value?.items) return 0;
  return order.value.items.reduce((sum, item) => {
    return sum + (Number(item.price || 0) * Number(item.quantity || 1));
  }, 0);
}

function getStatusLabel(status) {
  const labels = {
    'PENDING': 'Pendente',
    'EM_PREPARO': 'Em preparo',
    'CONFIRMED': 'Confirmado',
    'PREPARING': 'Preparando',
    'READY': 'Pronto',
    'DELIVERING': 'Saiu para entrega',
    'DELIVERED': 'Entregue',
    'CANCELLED': 'Cancelado',
    'FINISHED': 'Finalizado'
  };
  return labels[status] || status || 'Pendente';
}

function getStatusClass(status) {
  const classes = {
    'PENDING': 'bg-warning text-dark',
    'EM_PREPARO': 'bg-info',
    'CONFIRMED': 'bg-info',
    'PREPARING': 'bg-info',
    'READY': 'bg-primary',
    'DELIVERING': 'bg-primary',
    'DELIVERED': 'bg-success',
    'CANCELLED': 'bg-danger',
    'FINISHED': 'bg-success'
  };
  return classes[status] || 'bg-secondary';
}

function getOrderType(order) {
  const types = {
    'DELIVERY': 'Entrega',
    'PICKUP': 'Retirada',
    'INDOOR': 'Mesa'
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
  
  // Tenta pegar de várias fontes possíveis
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

async function load(){
  try{
    const { data } = await api.get(`/orders/${id}`);
    order.value = data?.order || data;
  }catch(e){ console.error('load order failed', e); }
}

onMounted(()=>{ load(); });
</script>

<style scoped>
.timeline-item {
  position: relative;
  padding-left: 0;
}

.table thead th {
  background-color: #f8f9fa;
  font-weight: 600;
  border-bottom: 2px solid #dee2e6;
}

.table tbody td {
  vertical-align: top;
  padding: 0.75rem;
}

.card-title {
  color: #2c3e50;
}

h6.fw-semibold {
  color: #495057;
  font-size: 1rem;
  margin-bottom: 1rem;
}

.text-muted.small {
  font-size: 0.875rem;
  margin-bottom: 0.25rem;
}

.badge {
  font-size: 0.875rem;
  padding: 0.5rem 1rem;
}

.align-top {
  vertical-align: top !important;
}
</style>
