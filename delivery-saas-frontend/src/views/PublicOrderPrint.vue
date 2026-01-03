<template>
  <div class="public-container">
    <div class="list-card container py-4 list-card--card-style">
      <div class="card"><div class="card-body">
        <div v-if="loading">Carregando comanda...</div>
        <div v-else-if="order">
          <div class="d-flex justify-content-between mb-3">
            <h4>Pré-visualização da comanda</h4>
            <div>
              <button class="btn btn-sm btn-primary me-2" @click="print">Imprimir</button>
              <button class="btn btn-sm btn-secondary" @click="goBack">Voltar</button>
            </div>
          </div>
          <OrderTicketPreview :order="order" />
        </div>
        <div v-else class="text-muted">Pedido não encontrado.</div>
      </div></div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import api from '../api'
import OrderTicketPreview from '../components/OrderTicketPreview.vue'

const route = useRoute()
const router = useRouter()
const companyId = route.params.companyId
const orderId = route.params.orderId
const loading = ref(true)
const order = ref(null)

async function load(){
  loading.value = true
  try{
    // attempt to fetch by order id (public endpoint used elsewhere)
    const phone = route.query.phone || ''
    const q = phone ? `?phone=${encodeURIComponent(phone)}` : ''
    const res = await api.get(`/public/${companyId}/orders/${orderId}${q}`)
    order.value = res?.data || res?.data?.order || null
  }catch(e){
    console.warn('load order for print failed', e?.message || e)
    // fallback: try generic orders list and find
    try{
      const list = await api.get(`/public/${companyId}/orders`)
      const arr = Array.isArray(list.data) ? list.data : (list.data?.orders || [])
      order.value = arr.find(o=> String(o.id) === String(orderId) || String(o.displayId) === String(orderId)) || null
    }catch(err){ order.value = null }
  }finally{ loading.value = false }
}

function print(){ window.print() }
function goBack(){ router.back() }

onMounted(load)
</script>

<style scoped>
/* Ensure print page uses compact ticket styling */
@media print{
  body *{ visibility: hidden }
  .ticket-preview, .ticket-preview *{ visibility: visible }
  .ticket-preview{ position: absolute; left: 0; top: 0 }
}
</style>
