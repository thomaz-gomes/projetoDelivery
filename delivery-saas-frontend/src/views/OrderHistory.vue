<template>
  <div class="container py-4">
    <div class="card">
      <div class="card-body">
        <h4>Meu histórico de pedidos</h4>
        <div class="mb-3">
          <label class="form-label">WhatsApp</label>
          <input v-model="phone" class="form-control" placeholder="559999999999" />
          <div class="mt-2 d-flex gap-2">
            <button class="btn btn-primary" @click="loadHistory">Carregar</button>
            <button class="btn btn-outline-secondary" @click="useSaved">Usar dados salvos</button>
          </div>
        </div>

        <div v-if="loading" class="text-center py-3">Carregando...</div>
        <div v-else>
          <div v-if="orders.length===0" class="text-muted">Nenhum pedido encontrado</div>
          <ul class="list-group">
            <li class="list-group-item" v-for="o in orders" :key="o.id">
              <div class="d-flex justify-content-between">
                <div>
                  <div><strong>#{{ o.displayId || o.id.slice(0,6) }}</strong> — {{ o.status }}</div>
                  <div class="small text-muted">Total: R$ {{ Number(o.total || 0).toFixed(2) }} — {{ new Date(o.createdAt).toLocaleString() }}</div>
                </div>
                <div>
                  <router-link :to="`/public/${companyId}/order/${o.id}`" class="btn btn-sm btn-primary">Ver</router-link>
                </div>
              </div>
            </li>
          </ul>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import Swal from 'sweetalert2'
import { bindLoading } from '../state/globalLoading.js'
import { useRoute, useRouter } from 'vue-router'
import api from '../api'
const route = useRoute()
const router = useRouter()
const companyId = route.params.companyId

const phone = ref(route.query.phone || '')
const loading = ref(false)
bindLoading(loading)
const orders = ref([])

async function loadHistory(){
  loading.value = true
  try{
    const res = await api.get(`/public/${companyId}/orders?phone=${encodeURIComponent(phone.value)}`)
    orders.value = res.data || []
    // persist contact for convenience
    localStorage.setItem(`public_customer_${companyId}`, JSON.stringify({ name: '', contact: phone.value }))
  }catch(e){
    console.error('Failed to load history', e)
    orders.value = []
  }finally{ loading.value = false }
}

async function useSaved(){
  const saved = JSON.parse(localStorage.getItem(`public_customer_${companyId}`) || 'null')
  if(saved && saved.contact){ phone.value = saved.contact; loadHistory() }
  else await Swal.fire({ icon: 'info', text: 'Nenhum contato salvo encontrado.' })
}

// auto-load if phone in query
if (phone.value) loadHistory()
</script>
