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
  CARDAPIO_SIMPLES:  { label: 'Cardápio Simples (Base)',  icon: 'bi-list',              color: 'primary' },
  CARDAPIO_COMPLETO: { label: 'Cardápio Completo',        icon: 'bi-list-check',        color: 'success' },
  RIDERS:            { label: 'Entregadores',             icon: 'bi-bicycle',           color: 'primary' },
  AFFILIATES:        { label: 'Afiliados',                icon: 'bi-people-fill',       color: 'success' },
  STOCK:             { label: 'Controle de Estoque',      icon: 'bi-box-seam',          color: 'warning' },
  CASHBACK:          { label: 'Cashback',                 icon: 'bi-cash-stack',        color: 'info' },
  COUPONS:           { label: 'Cupons',                   icon: 'bi-ticket-perforated', color: 'danger' },
  WHATSAPP:          { label: 'WhatsApp',                 icon: 'bi-whatsapp',          color: 'success' },
  FINANCIAL:         { label: 'Financeiro',               icon: 'bi-cash-coin',         color: 'warning' },
}
const keyMeta = (key) => MODULE_KEYS[key] || { label: key, icon: 'bi-box', color: 'secondary' }

// --- Plan ---
const plan = ref(null)
const plans = ref([])
const loading = ref(true)
const showPlanForm = ref(false)
const editingPlanId = ref(null)

const emptyPlanForm = () => ({ name: '', price: 0, menuLimit: null, storeLimit: null, unlimitedMenus: false, unlimitedStores: false, aiCreditsMonthlyLimit: 100, unlimitedAiCredits: false, prices: [] })
const planForm = ref(emptyPlanForm())

// --- Modules ---
const modules = ref([])

// --- Credit Packs ---
const creditPacks = ref([])
const showPackForm = ref(false)
const editingPackId = ref(null)
const emptyPackForm = () => ({ name: '', credits: 0, price: 0, isActive: true, sortOrder: 0 })
const packForm = ref(emptyPackForm())

async function loadAll() {
  loading.value = true
  try {
    const [modsRes, plansRes, packsRes] = await Promise.all([
      api.get('/saas/modules'),
      api.get('/saas/plans'),
      api.get('/saas/credit-packs')
    ])
    modules.value = modsRes.data || []
    plans.value = plansRes.data || []
    creditPacks.value = packsRes.data || []
    // Pick the default/system plan (or the first one)
    plan.value = plans.value.find(p => p.isDefault || p.isSystem) || plans.value[0] || null
  } finally { loading.value = false }
}

onMounted(() => {
  loadAll()
  loadMpConfig()
})

// --- Plan editing ---
function openEditPlan(p) {
  editingPlanId.value = p.id
  planForm.value = {
    name: p.name,
    price: Number(p.price || 0),
    menuLimit: p.menuLimit,
    storeLimit: p.storeLimit,
    unlimitedMenus: p.unlimitedMenus || false,
    unlimitedStores: p.unlimitedStores || false,
    aiCreditsMonthlyLimit: p.aiCreditsMonthlyLimit ?? 100,
    unlimitedAiCredits: p.unlimitedAiCredits || false,
    prices: (p.prices || []).map(pr => ({ period: pr.period, price: String(Number(pr.price || 0)) }))
  }
  showPlanForm.value = true
}

function cancelPlanForm() {
  showPlanForm.value = false
  editingPlanId.value = null
}

async function savePlan() {
  if (!planForm.value.name) return
  const payload = { ...planForm.value, price: Number(planForm.value.price || 0) }
  if (Array.isArray(payload.prices)) payload.prices = payload.prices.map(p => ({ period: p.period, price: String(Number(p.price || 0)) }))
  // Remove moduleIds — modules are now individual subscriptions
  delete payload.moduleIds
  try {
    if (editingPlanId.value) {
      await api.put(`/saas/plans/${editingPlanId.value}`, payload)
    } else {
      await api.post('/saas/plans', payload)
    }
    showPlanForm.value = false
    editingPlanId.value = null
    await loadAll()
  } catch (e) {
    Swal.fire({ icon: 'error', title: 'Erro', text: e?.response?.data?.message || 'Falha ao salvar' })
  }
}

