<template>
  <div class="pt-page">
    <div class="pt-header">
      <button class="pt-back" @click="goProfile" aria-label="Voltar"><i class="bi bi-arrow-left"></i></button>
      <h5 class="m-0 fw-bold flex-fill text-center">Extrato de Cashback</h5>
      <div style="width:34px"></div>
    </div>

    <div class="pt-body">
      <div v-if="!cashbackEnabled && !loading" class="pt-empty">
        <i class="bi bi-cash-stack"></i>
        <div class="fw-semibold mt-2">Cashback indisponível</div>
        <div class="small" style="color:var(--pt-muted)">Este recurso não está ativo no momento</div>
      </div>

      <div v-else-if="loading" class="text-center py-4">
        <div class="spinner-border" style="color:var(--pt-brand)" role="status"><span class="visually-hidden">Carregando...</span></div>
      </div>

      <div v-else>
        <!-- Balance card -->
        <div class="pt-balance-card mb-3">
          <div class="pt-balance-label">Saldo disponível</div>
          <div class="pt-balance-value">{{ fmt(Number(wallet.balance||0)) }}</div>
        </div>

        <!-- Transactions -->
        <div v-if="transactions.length === 0" class="pt-empty">
          <i class="bi bi-receipt"></i>
          <div class="fw-semibold mt-2">Nenhuma transação</div>
          <div class="small" style="color:var(--pt-muted)">Suas movimentações aparecerão aqui</div>
        </div>

        <div v-for="t in transactions" :key="t.id" class="pt-tx-card">
          <div class="d-flex gap-3">
            <div :class="['pt-tx-icon', t.type === 'CREDIT' ? 'credit' : 'debit']">
              <i :class="t.type === 'CREDIT' ? 'bi bi-arrow-down-left' : 'bi bi-arrow-up-right'"></i>
            </div>
            <div class="flex-fill" style="min-width:0">
              <div class="pt-tx-type">{{ t.type === 'CREDIT' ? 'Crédito' : 'Débito' }}</div>
              <div class="pt-tx-desc">{{ t.description || '' }}</div>
              <div class="pt-tx-date">{{ formatDate(t.createdAt) }}</div>
            </div>
            <div class="text-end">
              <div :class="['pt-tx-amount', t.type === 'CREDIT' ? 'credit' : 'debit']">
                {{ t.type === 'CREDIT' ? '+' : '-' }}{{ fmt(Number(t.amount||0)) }}
              </div>
              <div class="pt-tx-balance">Saldo: {{ fmt(Number(t.balanceAfter||0)) }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <nav class="pt-bottom-nav d-lg-none">
      <button :class="{ active: navActive('/profile') }" class="pt-nav-item" @click.prevent="goProfile">
        <i class="bi bi-person pt-nav-icon"></i><div class="pt-nav-label">Perfil</div>
      </button>
      <button :class="{ active: navActive('/history') }" class="pt-nav-item" @click.prevent="goHistory">
        <i class="bi bi-journal-text pt-nav-icon"></i><div class="pt-nav-label">Histórico</div>
      </button>
      <button :class="{ active: navActive('/menu') }" class="pt-nav-item" @click.prevent="goMenu">
        <i class="bi bi-grid pt-nav-icon"></i><div class="pt-nav-label">Cardápio</div>
      </button>
    </nav>
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

function fmt(v){ return new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(v) }
function formatDate(d){ try{ return new Date(d).toLocaleString('pt-BR') }catch(e){ return d } }

onMounted(async ()=>{
  loading.value = true
  try{
    const settingsRes = await api.get(`/public/${companyId}/cashback-settings`)
    cashbackEnabled.value = !!(settingsRes.data && settingsRes.data.enabled)
  }catch(e){ cashbackEnabled.value = false }
  if(!cashbackEnabled.value){ loading.value = false; return }
  try{
    const stored = JSON.parse(localStorage.getItem(`public_customer_${companyId}`) || 'null')
    const clientId = stored && (stored.id || stored.clientId || stored.customerId) ? (stored.id || stored.clientId || stored.customerId) : null
    if(!clientId){
      const token = localStorage.getItem(PUBLIC_TOKEN_KEY)
      if(token){ try{ await api.get('/auth/me') }catch(e){} }
    }
    if(!clientId){ wallet.value = { balance: 0, transactions: [] }; transactions.value = []; return }
    const res = await api.get(`/cashback/wallet?clientId=${encodeURIComponent(clientId)}&companyId=${companyId}`)
    wallet.value = res.data || { balance: 0, transactions: [] }
    transactions.value = Array.isArray(wallet.value.transactions) ? wallet.value.transactions : []
  }catch(e){ console.warn('PublicTransactions load error', e); wallet.value = { balance: 0, transactions: [] }; transactions.value = [] }
  finally{ loading.value = false }
})

function _publicNavigate(pathSuffix){
  try{ const base = `/public/${route.params.companyId || companyId}`; const q = Object.assign({}, route.query || {}); Object.keys(q).forEach(k => { if (q[k] === undefined) delete q[k] }); router.push({ path: `${base}${pathSuffix || ''}`, query: q }) }catch(e){}
}
function goProfile(){ _publicNavigate('/profile') }
function goHistory(){ _publicNavigate('/history') }
function goMenu(){ _publicNavigate('/menu') }
function navActive(suffix){ try{ return (route.path || '').endsWith(suffix) }catch(e){ return false } }
</script>

<style scoped>
.pt-page {
  --pt-bg: #FFF8F0; --pt-surface: #FFFFFF; --pt-surface-alt: #FBF3E8;
  --pt-border: #F0E6D2; --pt-text: #1A1410; --pt-muted: #7A6E62;
  --pt-brand: #2E7D32; --pt-brand-light: #E8F5E9;
  font-family: 'Inter', -apple-system, system-ui, sans-serif;
  background: var(--pt-bg); min-height: 100vh; color: var(--pt-text); padding-bottom: 80px;
}
.pt-header {
  display: flex; align-items: center; padding: 16px 20px;
  background: var(--pt-surface); border-bottom: 1px solid var(--pt-border);
  position: sticky; top: 0; z-index: 10;
}
.pt-back {
  all: unset; cursor: pointer; width: 34px; height: 34px; border-radius: 50%;
  background: var(--pt-surface-alt); display: flex; align-items: center; justify-content: center;
  font-size: 14px; color: var(--pt-text);
}
.pt-back:hover { background: var(--pt-border); }
.pt-body { max-width: 520px; margin: 0 auto; padding: 20px 16px; }

/* Balance card */
.pt-balance-card {
  background: var(--pt-brand); color: #fff;
  border-radius: 16px; padding: 24px; text-align: center;
}
.pt-balance-label { font-size: 13px; opacity: 0.85; margin-bottom: 4px; }
.pt-balance-value { font-size: 28px; font-weight: 800; letter-spacing: -0.5px; }

/* Empty */
.pt-empty { text-align: center; padding: 40px 16px; color: var(--pt-muted); }
.pt-empty i { font-size: 40px; }

/* Transaction card */
.pt-tx-card {
  background: var(--pt-surface); border: 1px solid var(--pt-border);
  border-radius: 14px; padding: 14px 16px; margin-bottom: 10px;
}
.pt-tx-icon {
  width: 36px; height: 36px; border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
  font-size: 16px; flex-shrink: 0;
}
.pt-tx-icon.credit { background: var(--pt-brand-light); color: var(--pt-brand); }
.pt-tx-icon.debit { background: #FFEBEE; color: #C62828; }
.pt-tx-type { font-size: 13px; font-weight: 700; color: var(--pt-text); }
.pt-tx-desc { font-size: 12px; color: var(--pt-muted); margin-top: 1px; }
.pt-tx-date { font-size: 11px; color: var(--pt-muted); margin-top: 2px; }
.pt-tx-amount { font-size: 14px; font-weight: 700; white-space: nowrap; }
.pt-tx-amount.credit { color: var(--pt-brand); }
.pt-tx-amount.debit { color: #C62828; }
.pt-tx-balance { font-size: 11px; color: var(--pt-muted); margin-top: 2px; }

/* Bottom nav */
.pt-bottom-nav {
  display: flex; position: fixed; left: 0; right: 0; bottom: 0; height: 64px;
  background: var(--pt-surface); border-top: 1px solid var(--pt-border);
  z-index: 10800; align-items: center; justify-content: space-around;
}
.pt-nav-item {
  all: unset; cursor: pointer; display: flex; flex-direction: column;
  align-items: center; gap: 4px; padding: 6px 12px; color: var(--pt-muted);
}
.pt-nav-icon { font-size: 20px; line-height: 1; }
.pt-nav-label { font-size: 11px; }
.pt-nav-item.active, .pt-nav-item.active .pt-nav-label, .pt-nav-item.active .pt-nav-icon {
  color: var(--pt-brand) !important; font-weight: 700;
}
@media (max-width: 576px) { .pt-body { padding: 16px 12px; } }
</style>
