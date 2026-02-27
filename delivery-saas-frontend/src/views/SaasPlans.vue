<script setup>
import { ref, onMounted } from 'vue'
import api from '../api'
import Swal from 'sweetalert2'

const PERIOD_OPTIONS = [
  { value: 'MONTHLY', label: 'Mensal' },
  { value: 'BIMONTHLY', label: 'Bimensal' },
  { value: 'QUARTERLY', label: 'Trimestral' },
  { value: 'ANNUAL', label: 'Anual' }
]

const MODULE_KEYS = {
  RIDERS: { label: 'Entregadores', icon: 'bi-bicycle', color: 'primary' },
  AFFILIATES: { label: 'Afiliados', icon: 'bi-people-fill', color: 'success' },
  STOCK: { label: 'Controle de Estoque', icon: 'bi-box-seam', color: 'warning' },
  CASHBACK: { label: 'Cashback', icon: 'bi-cash-stack', color: 'info' },
  COUPONS: { label: 'Cupons', icon: 'bi-ticket-perforated', color: 'danger' },
  WHATSAPP: { label: 'WhatsApp', icon: 'bi-whatsapp', color: 'success' },
}
const keyMeta = (key) => MODULE_KEYS[key] || { label: key, icon: 'bi-box', color: 'secondary' }

const modules = ref([])
const plans = ref([])
const loading = ref(true)
const showForm = ref(false)
const editingId = ref(null)

const emptyForm = () => ({ name: '', price: 0, menuLimit: null, storeLimit: null, unlimitedMenus: false, unlimitedStores: false, aiCreditsMonthlyLimit: 100, unlimitedAiCredits: false, moduleIds: [], prices: [] })
const form = ref(emptyForm())

async function loadAll(){
  loading.value = true
  try {
    const [modsRes, plansRes] = await Promise.all([
      api.get('/saas/modules'),
      api.get('/saas/plans')
    ])
    modules.value = modsRes.data || []
    plans.value = plansRes.data || []
  } finally { loading.value = false }
}

onMounted(loadAll)

function openCreate() {
  editingId.value = null
  form.value = emptyForm()
  showForm.value = true
}

function openEdit(p) {
  editingId.value = p.id
  form.value = {
    name: p.name,
    price: Number(p.price || 0),
    menuLimit: p.menuLimit,
    storeLimit: p.storeLimit,
    unlimitedMenus: p.unlimitedMenus || false,
    unlimitedStores: p.unlimitedStores || false,
    aiCreditsMonthlyLimit: p.aiCreditsMonthlyLimit ?? 100,
    unlimitedAiCredits: p.unlimitedAiCredits || false,
    moduleIds: (p.modules || []).map(pm => pm.moduleId),
    prices: (p.prices || []).map(pr => ({ period: pr.period, price: String(Number(pr.price || 0)) }))
  }
  showForm.value = true
}

function cancelForm() {
  showForm.value = false
  editingId.value = null
}

async function savePlan(){
  if (!form.value.name) return
  const payload = { ...form.value, price: Number(form.value.price || 0) }
  if (Array.isArray(payload.prices)) payload.prices = payload.prices.map(p => ({ period: p.period, price: String(Number(p.price || 0)) }))
  try {
    if (editingId.value) {
      await api.put(`/saas/plans/${editingId.value}`, payload)
    } else {
      await api.post('/saas/plans', payload)
    }
    showForm.value = false
    editingId.value = null
    await loadAll()
  } catch (e) {
    Swal.fire({ icon: 'error', title: 'Erro', text: e?.response?.data?.message || 'Falha ao salvar' })
  }
}

async function deletePlan(p){
  const result = await Swal.fire({
    title: `Remover "${p.name}"?`,
    text: 'Empresas assinantes deste plano perderão a referência.',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#dc3545',
    confirmButtonText: 'Sim, remover',
    cancelButtonText: 'Cancelar'
  })
  if (!result.isConfirmed) return
  try {
    await api.delete(`/saas/plans/${p.id}`)
    await loadAll()
  } catch(e) { console.warn('Failed to delete plan', e) }
}