// --- Module Pricing ---
async function saveModulePrices(mod) {
  try {
    await api.put(`/saas/modules/${mod.id}`, { prices: mod.prices.map(p => ({ period: p.period, price: String(Number(p.price || 0)) })) })
    Swal.fire({ icon: 'success', title: 'Salvo', text: `Preços de ${mod.name} atualizados`, timer: 1500, showConfirmButton: false })
  } catch (e) {
    Swal.fire({ icon: 'error', title: 'Erro', text: e?.response?.data?.message || 'Falha ao salvar preços' })
  }
}

function addModulePrice(mod) {
  if (!mod.prices) mod.prices = []
  mod.prices.push({ period: 'MONTHLY', price: '0' })
}

function removeModulePrice(mod, idx) {
  mod.prices.splice(idx, 1)
}

// --- Credit Packs CRUD ---
function openCreatePack() {
  editingPackId.value = null
  packForm.value = emptyPackForm()
  showPackForm.value = true
}

function openEditPack(pack) {
  editingPackId.value = pack.id
  packForm.value = {
    name: pack.name,
    credits: pack.credits,
    price: Number(pack.price || 0),
    isActive: pack.isActive !== false,
    sortOrder: pack.sortOrder || 0
  }
  showPackForm.value = true
}

function cancelPackForm() {
  showPackForm.value = false
  editingPackId.value = null
}

async function savePack() {
  if (!packForm.value.name) return
  const payload = { ...packForm.value, price: Number(packForm.value.price || 0), credits: Number(packForm.value.credits || 0) }
  try {
    if (editingPackId.value) {
      await api.put(`/saas/credit-packs/${editingPackId.value}`, payload)
    } else {
      await api.post('/saas/credit-packs', payload)
    }
    showPackForm.value = false
    editingPackId.value = null
    await loadAll()
  } catch (e) {
    Swal.fire({ icon: 'error', title: 'Erro', text: e?.response?.data?.message || 'Falha ao salvar pacote' })
  }
}

async function deletePack(pack) {
  const result = await Swal.fire({
    title: `Remover "${pack.name}"?`,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#dc3545',
    confirmButtonText: 'Sim, remover',
    cancelButtonText: 'Cancelar'
  })
  if (!result.isConfirmed) return
  try {
    await api.delete(`/saas/credit-packs/${pack.id}`)
    await loadAll()
  } catch (e) { console.warn('Failed to delete pack', e) }
}

function periodLabel(v) {
  const opt = PERIOD_OPTIONS.find(o => o.value === v)
  return opt ? opt.label : v
}

// ---- Split Info ----
const PERIOD_MONTHS = { MONTHLY: 1, BIMONTHLY: 2, QUARTERLY: 3, ANNUAL: 12 }

function splitInfo(price, monthlyFee, period) {
  if (monthlyFee == null || price == null) return null
  const mFee = Number(monthlyFee)
  if (mFee <= 0) return null
  const months = PERIOD_MONTHS[period] || 1
  const fee = mFee * months
  const total = Number(price)
  const gestor = Math.max(0, total - fee)
  return { total, fee, gestor }
}

// ---- Gateways de Pagamento ----
const activeGateway = ref('mercadopago')
const GATEWAYS = [
  { key: 'mercadopago', label: 'Mercado Pago', icon: 'bi-credit-card' }
  // Futuros gateways podem ser adicionados aqui
]

// ---- Mercado Pago Config ----
const mpConfig = ref(null)
const mpForm = ref({ accessToken: '', publicKey: '', isActive: true })
const mpSaving = ref(false)

