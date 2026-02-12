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
  </div>
</template>
