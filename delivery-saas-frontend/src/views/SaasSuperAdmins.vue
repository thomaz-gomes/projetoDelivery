<template>
  <div class="container py-4">
    <h4 class="mb-4"><i class="bi bi-shield-lock me-2"></i>Gerenciar Super Admins</h4>

    <!-- Create form -->
    <div class="card mb-4">
      <div class="card-header d-flex justify-content-between align-items-center">
        <strong>Novo Super Admin</strong>
      </div>
      <div class="card-body">
        <form @submit.prevent="create" class="row g-3 align-items-end">
          <div class="col-md-3">
            <TextInput v-model="form.name" label="Nome" placeholder="Nome completo" required />
          </div>
          <div class="col-md-3">
            <TextInput v-model="form.email" type="email" label="Email" placeholder="email@exemplo.com" required />
          </div>
          <div class="col-md-3">
            <TextInput v-model="form.password" type="password" label="Senha" placeholder="Senha" required />
          </div>
          <div class="col-md-3">
            <button class="btn btn-primary w-100" :disabled="creating">
              <i class="bi bi-plus me-1"></i>{{ creating ? 'Criando...' : 'Criar' }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- List -->
    <div class="card">
      <div class="card-header"><strong>Super Admins cadastrados</strong></div>
      <div class="card-body p-0">
        <div v-if="loading" class="text-center py-4 text-muted">Carregando...</div>
        <div v-else-if="admins.length === 0" class="text-center py-4 text-muted">Nenhum super admin cadastrado.</div>
        <div v-else class="table-responsive">
          <table class="table table-hover align-middle mb-0">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Email</th>
                <th>Criado em</th>
                <th class="text-end">Acao</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="a in admins" :key="a.id">
                <td>{{ a.name }}</td>
                <td>{{ a.email }}</td>
                <td>{{ formatDate(a.createdAt) }}</td>
                <td class="text-end">
                  <button class="btn btn-sm btn-outline-danger" @click="remove(a)" :disabled="removing === a.id">
                    <i class="bi bi-trash me-1"></i>{{ removing === a.id ? 'Removendo...' : 'Remover' }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- AI Credits per Company -->
    <h4 class="mt-5 mb-4"><i class="bi bi-stars me-2"></i>Creditos de IA por Empresa</h4>
    <div class="card">
      <div class="card-header d-flex justify-content-between align-items-center">
        <strong>Empresas</strong>
        <TextInput v-model="companySearch" placeholder="Buscar empresa..." class="ms-auto" style="max-width: 280px" />
      </div>
      <div class="card-body p-0">
        <div v-if="companiesLoading" class="text-center py-4 text-muted">Carregando...</div>
        <div v-else class="table-responsive">
          <table class="table table-hover align-middle mb-0">
            <thead>
              <tr>
                <th>Empresa</th>
                <th>Plano</th>
                <th>Saldo</th>
                <th>Limite mensal</th>
                <th>Ilimitado</th>
                <th class="text-end">Acoes</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in filteredCompanies" :key="c.id">
                <td>{{ c.name }}</td>
                <td>
                  <span class="badge bg-light text-dark">{{ c.saasSubscription?.plan?.name || 'Sem plano' }}</span>
                </td>
                <td>
                  <strong>{{ c.aiCreditsBalance }}</strong>
                </td>
                <td>{{ c.saasSubscription?.plan?.aiCreditsMonthlyLimit ?? '-' }}</td>
                <td>
                  <span v-if="c.saasSubscription?.plan?.unlimitedAiCredits" class="badge bg-success">Sim</span>
                  <span v-else class="badge bg-secondary">Nao</span>
                </td>
                <td class="text-end">
                  <button class="btn btn-sm btn-outline-primary" @click="openCreditsModal(c)">
                    <i class="bi bi-pencil me-1"></i>Editar
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Credits Modal -->
    <div v-if="creditsModal" class="modal d-block" tabindex="-1" style="background: rgba(0,0,0,0.4)">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">Creditos de IA - {{ creditsCompany?.name }}</h5>
            <button type="button" class="btn-close" @click="creditsModal = false"></button>
          </div>
          <div class="modal-body">
            <div class="mb-3">
              <div class="form-check form-switch mb-3">
                <input class="form-check-input" type="checkbox" id="unlimitedToggle" v-model="creditsForm.unlimited" />
                <label class="form-check-label" for="unlimitedToggle">
                  <strong>Creditos Ilimitados</strong>
                </label>
              </div>
            </div>
            <div v-if="!creditsForm.unlimited" class="mb-3">
              <TextInput v-model="creditsForm.balance" type="number" label="Saldo de creditos" placeholder="Ex: 100" :min="0" />
            </div>
            <div v-if="creditsForm.unlimited" class="alert alert-info small mb-0">
              <i class="bi bi-info-circle me-1"></i>Com creditos ilimitados, a empresa pode usar IA sem restricao de saldo.
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-outline-secondary" @click="creditsModal = false">Cancelar</button>
            <button class="btn btn-primary" :disabled="savingCredits" @click="saveCredits">
              {{ savingCredits ? 'Salvando...' : 'Salvar' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import api from '../api'
import Swal from 'sweetalert2'
import TextInput from '../components/form/input/TextInput.vue'

const admins = ref([])
const loading = ref(true)
const creating = ref(false)
const removing = ref(null)
const form = ref({ name: '', email: '', password: '' })

const companies = ref([])
const companiesLoading = ref(true)
const companySearch = ref('')
const creditsModal = ref(false)
const creditsCompany = ref(null)
const creditsForm = ref({ balance: 0, unlimited: false })
const savingCredits = ref(false)

const filteredCompanies = computed(() => {
  const q = (companySearch.value || '').toLowerCase().trim()
  if (!q) return companies.value
  return companies.value.filter(c => (c.name || '').toLowerCase().includes(q))
})

function formatDate(d) {
  if (!d) return ''
  try { return new Date(d).toLocaleDateString('pt-BR') } catch { return d }
}

async function loadAdmins() {
  loading.value = true
  try {
    const { data } = await api.get('/saas/super-admins')
    admins.value = data || []
  } catch (e) {
    console.error(e)
  } finally {
    loading.value = false
  }
}

async function loadCompanies() {
  companiesLoading.value = true
  try {
    const { data } = await api.get('/saas/companies')
    companies.value = (data.rows || data || [])
  } catch (e) {
    console.error(e)
  } finally {
    companiesLoading.value = false
  }
}

async function create() {
  if (!form.value.name || !form.value.email || !form.value.password) return
  creating.value = true
  try {
    await api.post('/saas/super-admins', form.value)
    Swal.fire({ icon: 'success', text: 'Super Admin criado', timer: 1500, showConfirmButton: false })
    form.value = { name: '', email: '', password: '' }
    await loadAdmins()
  } catch (e) {
    Swal.fire({ icon: 'error', text: e.response?.data?.message || 'Erro ao criar' })
  } finally {
    creating.value = false
  }
}

async function remove(a) {
  const result = await Swal.fire({
    title: 'Remover Super Admin?',
    text: `${a.name} (${a.email}) sera removido.`,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'Remover',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#dc3545',
  })
  if (!result.isConfirmed) return
  removing.value = a.id
  try {
    await api.delete(`/saas/super-admins/${a.id}`)
    Swal.fire({ icon: 'success', text: 'Removido', timer: 1500, showConfirmButton: false })
    await loadAdmins()
  } catch (e) {
    Swal.fire({ icon: 'error', text: e.response?.data?.message || 'Erro ao remover' })
  } finally {
    removing.value = null
  }
}

function openCreditsModal(c) {
  creditsCompany.value = c
  creditsForm.value = {
    balance: c.aiCreditsBalance || 0,
    unlimited: !!c.saasSubscription?.plan?.unlimitedAiCredits
  }
  creditsModal.value = true
}

async function saveCredits() {
  savingCredits.value = true
  try {
    const payload = { unlimited: creditsForm.value.unlimited }
    if (!creditsForm.value.unlimited) {
      payload.balance = Number(creditsForm.value.balance || 0)
    }
    await api.put(`/saas/companies/${creditsCompany.value.id}/ai-credits`, payload)
    Swal.fire({ icon: 'success', text: 'Creditos atualizados', timer: 1500, showConfirmButton: false })
    creditsModal.value = false
    await loadCompanies()
  } catch (e) {
    Swal.fire({ icon: 'error', text: e.response?.data?.message || 'Erro ao salvar' })
  } finally {
    savingCredits.value = false
  }
}

onMounted(() => {
  loadAdmins()
  loadCompanies()
})
</script>

<style scoped>
</style>
