<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import api from '../api'
import Swal from 'sweetalert2'

const router = useRouter()
const companies = ref([])
const plans = ref([])
const loading = ref(true)
const search = ref('')

// Module management modal
const showModulesModal = ref(false)
const modulesCompany = ref(null)
const allModules = ref([])
const companySubs = ref([])
const companyPlanModuleKeys = ref([])
const modulesLoading = ref(false)
const selectedModuleId = ref('')
const selectedPeriod = ref('MONTHLY')
const activating = ref(false)

async function openModulesModal(c) {
  modulesCompany.value = c
  showModulesModal.value = true
  modulesLoading.value = true
  try {
    const [modsRes, subsRes] = await Promise.all([
      api.get('/saas/modules'),
      api.get(`/saas/module-subscriptions/admin/${c.id}`)
    ])
    allModules.value = (modsRes.data || []).filter(m => m.isActive)
    companySubs.value = subsRes.data || []

    // Get plan modules if company has a subscription
    if (c.saasSubscription?.plan?.id) {
      const planRes = await api.get('/saas/plans')
      const plan = (planRes.data || []).find(p => p.id === c.saasSubscription.plan.id)
      companyPlanModuleKeys.value = (plan?.modules || []).map(pm => pm.module?.key).filter(Boolean)
    } else {
      companyPlanModuleKeys.value = []
    }
  } catch (e) {
    Swal.fire({ icon: 'error', text: 'Erro ao carregar módulos' })
  } finally {
    modulesLoading.value = false
  }
}

function closeModulesModal() {
  showModulesModal.value = false
  modulesCompany.value = null
  companySubs.value = []
  selectedModuleId.value = ''
}

const availableModules = computed(() => {
  const activeSubModuleIds = companySubs.value
    .filter(s => s.status === 'ACTIVE')
    .map(s => s.moduleId)
  return allModules.value.filter(m =>
    !activeSubModuleIds.includes(m.id) &&
    !companyPlanModuleKeys.value.includes(m.key)
  )
})

const activeSubs = computed(() => companySubs.value.filter(s => s.status === 'ACTIVE'))

const planModules = computed(() =>
  allModules.value.filter(m => companyPlanModuleKeys.value.includes(m.key))
)

async function activateModule() {
  if (!selectedModuleId.value || !modulesCompany.value) return
  activating.value = true
  try {
    await api.post('/saas/module-subscriptions/assign', {
      companyId: modulesCompany.value.id,
      moduleId: selectedModuleId.value,
      period: selectedPeriod.value
    })
    const subsRes = await api.get(`/saas/module-subscriptions/admin/${modulesCompany.value.id}`)
    companySubs.value = subsRes.data || []
    selectedModuleId.value = ''
    Swal.fire({ icon: 'success', text: 'Módulo ativado', timer: 1500, showConfirmButton: false })
  } catch (e) {
    Swal.fire({ icon: 'error', text: e?.response?.data?.message || 'Erro ao ativar módulo' })
  } finally {
    activating.value = false
  }
}

async function cancelModule(sub) {
  const result = await Swal.fire({
    title: `Remover "${sub.module?.name || 'módulo'}"?`,
    text: 'O módulo será desativado para esta empresa.',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#dc3545',
    confirmButtonText: 'Sim, remover',
    cancelButtonText: 'Cancelar'
  })
  if (!result.isConfirmed) return
  try {
    await api.delete(`/saas/module-subscriptions/assign/${modulesCompany.value.id}/${sub.moduleId}`)
    const subsRes = await api.get(`/saas/module-subscriptions/admin/${modulesCompany.value.id}`)
    companySubs.value = subsRes.data || []
    Swal.fire({ icon: 'success', text: 'Módulo removido', timer: 1500, showConfirmButton: false })
  } catch (e) {
    Swal.fire({ icon: 'error', text: e?.response?.data?.message || 'Erro ao remover módulo' })
  }
}

function periodLabel(p) {
  const map = { MONTHLY: 'Mensal', ANNUAL: 'Anual', BIMONTHLY: 'Bimestral', QUARTERLY: 'Trimestral' }
  return map[p] || p
}

async function load() {
  loading.value = true
  try {
    const [cRes, pRes] = await Promise.all([
      api.get('/saas/companies'),
      api.get('/saas/plans')
    ])
    companies.value = cRes.data || []
    plans.value = pRes.data || []
  } finally { loading.value = false }
}

onMounted(load)

const filtered = computed(() => {
  if (!search.value) return companies.value
  const q = search.value.toLowerCase()
  return companies.value.filter(c =>
    c.name.toLowerCase().includes(q) ||
    (c.slug || '').toLowerCase().includes(q) ||
    (c.saasSubscription?.plan?.name || '').toLowerCase().includes(q)
  )
})

