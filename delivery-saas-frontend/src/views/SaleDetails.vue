<template>
  <div class="container py-3">
    <button class="btn btn-link mb-3" @click="$router.back()">← Voltar</button>
    <h2>Detalhes do Pedido</h2>

    <div v-if="!order" class="alert alert-secondary">Carregando pedido...</div>

    <div v-else>
      <div class="card mb-3">
        <div class="card-body">
          <h5>Pedido: {{ formatOrderNumber(order) }}</h5>
          <p><strong>Cliente:</strong> {{ order.customer?.fullName || order.customer?.name || '-' }}</p>
          <p><strong>Endereço:</strong> {{ formatAddress(order) }}</p>
          <p><strong>Data / Hora:</strong> {{ formatDateTime(order.createdAt) }}</p>
          <p><strong>Entregador:</strong> {{ order.rider?.name || '-' }}</p>
          <p><strong>Pagamento:</strong> {{ order.paymentMethod || order.payment?.method || '-' }}</p>
        </div>
      </div>

      <div class="card">
        <div class="card-body">
          <h5>Itens</h5>
          <ul>
            <li v-for="(it, idx) in order.items || []" :key="idx">{{ it.name }} × {{ it.quantity }} — {{ it.price }}</li>
          </ul>
        </div>
      </div>

      <pre class="mt-3 small">{{ order }}</pre>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import api from '../api';

const route = useRoute();
const id = route.params.id;
const order = ref(null);

function formatDateTime(s){ if(!s) return '-'; try{ return new Date(s).toLocaleString(); }catch(e){ return s }}
function padNumber(n){ if (n == null || n === '') return null; return String(n).toString().padStart(2, '0'); }
function formatOrderNumber(o){
  if(!o) return '';
  if(o.displaySimple) return o.displaySimple;
  if(o.displayId !== undefined && o.displayId !== null){ const p = padNumber(o.displayId); return p ? p : String(o.displayId); }
  if(o.number !== undefined && o.number !== null) return String(o.number);
  return o.id ? String(o.id).slice(0,6) : '';
}
function formatAddress(o){ if(!o) return '-'; const a = o.address || o.deliveryAddress || o.customerAddress; if(!a) return o.addressText || '-'; return [a.street, a.number, a.complement, a.city].filter(Boolean).join(', '); }

async function load(){
  try{
    const { data } = await api.get(`/orders/${id}`);
    order.value = data?.order || data;
  }catch(e){ console.error('load order failed', e); }
}

onMounted(()=>{ load(); });
</script>

<style scoped>
</style>
