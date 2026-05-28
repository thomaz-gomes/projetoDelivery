<template>
  <div class="container-fluid py-4">
    <h4 class="mb-4">Cobranças</h4>

    <!-- Active Subscriptions -->
    <div class="card shadow-sm mb-4">
      <div class="card-body">
        <h6 class="card-title mb-3">Assinaturas ativas</h6>
        <div v-if="loadingDash" class="text-center py-3">
          <div class="spinner-border spinner-border-sm text-primary"></div>
        </div>
        <template v-else>
          <div v-if="dashboard.plan" class="d-flex justify-content-between align-items-center py-2 border-bottom">
            <div>
              <strong>Plano: {{ dashboard.plan.name }}</strong>
              <span class="badge bg-success ms-2">{{ dashboard.plan.status }}</span>
            </div>
            <div class="text-muted">R$ {{ Number(dashboard.plan.price).toFixed(2) }}/mês</div>
          </div>
          <div v-for="ms in (dashboard.moduleSubscriptions || [])" :key="ms.id"
               class="d-flex justify-content-between align-items-center py-2 border-bottom">
            <div>
              <strong>{{ ms.moduleName }}</strong>
              <span class="badge bg-info ms-2">{{ ms.period }}</span>
            </div>
            <div class="text-muted">Próx: {{ ms.nextDueAt ? new Date(ms.nextDueAt).toLocaleDateString('pt-BR') : '-' }}</div>
          </div>
          <div v-if="!dashboard.plan && !(dashboard.moduleSubscriptions || []).length" class="text-muted py-2">
            Nenhuma assinatura ativa.
          </div>
        </template>
      </div>
    </div>

    <!-- Invoices -->
    <div>
      <div class="mb-3 d-flex gap-2">
        <select class="form-select" style="max-width:160px" v-model="filter" @change="loadInvoices">
          <option value="">Todas</option>
          <option value="PENDING">Pendentes</option>
          <option value="PAID">Pagas</option>
          <option value="OVERDUE">Vencidas</option>
        </select>
      </div>

      <div v-if="loadingInvoices" class="text-center py-4">
        <div class="spinner-border spinner-border-sm text-primary"></div>
      </div>

      <div v-else-if="!invoices.length" class="text-muted text-center py-4">Nenhuma fatura encontrada.</div>

      <div v-else class="table-responsive">
        <table class="table table-hover align-middle">
          <thead>
            <tr>
              <th>Descrição</th>
              <th>Valor</th>
              <th>Vencimento</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="inv in invoices" :key="inv.id">
              <td>
                <div>{{ invoiceDescription(inv) }}</div>
                <small v-if="inv.autoCharge" class="text-muted"><i class="bi bi-arrow-repeat me-1"></i>Recorrente</small>
              </td>
              <td>R$ {{ Number(inv.amount).toFixed(2) }}</td>
              <td>{{ inv.dueDate ? new Date(inv.dueDate).toLocaleDateString('pt-BR') : '-' }}</td>
              <td>
                <span class="badge" :class="statusBadge(inv.status)">{{ statusLabel(inv.status) }}</span>
              </td>
              <td>
                <button v-if="inv.status === 'PENDING' || inv.status === 'OVERDUE'"
                        class="btn btn-sm btn-primary" @click="payInvoice(inv.id)" :disabled="paying === inv.id">
                  <span v-if="paying === inv.id" class="spinner-border spinner-border-sm me-1"></span>
                  Pagar
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Payment loading overlay -->
    <div v-if="paying" class="payment-overlay">
      <div class="text-center text-white">
        <div class="spinner-border mb-3" style="width:3rem;height:3rem" role="status"></div>
        <div class="fs-5">Iniciando pagamento...</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import api from '../api.js'
import { useAddOnStoreStore } from '../stores/addOnStore.js'
import Swal from 'sweetalert2'

const addOnStore = useAddOnStoreStore()
const filter = ref('')
const invoices = ref([])
const loadingInvoices = ref(false)
const loadingDash = ref(true)
const paying = ref(null)

const dashboard = ref({
  plan: null,
  moduleSubscriptions: [],
})

onMounted(() => {
  loadInvoices()
  loadDashboard()
})

async function loadInvoices() {
  loadingInvoices.value = true
  try {
    const params = { mine: true }
    if (filter.value) params.status = filter.value
    const { data } = await api.get('/saas/invoices', { params })
    invoices.value = data.rows || data.invoices || data
  } catch (e) {
    console.error(e)
  } finally {
    loadingInvoices.value = false
  }
}

async function loadDashboard() {
  loadingDash.value = true
  try {
    const { data } = await api.get('/saas/billing/dashboard')
    dashboard.value = data
  } catch (e) {
    console.error(e)
  } finally {
    loadingDash.value = false
  }
}

async function payInvoice(invoiceId) {
  paying.value = invoiceId
  try {
    const result = await addOnStore.payInvoice(invoiceId)
    if (result?.checkoutUrl) {
      window.location.href = result.checkoutUrl
    } else if (result?.manual) {
      Swal.fire({ icon: 'info', text: 'Pagamento manual. Entre em contato com o administrador.' })
    }
  } catch (e) {
    Swal.fire({ icon: 'error', text: e.response?.data?.message || 'Erro ao processar pagamento' })
  } finally {
    paying.value = null
  }
}

function invoiceDescription(inv) {
  if (inv.items?.length) {
    return inv.items.map(i => i.description).join(', ')
  }
  return `Fatura ${inv.month}/${inv.year}`
}

function statusBadge(status) {
  return {
    PENDING: 'bg-warning text-dark',
    PAID: 'bg-success',
    OVERDUE: 'bg-danger',
  }[status] || 'bg-secondary'
}

function statusLabel(status) {
  return {
    PENDING: 'Pendente',
    PAID: 'Paga',
    OVERDUE: 'Vencida',
  }[status] || status
}
</script>

<style scoped>
.payment-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}
</style>