function periodLabel(v) {
  const opt = PERIOD_OPTIONS.find(o => o.value === v)
  return opt ? opt.label : v
}
</script>

<template>
  <div class="container py-3">
    <div class="d-flex justify-content-between align-items-center mb-3">
      <div>
        <h2 class="mb-0">Planos</h2>
        <small class="text-muted">Configure os planos de assinatura e seus módulos</small>
      </div>
      <button v-if="!showForm" class="btn btn-primary" @click="openCreate">
        <i class="bi bi-plus-lg me-1"></i>Novo plano
      </button>
    </div>

    <!-- Form -->
    <div v-if="showForm" class="card border-primary mb-3">
      <div class="card-body">
        <h6 class="card-title">{{ editingId ? 'Editar plano' : 'Criar plano' }}</h6>

        <div class="row g-3">
          <div class="col-md-6">
            <label class="form-label">Nome do plano</label>
            <input v-model="form.name" class="form-control" placeholder="Ex: Básico, Pro, Enterprise" />
          </div>
          <div class="col-md-6">
            <label class="form-label">Preço padrão (R$)</label>
            <input v-model.number="form.price" type="number" step="0.01" class="form-control" />
            <small class="text-muted">Usado se não houver preços por período</small>
          </div>
        </div>

        <!-- Preços por período -->
        <div class="mt-3">
          <label class="form-label">Preços por período</label>
          <div v-for="(pr, idx) in form.prices" :key="idx" class="d-flex gap-2 mb-2 align-items-center">
            <select v-model="pr.period" class="form-select" style="max-width: 160px;">
              <option v-for="opt in PERIOD_OPTIONS" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
            </select>
            <div class="input-group" style="max-width: 200px;">
              <span class="input-group-text">R$</span>
              <input v-model.number="pr.price" type="number" step="0.01" class="form-control" />
            </div>
            <button class="btn btn-outline-danger btn-sm" @click.prevent="form.prices.splice(idx,1)">
              <i class="bi bi-x-lg"></i>
            </button>
          </div>
          <button class="btn btn-sm btn-outline-primary" @click.prevent="form.prices.push({ period: 'MONTHLY', price: 0 })">
            <i class="bi bi-plus me-1"></i>Adicionar período
          </button>
        </div>

        <!-- Limites -->
        <div class="row g-3 mt-2">
          <div class="col-md-3">
            <label class="form-label">Limite de cardápios</label>
            <input v-model.number="form.menuLimit" type="number" min="0" class="form-control" :disabled="form.unlimitedMenus" />
          </div>
          <div class="col-md-3">
            <label class="form-label">Limite de lojas</label>
            <input v-model.number="form.storeLimit" type="number" min="0" class="form-control" :disabled="form.unlimitedStores" />
          </div>
          <div class="col-md-6 d-flex align-items-end gap-3">
            <div class="form-check">
              <input class="form-check-input" type="checkbox" v-model="form.unlimitedMenus" id="chkMenus" />
              <label class="form-check-label" for="chkMenus">Cardápios ilimitados</label>
            </div>
            <div class="form-check">
              <input class="form-check-input" type="checkbox" v-model="form.unlimitedStores" id="chkStores" />
              <label class="form-check-label" for="chkStores">Lojas ilimitadas</label>
            </div>
          </div>
        </div>

        <!-- Créditos de IA -->
        <div class="row g-3 mt-2">
          <div class="col-md-3">
            <label class="form-label">Créditos de IA / mês</label>
            <input v-model.number="form.aiCreditsMonthlyLimit" type="number" min="0" class="form-control" :disabled="form.unlimitedAiCredits" />
          </div>
          <div class="col-md-6 d-flex align-items-end">
            <div class="form-check">
              <input class="form-check-input" type="checkbox" v-model="form.unlimitedAiCredits" id="chkAiCredits" />
              <label class="form-check-label" for="chkAiCredits">Créditos IA ilimitados</label>
            </div>
          </div>
        </div>

        <!-- Módulos -->
        <div class="mt-3">
          <label class="form-label">Módulos incluídos</label>
          <div v-if="modules.length === 0" class="text-muted small">
            Nenhum módulo cadastrado. <router-link to="/saas/modules">Criar módulos</router-link>
          </div>
          <div v-else class="d-flex flex-wrap gap-2">
            <label
              v-for="m in modules" :key="m.id"
              class="module-chip d-flex align-items-center gap-2 border rounded-pill px-3 py-2 mb-0 user-select-none"
              :class="form.moduleIds.includes(m.id) ? `border-${keyMeta(m.key).color} bg-${keyMeta(m.key).color} bg-opacity-10` : 'border-secondary-subtle'"
              style="cursor: pointer;"
            >
              <input class="form-check-input mt-0" type="checkbox" :value="m.id" v-model="form.moduleIds" />
              <i class="bi" :class="keyMeta(m.key).icon"></i>
              <span class="small fw-medium">{{ m.name }}</span>
            </label>
          </div>
        </div>

        <div class="mt-3 d-flex gap-2">
          <button class="btn btn-primary" @click="savePlan">
            <i class="bi bi-check-lg me-1"></i>{{ editingId ? 'Salvar' : 'Criar' }}
          </button>
          <button class="btn btn-outline-secondary" @click="cancelForm">Cancelar</button>
        </div>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="text-center py-5">
      <div class="spinner-border text-primary"></div>
    </div>

    <!-- Plans list -->
    <div v-else-if="plans.length === 0 && !showForm" class="text-center py-5 text-muted">
      <i class="bi bi-list-check" style="font-size: 3rem;"></i>
      <p class="mt-2">Nenhum plano cadastrado.</p>
      <button class="btn btn-primary" @click="openCreate">Criar primeiro plano</button>
    </div>

    <div v-else class="row g-3">
      <div v-for="p in plans" :key="p.id" class="col-md-6 col-lg-4">
        <div class="card h-100">
          <div class="card-body d-flex flex-column">
            <div class="d-flex justify-content-between align-items-start mb-2">
              <h5 class="card-title mb-0">{{ p.name }}</h5>
              <span class="h5 mb-0 text-primary">R$ {{ Number(p.price).toFixed(2) }}</span>
            </div>

            <!-- Limites -->
            <div class="d-flex gap-3 mb-2 small text-muted flex-wrap">
              <span><i class="bi bi-journal-text me-1"></i>Cardápios: {{ p.unlimitedMenus ? 'Ilimitado' : (p.menuLimit ?? '—') }}</span>
              <span><i class="bi bi-shop me-1"></i>Lojas: {{ p.unlimitedStores ? 'Ilimitado' : (p.storeLimit ?? '—') }}</span>
              <span><i class="bi bi-stars me-1"></i>IA: {{ p.unlimitedAiCredits ? 'Ilimitado' : ((p.aiCreditsMonthlyLimit ?? 100) + ' créditos/mês') }}</span>
            </div>

            <!-- Preços por período -->
            <div v-if="p.prices && p.prices.length" class="mb-2">
              <span v-for="pr in p.prices" :key="pr.id" class="badge bg-info text-dark me-1">
                {{ periodLabel(pr.period) }}: R$ {{ Number(pr.price).toFixed(2) }}
              </span>
            </div>

            <!-- Módulos -->
            <div class="mb-3 flex-grow-1">
              <div class="small text-muted mb-1">Módulos:</div>
              <span v-if="!p.modules || p.modules.length === 0" class="small text-muted">Nenhum</span>
              <span v-for="pm in p.modules" :key="pm.moduleId" class="badge me-1" :class="`bg-${keyMeta(pm.module?.key).color}`">
                <i class="bi me-1" :class="keyMeta(pm.module?.key).icon"></i>{{ pm.module?.name || pm.moduleId }}
              </span>
            </div>

            <div class="d-flex gap-2 mt-auto">
              <button class="btn btn-sm btn-outline-secondary flex-fill" @click="openEdit(p)">
                <i class="bi bi-pencil me-1"></i>Editar
              </button>
              <button class="btn btn-sm btn-outline-danger" @click="deletePlan(p)">
                <i class="bi bi-trash"></i>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
