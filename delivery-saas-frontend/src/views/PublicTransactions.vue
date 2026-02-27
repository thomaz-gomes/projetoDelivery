<template>
  <div class="public-container">
    <div class="list-card container py-4 list-card--card-style">
      <div class="card"><div class="card-body">
        <h4 class="mb-3">Extrato de Cashback</h4>
        <div v-if="!cashbackEnabled && !loading" class="text-muted py-3">Cashback não está disponível no momento.</div>
        <div v-else-if="loading" class="text-center py-4"><div class="spinner-border text-primary" role="status"></div></div>
        <div v-else>
          <div class="mb-3">
            <div class="small text-muted">Saldo atual</div>
            <div class="fw-semibold">{{ new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(wallet.balance||0)) }}</div>
          </div>
          <div v-if="transactions.length===0" class="text-muted">Nenhuma transação encontrada.</div>
          <ul class="list-group">
            <li class="list-group-item" v-for="t in transactions" :key="t.id">
              <div class="d-flex justify-content-between align-items-start">
                <div>
                  <div class="fw-semibold">{{ t.type === 'CREDIT' ? 'Crédito' : 'Débito' }} — {{ t.description || '' }}</div>
                  <div class="small text-muted">{{ formatDate(t.createdAt) }}</div>
                </div>
                <div class="text-end">
                  <div class="fw-semibold">{{ new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(t.amount||0)) }}</div>
                  <div class="small text-muted">Saldo: {{ new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(t.balanceAfter||0)) }}</div>
                </div>
              </div>
            </li>
          </ul>
        </div>
      </div></div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import api from '../api'

const route = useRoute()
const router = useRouter()
const companyId = route.params.companyId || ''
const PUBLIC_TOKEN_KEY = `public_token_${companyId}`

const loading = ref(false)
const cashbackEnabled = ref(true)
const wallet = ref({ balance: 0, transactions: [] })
const transactions = ref([])

function formatDate(d){ try{ return new Date(d).toLocaleString() }catch(e){ return d } }

onMounted(async ()=>{
  loading.value = true
  // check if cashback is enabled before loading transactions
  try{
    const settingsRes = await api.get(`/public/${companyId}/cashback-settings`)
    cashbackEnabled.value = !!(settingsRes.data && settingsRes.data.enabled)
  }catch(e){ cashbackEnabled.value = false }
  if(!cashbackEnabled.value){ loading.value = false; return }
  try{
    const stored = JSON.parse(localStorage.getItem(`public_customer_${companyId}`) || 'null')
    const clientId = stored && (stored.id || stored.clientId || stored.customerId) ? (stored.id || stored.clientId || stored.customerId) : null
    if(!clientId){
      // if there's a token, try backend to resolve current customer
      const token = localStorage.getItem(PUBLIC_TOKEN_KEY)
      if(token){
        try{ const me = await api.get('/auth/me'); if(me?.data?.user) { /* nothing */ } }catch(e){}
      }
    }
    if(!clientId){
      // nothing to fetch
      wallet.value = { balance: 0, transactions: [] }
      transactions.value = []
      return
    }
    const res = await api.get(`/cashback/wallet?clientId=${encodeURIComponent(clientId)}&companyId=${companyId}`)
    wallet.value = res.data || { balance: 0, transactions: [] }
    transactions.value = Array.isArray(wallet.value.transactions) ? wallet.value.transactions : []
  }catch(e){ console.warn('PublicTransactions load error', e); wallet.value = { balance: 0, transactions: [] }; transactions.value = [] }
  finally{ loading.value = false }
})
</script>

<style scoped>
.list-card--card-style .card{ border-radius:12px }
</style>
