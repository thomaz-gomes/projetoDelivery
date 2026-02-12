<script setup>
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import api from '../api'

const router = useRouter()
const companies = ref([])
const plans = ref([])
const modules = ref([])
const invoices = ref([])
const loading = ref(true)

async function load(){
  loading.value = true
  try {
    const [cRes, pRes, mRes, iRes] = await Promise.all([
      api.get('/saas/companies'),
      api.get('/saas/plans'),
      api.get('/saas/modules'),
      api.get('/saas/invoices').catch(() => ({ data: { rows: [] } }))
    ])
    companies.value = cRes.data || []
    plans.value = pRes.data || []
    modules.value = mRes.data || []
    invoices.value = iRes.data?.rows || iRes.data || []
  } finally { loading.value = false }
}

onMounted(load)

const activeModules = computed(() => modules.value.filter(m => m.isActive).length)
const pendingInvoices = computed(() => invoices.value.filter(i => i.status === 'PENDING').length)
const overdueInvoices = computed(() => invoices.value.filter(i => i.status === 'OVERDUE').length)

const stats = computed(() => [
  { label: 'Empresas', value: companies.value.length, icon: 'bi-building', color: 'primary', to: '/saas/companies' },
  { label: 'Planos', value: plans.value.length, icon: 'bi-list-check', color: 'success', to: '/saas/plans' },
  { label: 'Módulos', value: `${activeModules.value}/${modules.value.length}`, icon: 'bi-box-seam', color: 'warning', to: '/saas/modules', sub: 'ativos' },
  { label: 'Faturas pendentes', value: pendingInvoices.value, icon: 'bi-receipt', color: overdueInvoices.value > 0 ? 'danger' : 'info', to: '/saas/billing' },
])

const recentInvoices = computed(() => invoices.value.slice(0, 8))

function go(path){ router.push(path) }

function statusClass(s) {
  if (s === 'PAID') return 'bg-success'
  if (s === 'OVERDUE') return 'bg-danger'
  return 'bg-warning text-dark'
}
function statusLabel(s) {
  if (s === 'PAID') return 'Pago'
  if (s === 'OVERDUE') return 'Atrasado'
  return 'Pendente'
}
</script>

<template>
  <div class="container py-3">
    <div class="d-flex justify-content-between align-items-center mb-4">
      <h2 class="mb-0">Painel SaaS</h2>
      <button class="btn btn-primary" @click="go('/saas/companies/new')">
        <i class="bi bi-plus-lg me-1"></i>Nova empresa
      </button>
    </div>

    <div v-if="loading" class="text-center py-5">
      <div class="spinner-border text-primary"></div>
    </div>

    <template v-else>
      <!-- Stats cards -->
      <div class="row g-3 mb-4">
        <div v-for="s in stats" :key="s.label" class="col-6 col-lg-3">
          <div class="card h-100 border-0 shadow-sm" role="button" @click="go(s.to)" style="cursor: pointer;">
            <div class="card-body d-flex align-items-center">
              <span class="rounded-3 d-inline-flex align-items-center justify-content-center me-3"
                :class="`bg-${s.color} bg-opacity-10 text-${s.color}`"
                style="width: 48px; height: 48px;">
                <i class="bi" :class="s.icon" style="font-size: 1.4rem;"></i>
              </span>
              <div>
                <div class="h3 mb-0">{{ s.value }}</div>
                <div class="text-muted small">{{ s.label }}</div>
                <div v-if="s.sub" class="text-muted" style="font-size: 0.7rem;">{{ s.sub }}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="row g-3">
        <!-- Recent invoices -->
        <div class="col-lg-7">
          <div class="card border-0 shadow-sm">
            <div class="card-body">
              <div class="d-flex justify-content-between align-items-center mb-3">
                <h6 class="mb-0">Últimas faturas</h6>
                <router-link to="/saas/billing" class="btn btn-sm btn-outline-secondary">Ver todas</router-link>
              </div>
              <table class="table table-sm table-hover mb-0">
                <thead><tr><th>Empresa</th><th>Ref.</th><th>Valor</th><th>Status</th></tr></thead>
                <tbody>
                  <tr v-for="inv in recentInvoices" :key="inv.id">
                    <td>{{ inv.company?.name || '—' }}</td>
                    <td>{{ String(inv.month).padStart(2,'0') }}/{{ inv.year }}</td>
                    <td>R$ {{ Number(inv.amount).toFixed(2) }}</td>
                    <td><span class="badge" :class="statusClass(inv.status)">{{ statusLabel(inv.status) }}</span></td>
                  </tr>
                  <tr v-if="recentInvoices.length===0"><td colspan="4" class="text-muted text-center py-3">Nenhuma fatura</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <!-- Quick links + modules summary -->
        <div class="col-lg-5">
          <div class="card border-0 shadow-sm mb-3">
            <div class="card-body">
              <h6 class="mb-3">Atalhos</h6>
              <div class="d-grid gap-2">
                <button class="btn btn-outline-primary text-start" @click="go('/saas/plans')">
                  <i class="bi bi-list-check me-2"></i>Gerenciar Planos
                </button>
                <button class="btn btn-outline-primary text-start" @click="go('/saas/modules')">
                  <i class="bi bi-box-seam me-2"></i>Gerenciar Módulos
                </button>
                <button class="btn btn-outline-primary text-start" @click="go('/saas/companies')">
                  <i class="bi bi-building me-2"></i>Gerenciar Empresas
                </button>
                <button class="btn btn-outline-primary text-start" @click="go('/saas/billing')">
                  <i class="bi bi-receipt me-2"></i>Mensalidades
                </button>
              </div>
            </div>
          </div>

          <div class="card border-0 shadow-sm">
            <div class="card-body">
              <h6 class="mb-3">Módulos cadastrados</h6>
              <div v-if="modules.length === 0" class="text-muted small">Nenhum módulo cadastrado</div>
              <div v-for="m in modules" :key="m.id" class="d-flex align-items-center mb-2">
                <span class="badge me-2" :class="m.isActive ? 'bg-success' : 'bg-secondary'" style="width: 60px;">
                  {{ m.isActive ? 'Ativo' : 'Inativo' }}
                </span>
                <span class="small">{{ m.name }}</span>
                <code class="ms-auto small text-muted">{{ m.key }}</code>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
