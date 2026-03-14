<template>
  <div class="container-fluid py-4">
    <h4 class="mb-4">Cobranças</h4>

    <!-- Tabs -->
    <ul class="nav nav-tabs mb-4">
      <li class="nav-item">
        <button class="nav-link" :class="{ active: tab === 'invoices' }" @click="tab = 'invoices'">
          Faturas
          <span v-if="dashboard.pendingCount" class="badge bg-danger ms-1">{{ dashboard.pendingCount }}</span>
        </button>
      </li>
      <li class="nav-item">
        <button class="nav-link" :class="{ active: tab === 'dashboard' }" @click="tab = 'dashboard'">Dashboard</button>
      </li>
    </ul>

    <!-- Tab: Faturas -->
    <div v-if="tab === 'invoices'">
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

    <!-- Tab: Dashboard -->
    <div v-if="tab === 'dashboard'">
      <div v-if="loadingDash" class="text-center py-4">
        <div class="spinner-border spinner-border-sm text-primary"></div>
      </div>

      <template v-else>
        <!-- Summary Cards -->
        <div class="row g-3 mb-4">
          <div class="col-md-4">
            <div class="card shadow-sm h-100">
              <div class="card-body text-center">
                <div class="text-muted small">Gasto este mês</div>
                <div class="fs-4 fw-bold text-primary">R$ {{ Number(dashboard.totalSpentThisMonth || 0).toFixed(2) }}</div>
              </div>
            </div>
          </div>
          <div class="col-md-4">
            <div class="card shadow-sm h-100">
              <div class="card-body text-center">
                <div class="text-muted small">Próximo vencimento</div>
                <div class="fs-4 fw-bold" :class="dashboard.nextDueDate ? 'text-warning' : 'text-muted'">
                  {{ dashboard.nextDueDate ? new Date(dashboard.nextDueDate).toLocaleDateString('pt-BR') : '-' }}
                </div>
                <div v-if="dashboard.nextDueAmount" class="small text-muted">R$ {{ Number(dashboard.nextDueAmount).toFixed(2) }}</div>
              </div>
            </div>
          </div>
          <div class="col-md-4">
            <div class="card shadow-sm h-100">
              <div class="card-body text-center">
                <div class="text-muted small">Faturas pendentes</div>
                <div class="fs-4 fw-bold" :class="dashboard.pendingCount ? 'text-danger' : 'text-success'">
                  {{ dashboard.pendingCount || 0 }}
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Monthly Spending Chart (simple bars) -->
        <div class="card shadow-sm mb-4">
          <div class="card-body">
            <h6 class="card-title mb-3">Gastos mensais (últimos 6 meses)</h6>
            <div class="d-flex align-items-end gap-2" style="height: 120px">
              <div v-for="m in chartMonths" :key="m.key" class="text-center flex-fill">
                <div class="bg-primary rounded-top mx-auto" :style="{ width: '32px', height: m.height + 'px' }"></div>
                <small class="text-muted d-block mt-1">{{ m.label }}</small>
                <small class="text-muted d-block">R${{ m.value.toFixed(0) }}</small>
              </div>
            </div>
          </div>
        </div>

        <!-- Active Subscriptions -->
        <div class="card shadow-sm">
          <div class="card-body">
            <h6 class="card-title mb-3">Assinaturas ativas</h6>
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
          </div>
        </div>
      </template>
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
import { ref, computed, onMounted } from 'vue'
import api from '../api.js'
import { useAddOnStoreStore } from '../stores/addOnStore.js'
import Swal from 'sweetalert2'

const addOnStore = useAddOnStoreStore()
const tab = ref('invoices')
const filter = ref('')
const invoices = ref([])
const loadingInvoices = ref(false)
const loadingDash = ref(true)
const paying = ref(null)

const dashboard = ref({
  pendingCount: 0,
  totalSpentThisMonth: 0,
  nextDueDate: null,
  nextDueAmount: null,
  monthlySpending: {},
  plan: null,
  moduleSubscriptions: [],
})

const chartMonths = computed(() => {
  const spending = dashboard.value.monthlySpending || {}
  const months = []
  const now = new Date()
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    months.push({
      key,
      label: d.toLocaleDateString('pt-BR', { month: 'short' }),
      value: spending[key] || 0,
    })
  }
  const max = Math.max(...months.map(m => m.value), 1)
  return months.map(m => ({ ...m, height: Math.max((m.value / max) * 100, 4) }))
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