async function loadMpConfig() {
  try {
    const { data } = await api.get('/saas/mercadopago-config')
    mpConfig.value = data
    if (data) {
      mpForm.value.publicKey = data.publicKey || ''
      mpForm.value.isActive = data.isActive
    }
  } catch (e) { /* ignore */ }
}

async function saveMpConfig() {
  mpSaving.value = true
  try {
    const payload = {}
    if (mpForm.value.accessToken) payload.accessToken = mpForm.value.accessToken
    payload.publicKey = mpForm.value.publicKey
    payload.isActive = mpForm.value.isActive
    const { data } = await api.put('/saas/mercadopago-config', payload)
    mpConfig.value = data
    mpForm.value.accessToken = ''
    Swal.fire({ icon: 'success', title: 'Salvo', text: 'Configuração do gateway salva com sucesso', timer: 1500, showConfirmButton: false })
  } catch (e) {
    Swal.fire({ icon: 'error', title: 'Erro', text: e?.response?.data?.message || 'Erro ao salvar configuração' })
  } finally {
    mpSaving.value = false
  }
}
</script>

<template>
  <div class="container py-3">
    <div class="mb-3">
      <h2 class="mb-0">Planos e Preços</h2>
      <small class="text-muted">Configure o plano base, preços dos módulos e pacotes de créditos</small>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="text-center py-5">
      <div class="spinner-border text-primary"></div>
    </div>

    <template v-else>
      <!-- ====== SECTION 1: Plan ====== -->
      <div class="card mb-4">
        <div class="card-header d-flex justify-content-between align-items-center">
          <h5 class="mb-0"><i class="bi bi-list-check me-2"></i>Plano Base</h5>
          <button v-if="plan && !showPlanForm" class="btn btn-sm btn-outline-primary" @click="openEditPlan(plan)">
            <i class="bi bi-pencil me-1"></i>Editar
          </button>
        </div>
        <div class="card-body">
          <!-- Plan Form -->
          <div v-if="showPlanForm">
            <div class="row g-3">
              <div class="col-md-6">
                <label class="form-label">Nome do plano</label>
                <input v-model="planForm.name" class="form-control" placeholder="Ex: Básico, Pro, Enterprise" />
              </div>
              <div class="col-md-6">
                <label class="form-label">Preço padrão (R$)</label>
                <input v-model.number="planForm.price" type="number" step="0.01" class="form-control" />
                <small class="text-muted">Usado se não houver preços por período</small>
              </div>
            </div>

            <!-- Preços por período -->
            <div class="mt-3">
              <label class="form-label">Preços por período</label>
              <div v-for="(pr, idx) in planForm.prices" :key="idx" class="d-flex gap-2 mb-2 align-items-center">
                <select v-model="pr.period" class="form-select" style="max-width: 160px;">
                  <option v-for="opt in PERIOD_OPTIONS" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
                </select>
                <div class="input-group" style="max-width: 200px;">
                  <span class="input-group-text">R$</span>
                  <input v-model.number="pr.price" type="number" step="0.01" class="form-control" />
                </div>
                <button class="btn btn-outline-danger btn-sm" @click.prevent="planForm.prices.splice(idx,1)">
                  <i class="bi bi-x-lg"></i>
                </button>
              </div>
              <button class="btn btn-sm btn-outline-primary" @click.prevent="planForm.prices.push({ period: 'MONTHLY', price: 0 })">
                <i class="bi bi-plus me-1"></i>Adicionar período
              </button>
            </div>

            <!-- Limites -->
            <div class="row g-3 mt-2">
              <div class="col-md-3">
                <label class="form-label">Limite de cardápios</label>
                <input v-model.number="planForm.menuLimit" type="number" min="0" class="form-control" :disabled="planForm.unlimitedMenus" />
              </div>
              <div class="col-md-3">
                <label class="form-label">Limite de lojas</label>
                <input v-model.number="planForm.storeLimit" type="number" min="0" class="form-control" :disabled="planForm.unlimitedStores" />
              </div>
              <div class="col-md-6 d-flex align-items-end gap-3">
                <div class="form-check">
                  <input class="form-check-input" type="checkbox" v-model="planForm.unlimitedMenus" id="chkMenus" />
                  <label class="form-check-label" for="chkMenus">Cardápios ilimitados</label>
                </div>
                <div class="form-check">
                  <input class="form-check-input" type="checkbox" v-model="planForm.unlimitedStores" id="chkStores" />
                  <label class="form-check-label" for="chkStores">Lojas ilimitadas</label>
                </div>
              </div>
            </div>

            <!-- Creditos de IA -->
            <div class="row g-3 mt-2">
              <div class="col-md-3">
                <label class="form-label">Créditos de IA / mês</label>
                <input v-model.number="planForm.aiCreditsMonthlyLimit" type="number" min="0" class="form-control" :disabled="planForm.unlimitedAiCredits" />
              </div>
              <div class="col-md-6 d-flex align-items-end">
                <div class="form-check">
                  <input class="form-check-input" type="checkbox" v-model="planForm.unlimitedAiCredits" id="chkAiCredits" />
                  <label class="form-check-label" for="chkAiCredits">Créditos IA ilimitados</label>
                </div>
              </div>
            </div>

            <div class="mt-3 d-flex gap-2">
              <button class="btn btn-primary" @click="savePlan">
                <i class="bi bi-check-lg me-1"></i>Salvar
              </button>
              <button class="btn btn-outline-secondary" @click="cancelPlanForm">Cancelar</button>
            </div>
          </div>

          <!-- Plan display -->
          <div v-else-if="plan">
            <div class="d-flex justify-content-between align-items-start mb-2">
              <h5 class="mb-0">{{ plan.name }}</h5>
              <span class="h5 mb-0 text-primary">R$ {{ Number(plan.price).toFixed(2) }}</span>
            </div>
            <div class="d-flex gap-3 mb-2 small text-muted flex-wrap">
              <span><i class="bi bi-journal-text me-1"></i>Cardápios: {{ plan.unlimitedMenus ? 'Ilimitado' : (plan.menuLimit ?? '--') }}</span>
              <span><i class="bi bi-shop me-1"></i>Lojas: {{ plan.unlimitedStores ? 'Ilimitado' : (plan.storeLimit ?? '--') }}</span>
              <span><i class="bi bi-stars me-1"></i>IA: {{ plan.unlimitedAiCredits ? 'Ilimitado' : ((plan.aiCreditsMonthlyLimit ?? 100) + ' créditos/mês') }}</span>
            </div>
            <div v-if="plan.prices && plan.prices.length" class="mb-2">
              <span v-for="pr in plan.prices" :key="pr.id" class="badge bg-info text-dark me-1">
                {{ periodLabel(pr.period) }}: R$ {{ Number(pr.price).toFixed(2) }}
              </span>
            </div>
          </div>

          <div v-else class="text-center py-3 text-muted">
            <p>Nenhum plano cadastrado.</p>
          </div>
        </div>
      </div>

      <!-- ====== SECTION 2: Module Pricing ====== -->
      <div class="card mb-4">
        <div class="card-header">
          <h5 class="mb-0"><i class="bi bi-box-seam me-2"></i>Preços dos Módulos</h5>
        </div>
        <div class="card-body">
          <p class="text-muted small mb-3">Configure os preços mensal e anual para cada módulo. Empresas podem assinar módulos individualmente.</p>

          <div v-if="modules.length === 0" class="text-muted">Nenhum módulo cadastrado.</div>

          <div v-for="mod in modules" :key="mod.id" class="border rounded p-3 mb-3">
            <div class="d-flex align-items-center justify-content-between mb-2">
              <div class="d-flex align-items-center gap-2">
                <span class="badge" :class="`bg-${keyMeta(mod.key).color}`">
                  <i class="bi" :class="keyMeta(mod.key).icon"></i>
                </span>
                <strong>{{ mod.name }}</strong>
                <small class="text-muted">({{ mod.key }})</small>
              </div>
              <button class="btn btn-sm btn-primary" @click="saveModulePrices(mod)">
                <i class="bi bi-check-lg me-1"></i>Salvar preços
              </button>
            </div>

            <div v-for="(price, idx) in (mod.prices || [])" :key="idx" class="mb-2">
              <div class="d-flex gap-2 align-items-center">
                <select v-model="price.period" class="form-select" style="max-width: 160px;">
                  <option v-for="opt in PERIOD_OPTIONS" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
                </select>
                <div class="input-group" style="max-width: 200px;">
                  <span class="input-group-text">R$</span>
                  <input v-model.number="price.price" type="number" step="0.01" class="form-control" />
                </div>
                <button class="btn btn-outline-danger btn-sm" @click.prevent="removeModulePrice(mod, idx)">
                  <i class="bi bi-x-lg"></i>
                </button>
              </div>
              <!-- Split breakdown -->
              <div v-if="splitInfo(price.price, mod.platformFee, price.period)" class="ms-1 mt-1 small text-muted">
                <i class="bi bi-diagram-3 me-1"></i>
                Split: R$ {{ splitInfo(price.price, mod.platformFee, price.period).fee.toFixed(2) }} plataforma
                &middot; R$ {{ splitInfo(price.price, mod.platformFee, price.period).gestor.toFixed(2) }} para você
              </div>
            </div>

            <button class="btn btn-sm btn-outline-primary" @click.prevent="addModulePrice(mod)">
              <i class="bi bi-plus me-1"></i>Adicionar período
            </button>
          </div>
        </div>
      </div>

      <!-- ====== SECTION 3: Credit Packs ====== -->
      <div class="card mb-4">
        <div class="card-header d-flex justify-content-between align-items-center">
          <h5 class="mb-0"><i class="bi bi-stars me-2"></i>Pacotes de Créditos</h5>
          <button v-if="!showPackForm" class="btn btn-sm btn-primary" @click="openCreatePack">
            <i class="bi bi-plus-lg me-1"></i>Novo pacote
          </button>
        </div>
        <div class="card-body">
          <!-- Pack Form -->
          <div v-if="showPackForm" class="border border-primary rounded p-3 mb-3">
            <h6>{{ editingPackId ? 'Editar pacote' : 'Criar pacote' }}</h6>
            <div class="row g-3">
              <div class="col-md-4">
                <label class="form-label">Nome</label>
                <input v-model="packForm.name" class="form-control" placeholder="Ex: Pacote Starter" />
              </div>
              <div class="col-md-3">
                <label class="form-label">Créditos</label>
                <input v-model.number="packForm.credits" type="number" min="0" class="form-control" />
              </div>
              <div class="col-md-3">
                <label class="form-label">Preço (R$)</label>
                <input v-model.number="packForm.price" type="number" step="0.01" class="form-control" />
              </div>
              <div class="col-md-1">
                <label class="form-label">Ordem</label>
                <input v-model.number="packForm.sortOrder" type="number" class="form-control" />
              </div>
              <div class="col-md-1 d-flex align-items-end">
                <div class="form-check">
                  <input class="form-check-input" type="checkbox" v-model="packForm.isActive" id="chkPackActive" />
                  <label class="form-check-label" for="chkPackActive">Ativo</label>
                </div>
              </div>
            </div>
            <div class="mt-3 d-flex gap-2">
              <button class="btn btn-primary" @click="savePack">
                <i class="bi bi-check-lg me-1"></i>{{ editingPackId ? 'Salvar' : 'Criar' }}
              </button>
              <button class="btn btn-outline-secondary" @click="cancelPackForm">Cancelar</button>
            </div>
          </div>

          <!-- Pack list -->
          <div v-if="creditPacks.length === 0 && !showPackForm" class="text-muted text-center py-3">
            Nenhum pacote de créditos cadastrado.
          </div>
          <table v-else-if="creditPacks.length" class="table table-sm">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Créditos</th>
                <th>Preço</th>
                <th>Split</th>
                <th>Ordem</th>
                <th>Ativo</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="pack in creditPacks" :key="pack.id">
                <td>{{ pack.name }}</td>
                <td>{{ pack.credits }}</td>
                <td>R$ {{ Number(pack.price).toFixed(2) }}</td>
                <td>
                  <template v-if="splitInfo(pack.price, pack.platformFee, 'MONTHLY')">
                    <small class="text-muted d-block">Plataforma: R$ {{ splitInfo(pack.price, pack.platformFee, 'MONTHLY').fee.toFixed(2) }}</small>
                    <small class="text-success fw-semibold">Você: R$ {{ splitInfo(pack.price, pack.platformFee, 'MONTHLY').gestor.toFixed(2) }}</small>
                  </template>
                  <small v-else class="text-muted">—</small>
                </td>
                <td>{{ pack.sortOrder }}</td>
                <td>
                  <span :class="pack.isActive ? 'badge bg-success' : 'badge bg-secondary'">{{ pack.isActive ? 'Sim' : 'Não' }}</span>
                </td>
                <td>
                  <button class="btn btn-sm btn-outline-secondary me-1" @click="openEditPack(pack)">
                    <i class="bi bi-pencil"></i>
                  </button>
                  <button class="btn btn-sm btn-outline-danger" @click="deletePack(pack)">
                    <i class="bi bi-trash"></i>
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <!-- ====== SECTION 4: Gateways de Pagamento ====== -->
      <div class="card mt-4">
        <div class="card-header">
          <h5 class="mb-0"><i class="bi bi-credit-card me-2"></i>Gateways de Pagamento</h5>
        </div>
        <div class="card-body">
          <!-- Gateway tabs -->
          <ul class="nav nav-tabs mb-3">
            <li v-for="gw in GATEWAYS" :key="gw.key" class="nav-item">
              <button
                class="nav-link d-flex align-items-center gap-1"
                :class="{ active: activeGateway === gw.key }"
                @click="activeGateway = gw.key"
              >
                <i class="bi" :class="gw.icon"></i>
                {{ gw.label }}
                <span v-if="gw.key === 'mercadopago' && mpConfig?.hasAccessToken" class="badge bg-success ms-1">Ativo</span>
                <span v-else-if="gw.key === 'mercadopago'" class="badge bg-secondary ms-1">Inativo</span>
              </button>
            </li>
          </ul>

          <!-- Mercado Pago Config -->
          <div v-if="activeGateway === 'mercadopago'">
            <p class="text-muted small mb-3">Configure suas credenciais do Mercado Pago para receber pagamentos. O split da plataforma é aplicado automaticamente em cada transação.</p>
            <div class="row g-3">
              <div class="col-md-6">
                <label class="form-label">Access Token</label>
                <input type="password" class="form-control" v-model="mpForm.accessToken" placeholder="Deixe vazio para manter o atual" />
                <small class="text-muted">Token de acesso do Mercado Pago (produção)</small>
              </div>
              <div class="col-md-6">
                <label class="form-label">Public Key</label>
                <input type="text" class="form-control" v-model="mpForm.publicKey" />
              </div>
            </div>
            <div class="form-check form-switch mt-3 mb-3">
              <input class="form-check-input" type="checkbox" v-model="mpForm.isActive" id="mpActive" />
              <label class="form-check-label" for="mpActive">Gateway ativo</label>
            </div>
            <button class="btn btn-primary" :disabled="mpSaving" @click="saveMpConfig">
              <span v-if="mpSaving" class="spinner-border spinner-border-sm me-1"></span>
              Salvar configuração
            </button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
