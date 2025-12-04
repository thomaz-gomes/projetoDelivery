<template>
  <div class="affiliate-statement">
    <h1>Meu Extrato</h1>

    <div v-if="loading">Carregando...</div>
    <div v-else-if="error" class="error">{{ error }}</div>
    <div v-else>
      <div class="header">
        <h2>{{ affiliate.name }}</h2>
        <div class="coupon">Cupom: {{ affiliate.couponCode }}</div>
      </div>

      <div v-if="timeline.length === 0" class="empty">Nenhuma atividade encontrada</div>

      <div class="timeline-headers">
        <div class="col time">Data</div>
        <div class="col desc">Atividade</div>
        <div class="col amount">Valor</div>
        <div class="col balance">Saldo após</div>
      </div>

      <ul class="timeline">
        <li v-for="item in timeline" :key="item.type + '-' + item.id" :class="['timeline-item', item.type]">
          <div class="col time">{{ formatDate(item.date) }}</div>

          <div class="col desc">
            <div class="activity">
              <i v-if="item.type === 'sale'" class="bi bi-cart-fill icon" aria-hidden="true"></i>
              <i v-else class="bi bi-cash-stack icon" aria-hidden="true"></i>
              <div class="text">
                <div v-if="item.type === 'sale'">
                  <strong>Venda</strong>
                  <div class="meta">Pedido: <span v-if="item.orderId"><a href="#" @click.prevent="goToOrder(item.orderId)">#{{ item.orderId }}</a></span><span v-else>-</span>
                  &nbsp;|&nbsp; Lançado por: {{ item.actorName || 'sistema' }}</div>
                </div>
                <div v-else>
                  <strong>Pagamento</strong>
                  <div class="meta">Registrado por: {{ item.actorName || 'sistema' }} &nbsp;|&nbsp; Método: {{ item.method || '-' }}</div>
                </div>
              </div>
            </div>
          </div>

          <div class="col amount">{{ fmt(item.type === 'sale' ? item.commission : item.amount) }}</div>
          <div class="col balance">{{ fmt(item.balanceAfter) }}</div>
        </li>
      </ul>
    </div>
    <div style="height:76px"></div>
    <AffiliateFooter />
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '../../stores/auth'
import api from '@/api.js'
import { formatDateTime } from '../../utils/dates'
import AffiliateFooter from '../../components/AffiliateFooter.vue'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const affiliate = ref({ id: '', name: '', couponCode: '' })
const timeline = ref([])
const loading = ref(true)
const error = ref('')

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

const load = async () => {
  loading.value = true
  error.value = ''
  try {
    const id = route.params.id || auth.user?.affiliateId
    if (!id) {
      error.value = 'Afiliado não especificado'
      return
    }
    const res = await api.get(`/affiliates/${id}/statement`)
    affiliate.value = res.data.affiliate
    const raw = res.data.timeline || []

    // Compute running balance per row. We'll compute cumulatively from oldest -> newest
    const asc = raw.slice().sort((a, b) => new Date(a.date) - new Date(b.date))
    let cum = 0
    for (const it of asc) {
      if (it.type === 'sale') {
        const commission = Number(it.commission || 0)
        cum += commission
        it.balanceAfter = Number(cum)
      } else if (it.type === 'payment') {
        const amt = Number(it.amount || 0)
        cum -= amt
        it.balanceAfter = Number(cum)
      } else {
        it.balanceAfter = Number(cum)
      }
    }

    // reverse to show newest first but keep balanceAfter computed
    timeline.value = asc.slice().reverse()
  } catch (err) {
    console.error('Failed to load statement', err)
    error.value = err.response?.data?.message || 'Erro ao carregar extrato'
  } finally {
    loading.value = false
  }
}

const formatDate = (d) => { if(!d) return ''; try { return formatDateTime(d) } catch(e) { return d } }
const fmt = (v) => currency.format(Number(v || 0))
const goToOrder = (orderId) => { if (!orderId) return; router.push({ path: `/orders/${orderId}/receipt` }) }

onMounted(load)

</script>

<style scoped>
.affiliate-statement { padding: 16px; box-sizing: border-box; overflow-x: hidden }
.timeline { list-style: none; padding: 0; margin: 0 }
.timeline-item { padding: 12px; border-bottom: 1px solid #eee; display: grid; grid-template-columns: minmax(0,160px) 1fr minmax(0,120px) minmax(0,120px); gap: 12px; align-items: center }
.timeline-headers { display: grid; grid-template-columns: minmax(0,160px) 1fr minmax(0,120px) minmax(0,120px); gap: 12px; padding: 8px 12px; border-bottom: 2px solid #ddd; font-weight: 600; color: #444 }
.time { font-size: 13px; color: #555; white-space: nowrap }
.meta { font-size: 12px; color: #555; margin-top:6px }
.header { display:flex; justify-content:space-between; align-items:center; gap:12px }
.coupon { font-family: monospace; word-break: break-all }
.empty { padding: 20px; color: #666 }
.error { color: #e74c3c }
.timeline-item.sale { background: rgba(40,167,69,0.03); }
.timeline-item.payment { background: rgba(220,53,69,0.03); }
.icon { font-size: 20px; margin-right: 8px; vertical-align: middle }
.activity { display:flex; align-items:center }
.col.amount { text-align: right; white-space: nowrap }
.col.balance { text-align: right; font-weight: 600; white-space: nowrap }

/* Small screens: stack columns vertically, hide the header row */
@media (max-width: 600px) {
  .timeline-headers { display: none }
  .timeline-item { grid-template-columns: 1fr; grid-auto-rows: auto; padding: 10px 6px }
  .timeline-item .col { display: flex; justify-content: space-between; align-items: center; padding: 6px 0; gap: 8px }
  .timeline-item .col.desc { align-items: flex-start }
  .timeline-item .activity { gap: 8px }
  .activity .text { flex: 1; min-width: 0 }
  .activity .meta { color: #666 }
  .col.amount, .col.balance { justify-content: flex-end }
  .time { font-size: 13px }
  .affiliate-statement { padding-bottom: 96px } /* leave room for footer */
}

/* Ensure long text wraps rather than causing horizontal scroll */
.affiliate-statement, .timeline, .timeline-item, .activity, .text { word-break: break-word; overflow-wrap: anywhere }
</style>