function subStatus(c) {
  if (!c.saasSubscription) return { label: 'Sem plano', cls: 'bg-secondary' }
  const s = c.saasSubscription.status
  if (s === 'ACTIVE') return { label: 'Ativo', cls: 'bg-success' }
  if (s === 'SUSPENDED') return { label: 'Suspenso', cls: 'bg-warning text-dark' }
  if (s === 'CANCELLED') return { label: 'Cancelado', cls: 'bg-danger' }
  return { label: s, cls: 'bg-secondary' }
}

function editCompany(c) {
  router.push(`/saas/companies/${c.id}/edit`)
}

async function toggleSuspend(c) {
  const isSuspended = c.saasSubscription?.status === 'SUSPENDED'
  const action = isSuspended ? 'reativar' : 'suspender'
  const result = await Swal.fire({
    title: `${isSuspended ? 'Reativar' : 'Suspender'} "${c.name}"?`,
    text: isSuspended
      ? 'A empresa terá os acessos restaurados.'
      : 'Ao suspender, lojas serão desativadas e acessos limitados.',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: isSuspended ? '#198754' : '#ffc107',
    confirmButtonText: `Sim, ${action}`,
    cancelButtonText: 'Cancelar'
  })
  if (!result.isConfirmed) return
  try {
    await api.post(`/saas/companies/${c.id}/suspend`, { suspend: !isSuspended })
    await load()
    Swal.fire({ icon: 'success', title: isSuspended ? 'Reativada' : 'Suspensa', timer: 1500, showConfirmButton: false })
  } catch (e) {
    Swal.fire({ icon: 'error', title: 'Erro', text: e?.response?.data?.message || `Falha ao ${action}` })
  }
}

async function deleteCompany(c) {
  const result = await Swal.fire({
    title: `Excluir "${c.name}"?`,
    text: 'A empresa será desativada (soft-delete). Assinaturas serão canceladas e lojas desativadas.',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#dc3545',
    confirmButtonText: 'Sim, excluir',
    cancelButtonText: 'Cancelar'
  })
  if (!result.isConfirmed) return
  try {
    await api.delete(`/saas/companies/${c.id}`)
    await load()
    Swal.fire({ icon: 'success', title: 'Empresa removida', timer: 1500, showConfirmButton: false })
  } catch (e) {
    Swal.fire({ icon: 'error', title: 'Erro', text: e?.response?.data?.message || 'Falha ao excluir' })
  }
}

async function changePassword(c) {
  const res = await Swal.fire({
    title: `Trocar senha — ${c.name}`,
    html: `
      <input id="swal-pw" type="password" class="swal2-input" placeholder="Nova senha">
      <input id="swal-pw2" type="password" class="swal2-input" placeholder="Confirmar senha">
    `,
    focusConfirm: false,
    showCancelButton: true,
    confirmButtonText: 'Atualizar',
    cancelButtonText: 'Cancelar',
    preConfirm: () => {
      const pw = document.getElementById('swal-pw')?.value || ''
      const pw2 = document.getElementById('swal-pw2')?.value || ''
      if (!pw) { Swal.showValidationMessage('Senha obrigatória'); return false }
      if (pw.length < 6) { Swal.showValidationMessage('Senha deve ter ao menos 6 caracteres'); return false }
      if (pw !== pw2) { Swal.showValidationMessage('Senhas não coincidem'); return false }
      return { password: pw }
    }
  })
  if (!res?.isConfirmed) return
  try {
    await api.post(`/saas/companies/${c.id}/password`, { password: res.value.password })
    Swal.fire({ icon: 'success', title: 'Senha atualizada', timer: 1500, showConfirmButton: false })
  } catch (e) {
    Swal.fire({ icon: 'error', title: 'Erro', text: 'Falha ao atualizar senha.' })
  }
}

async function resetTrial(c) {
  const result = await Swal.fire({
    title: `Resetar trial de "${c.name}"?`,
    text: 'O trial atual será cancelado (se ativo) e a empresa poderá ativar novamente.',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#dc3545',
    confirmButtonText: 'Sim, resetar',
    cancelButtonText: 'Cancelar'
  })
  if (!result.isConfirmed) return
  try {
    await api.post(`/saas/companies/${c.id}/reset-trial`)
    await load()
    Swal.fire({ icon: 'success', title: 'Trial resetado', timer: 1500, showConfirmButton: false })
  } catch (e) {
    Swal.fire({ icon: 'error', title: 'Erro', text: e?.response?.data?.message || 'Falha ao resetar trial' })
  }
}
</script>

<template>
  <div class="container py-3">
    <div class="d-flex justify-content-between align-items-center mb-3">
      <div>
        <h2 class="mb-0">Empresas</h2>
        <small class="text-muted">Gerencie os clientes do SaaS e suas assinaturas</small>
      </div>
      <router-link class="btn btn-primary" to="/saas/companies/new">
        <i class="bi bi-plus-lg me-1"></i>Nova empresa
      </router-link>
    </div>

    <!-- Stats -->
    <div class="row g-3 mb-3">
      <div class="col-sm-4">
        <div class="card text-center">
          <div class="card-body py-2">
            <div class="h4 mb-0 text-primary">{{ companies.length }}</div>
            <small class="text-muted">Total</small>
          </div>
        </div>
      </div>
      <div class="col-sm-4">
        <div class="card text-center">
          <div class="card-body py-2">
            <div class="h4 mb-0 text-success">{{ companies.filter(c => c.saasSubscription?.status === 'ACTIVE').length }}</div>
            <small class="text-muted">Ativas</small>
          </div>
        </div>
      </div>
      <div class="col-sm-4">
        <div class="card text-center">
          <div class="card-body py-2">
            <div class="h4 mb-0 text-warning">{{ companies.filter(c => !c.saasSubscription || c.saasSubscription.status !== 'ACTIVE').length }}</div>
            <small class="text-muted">Sem plano / Inativas</small>
          </div>
        </div>
      </div>
    </div>

    <!-- Search -->
    <div class="mb-3">
      <input v-model="search" class="form-control" placeholder="Buscar por nome, slug ou plano..." />
    </div>

    <!-- Loading -->
    <div v-if="loading" class="text-center py-5">
      <div class="spinner-border text-primary"></div>
    </div>

    <!-- Empty -->
    <div v-else-if="companies.length === 0" class="text-center py-5 text-muted">
      <i class="bi bi-building" style="font-size: 3rem;"></i>
      <p class="mt-2">Nenhuma empresa cadastrada.</p>
      <router-link class="btn btn-primary" to="/saas/companies/new">Criar primeira empresa</router-link>
    </div>

    <!-- Table -->
    <div v-else class="card">
      <div class="table-responsive">
        <table class="table table-hover align-middle mb-0">
          <thead class="table-light">
            <tr>
              <th>Empresa</th>
              <th>Plano</th>
              <th>Status</th>
              <th class="text-center">Lojas</th>
              <th class="text-center">Usuários</th>
              <th>Criada em</th>
              <th class="text-end">Ações</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in filtered" :key="c.id">
              <td>
                <div class="fw-semibold">{{ c.name }}</div>
                <small class="text-muted" v-if="c.slug">{{ c.slug }}</small>
              </td>
              <td>
                <span v-if="c.saasSubscription?.plan" class="fw-medium">{{ c.saasSubscription.plan.name }}</span>
                <span v-else class="text-muted">—</span>
                <div v-if="c.companyTrials && c.companyTrials.length > 0" class="mt-1">
                  <span class="badge bg-warning text-dark">
                    <i class="bi bi-clock-history me-1"></i>Trial
                    ({{ Math.max(0, Math.ceil((new Date(c.companyTrials[0].expiresAt) - new Date()) / 86400000)) }}d restantes)
                  </span>
                </div>
              </td>
              <td>
                <span class="badge" :class="subStatus(c).cls">{{ subStatus(c).label }}</span>
              </td>
              <td class="text-center">{{ c._count?.stores ?? '—' }}</td>
              <td class="text-center">{{ c._count?.users ?? '—' }}</td>
              <td>
                <small>{{ new Date(c.createdAt).toLocaleDateString('pt-BR') }}</small>
              </td>
              <td class="text-end">
                <div class="btn-group btn-group-sm">
                  <button class="btn btn-outline-secondary" @click="editCompany(c)" title="Editar">
                    <i class="bi bi-pencil"></i>
                  </button>
                  <button class="btn btn-outline-primary" @click="openModulesModal(c)" title="Módulos">
                    <i class="bi bi-puzzle"></i>
                  </button>
                  <button class="btn btn-outline-secondary" @click="changePassword(c)" title="Trocar senha">
                    <i class="bi bi-key"></i>
                  </button>
                  <button
                    class="btn"
                    :class="c.saasSubscription?.status === 'SUSPENDED' ? 'btn-outline-success' : 'btn-outline-warning'"
                    @click="toggleSuspend(c)"
                    :title="c.saasSubscription?.status === 'SUSPENDED' ? 'Reativar' : 'Suspender'"
                  >
                    <i class="bi" :class="c.saasSubscription?.status === 'SUSPENDED' ? 'bi-play-circle' : 'bi-pause-circle'"></i>
                  </button>
                  <button class="btn btn-outline-info" @click="resetTrial(c)" title="Resetar Trial">
                    <i class="bi bi-arrow-counterclockwise"></i>
                  </button>
                  <button class="btn btn-outline-danger" @click="deleteCompany(c)" title="Excluir">
                    <i class="bi bi-trash"></i>
                  </button>
                </div>
              </td>
            </tr>
            <tr v-if="filtered.length === 0">
              <td colspan="7" class="text-center text-muted py-3">Nenhuma empresa encontrada para "{{ search }}"</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
    <!-- Modal Módulos -->
    <Teleport to="body">
      <div v-if="showModulesModal" class="modal d-block" tabindex="-1" style="background: rgba(0,0,0,0.5);" @click.self="closeModulesModal">
        <div class="modal-dialog modal-lg modal-dialog-centered">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title">
                <i class="bi bi-puzzle me-2"></i>Módulos — {{ modulesCompany?.name }}
              </h5>
              <button type="button" class="btn-close" @click="closeModulesModal"></button>
            </div>
            <div class="modal-body">
              <div v-if="modulesLoading" class="text-center py-4">
                <div class="spinner-border text-primary"></div>
              </div>
              <template v-else>
                <!-- Ativar módulo -->
                <div class="card mb-3">
                  <div class="card-body">
                    <h6 class="mb-3"><i class="bi bi-plus-circle me-1"></i>Ativar módulo</h6>
                    <div class="row g-2 align-items-end">
                      <div class="col-sm-5">
                        <label class="form-label small text-muted">Módulo</label>
                        <select v-model="selectedModuleId" class="form-select form-select-sm">
                          <option value="">Selecione um módulo...</option>
                          <option v-for="m in availableModules" :key="m.id" :value="m.id">{{ m.name }}</option>
                        </select>
                      </div>
                      <div class="col-sm-4">
                        <label class="form-label small text-muted">Período</label>
                        <select v-model="selectedPeriod" class="form-select form-select-sm">
                          <option value="MONTHLY">Mensal</option>
                          <option value="ANNUAL">Anual</option>
                        </select>
                      </div>
                      <div class="col-sm-3">
                        <button
                          class="btn btn-primary btn-sm w-100"
                          :disabled="!selectedModuleId || activating"
                          @click="activateModule"
                        >
                          <span v-if="activating" class="spinner-border spinner-border-sm me-1"></span>
                          <i v-else class="bi bi-check-lg me-1"></i>Ativar
                        </button>
                      </div>
                    </div>
                    <div v-if="availableModules.length === 0" class="text-muted small mt-2">
                      <i class="bi bi-info-circle me-1"></i>Todos os módulos já estão ativos ou incluídos no plano.
                    </div>
                  </div>
                </div>

                <!-- Módulos incluídos no plano -->
                <div v-if="planModules.length" class="mb-3">
                  <h6 class="text-muted mb-2"><i class="bi bi-box-seam me-1"></i>Incluídos no plano</h6>
                  <div class="d-flex flex-wrap gap-2">
                    <span v-for="m in planModules" :key="m.id" class="badge bg-light text-dark border">
                      <i class="bi bi-check-circle-fill text-success me-1"></i>{{ m.name }}
                    </span>
                  </div>
                </div>

                <!-- Módulos avulsos ativos -->
                <h6 class="text-muted mb-2"><i class="bi bi-puzzle me-1"></i>Módulos avulsos</h6>
                <div v-if="activeSubs.length === 0" class="text-muted small">
                  Nenhum módulo avulso ativo.
                </div>
                <div v-else class="table-responsive">
                  <table class="table table-hover align-middle mb-0">
                    <thead>
                      <tr>
                        <th>Módulo</th>
                        <th>Período</th>
                        <th>Início</th>
                        <th>Próx. vencimento</th>
                        <th class="text-end">Ação</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="sub in activeSubs" :key="sub.id">
                        <td class="fw-medium">{{ sub.module?.name || '—' }}</td>
                        <td><span class="badge bg-primary">{{ periodLabel(sub.period) }}</span></td>
                        <td><small>{{ sub.startedAt ? new Date(sub.startedAt).toLocaleDateString('pt-BR') : '—' }}</small></td>
                        <td><small>{{ sub.nextDueAt ? new Date(sub.nextDueAt).toLocaleDateString('pt-BR') : '—' }}</small></td>
                        <td class="text-end">
                          <button class="btn btn-outline-danger btn-sm" @click="cancelModule(sub)" title="Remover">
                            <i class="bi bi-trash"></i>
                          </button>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </template>
            </div>
            <div class="modal-footer">
              <button class="btn btn-outline-secondary btn-sm" @click="closeModulesModal">Fechar</button>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
