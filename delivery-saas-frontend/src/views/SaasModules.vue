<script setup>
import { ref, onMounted, computed, watch } from 'vue'
import api from '../api'
import Swal from 'sweetalert2'

const MODULE_KEYS = [
  { value: 'CARDAPIO_SIMPLES',  label: 'Cardápio Simples (Base)',  icon: 'bi-list',              color: 'primary' },
  { value: 'CARDAPIO_COMPLETO', label: 'Cardápio Completo',        icon: 'bi-list-check',        color: 'success' },
  { value: 'RIDERS',            label: 'Entregadores',             icon: 'bi-bicycle',           color: 'primary' },
  { value: 'AFFILIATES',        label: 'Afiliados',                icon: 'bi-people-fill',       color: 'success' },
  { value: 'STOCK',             label: 'Controle de Estoque',      icon: 'bi-box-seam',          color: 'warning' },
  { value: 'CASHBACK',          label: 'Cashback',                 icon: 'bi-cash-stack',        color: 'info' },
  { value: 'COUPONS',           label: 'Cupons',                   icon: 'bi-ticket-perforated', color: 'danger' },
  { value: 'WHATSAPP',          label: 'WhatsApp',                 icon: 'bi-whatsapp',          color: 'success' },
  { value: 'FINANCIAL',         label: 'Financeiro',               icon: 'bi-cash-coin',         color: 'warning' },
  { value: 'FISCAL',            label: 'Módulo Fiscal (NF-e/NFC-e)', icon: 'bi-receipt',         color: 'danger' },
]

const modules = ref([])
const loading = ref(false)
const showForm = ref(false)
const editingModule = ref(null)
const form = ref({ key: 'RIDERS', name: '', description: '' })

const keyMeta = (key) => MODULE_KEYS.find(k => k.value === key) || { label: key, icon: 'bi-box', color: 'secondary' }

// Chaves já cadastradas
const usedKeys = computed(() => modules.value.map(m => m.key))
// Chaves disponíveis para criar (exclui as já usadas, exceto a em edição)
const availableKeys = computed(() => {
  return MODULE_KEYS.filter(k => !usedKeys.value.includes(k.value) || (editingModule.value && editingModule.value.key === k.value))
})

watch(() => form.value.key, (key) => {
  if (!editingModule.value) {
    const meta = keyMeta(key)
    form.value.name = meta.label
  }
})

async function load() {
  loading.value = true
  try {
    const res = await api.get('/saas/modules')
    modules.value = res.data || []
  } finally { loading.value = false }
}

onMounted(load)

function openCreate() {
  editingModule.value = null
  const nextKey = availableKeys.value.length ? availableKeys.value[0].value : 'RIDERS'
  form.value = { key: nextKey, name: keyMeta(nextKey).label, description: '' }
  showForm.value = true
}

function openEdit(m) {
  editingModule.value = m
  form.value = { key: m.key, name: m.name, description: m.description || '' }
  showForm.value = true
}

function cancelForm() {
  showForm.value = false
  editingModule.value = null
}

async function saveModule() {
  if (!form.value.name) return
  try {
    if (editingModule.value) {
      await api.put(`/saas/modules/${editingModule.value.id}`, form.value)
    } else {
      await api.post('/saas/modules', form.value)
    }
    showForm.value = false
    editingModule.value = null
    await load()
  } catch (e) {
    Swal.fire({ icon: 'error', title: 'Erro', text: e?.response?.data?.message || 'Falha ao salvar' })
  }
}

async function toggleActive(m) {
  try {
    await api.put(`/saas/modules/${m.id}`, { isActive: !m.isActive })
    await load()
  } catch (e) { console.warn('Failed to toggle module', e) }
}

async function deleteModule(m) {
  const result = await Swal.fire({
    title: `Remover "${m.name}"?`,
    text: 'Planos que usam este módulo perderão a referência.',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#dc3545',
    confirmButtonText: 'Sim, remover',
    cancelButtonText: 'Cancelar'
  })
  if (!result.isConfirmed) return
  try {
    await api.delete(`/saas/modules/${m.id}`)
    await load()
  } catch (e) { console.warn('Failed to delete module', e) }
}
</script>

<template>
  <div class="container py-3">
    <div class="d-flex justify-content-between align-items-center mb-3">
      <div>
        <h2 class="mb-0">Módulos</h2>
        <small class="text-muted">Gerencie os módulos disponíveis para atribuir aos planos</small>
      </div>
      <button v-if="!showForm && availableKeys.length" class="btn btn-primary" @click="openCreate">
        <i class="bi bi-plus-lg me-1"></i>Novo módulo
      </button>
    </div>

    <!-- Form -->
    <div v-if="showForm" class="card border-primary mb-3">
      <div class="card-body">
        <h6 class="card-title">{{ editingModule ? 'Editar módulo' : 'Criar módulo' }}</h6>
        <div class="row g-3">
          <div class="col-md-3">
            <label class="form-label">Chave</label>
            <select v-model="form.key" class="form-select" :disabled="!!editingModule">
              <option v-for="k in availableKeys" :key="k.value" :value="k.value">{{ k.label }}</option>
            </select>
          </div>
          <div class="col-md-4">
            <label class="form-label">Nome</label>
            <input v-model="form.name" class="form-control" placeholder="Nome exibido" />
          </div>
          <div class="col-md-5">
            <label class="form-label">Descrição</label>
            <input v-model="form.description" class="form-control" placeholder="Descrição breve (opcional)" />
          </div>
        </div>
        <div class="mt-3 d-flex gap-2">
          <button class="btn btn-primary" @click="saveModule">
            <i class="bi bi-check-lg me-1"></i>{{ editingModule ? 'Salvar' : 'Criar' }}
          </button>
          <button class="btn btn-outline-secondary" @click="cancelForm">Cancelar</button>
        </div>
      </div>
    </div>

    <!-- Modules grid -->
    <div v-if="loading" class="text-center py-5">
      <div class="spinner-border text-primary"></div>
    </div>

    <div v-else-if="modules.length === 0" class="text-center py-5 text-muted">
      <i class="bi bi-box-seam" style="font-size: 3rem;"></i>
      <p class="mt-2">Nenhum módulo cadastrado.</p>
      <button class="btn btn-primary" @click="openCreate">Criar primeiro módulo</button>
    </div>

    <div v-else class="row g-3">
      <div v-for="m in modules" :key="m.id" class="col-md-4 col-lg-3">
        <div class="card h-100" :class="{ 'border-secondary opacity-50': !m.isActive }">
          <div class="card-body d-flex flex-column">
            <div class="d-flex align-items-center mb-2">
              <span class="rounded-circle d-inline-flex align-items-center justify-content-center me-2"
                :class="`bg-${keyMeta(m.key).color} bg-opacity-10 text-${keyMeta(m.key).color}`"
                style="width: 40px; height: 40px;">
                <i class="bi" :class="keyMeta(m.key).icon" style="font-size: 1.2rem;"></i>
              </span>
              <div>
                <div class="fw-semibold">{{ m.name }}</div>
                <span class="badge" :class="m.isActive ? 'bg-success' : 'bg-secondary'">
                  {{ m.isActive ? 'Ativo' : 'Inativo' }}
                </span>
              </div>
            </div>
            <div class="small text-muted mb-2 flex-grow-1">{{ m.description || 'Sem descrição' }}</div>
            <code class="small d-block mb-2">{{ m.key }}</code>
            <div class="d-flex gap-1 mt-auto">
              <button class="btn btn-sm btn-outline-secondary flex-fill" @click="openEdit(m)" title="Editar">
                <i class="bi bi-pencil"></i>
              </button>
              <button class="btn btn-sm flex-fill"
                :class="m.isActive ? 'btn-outline-warning' : 'btn-outline-success'"
                @click="toggleActive(m)"
                :title="m.isActive ? 'Desativar' : 'Ativar'">
                <i class="bi" :class="m.isActive ? 'bi-pause-fill' : 'bi-play-fill'"></i>
              </button>
              <button class="btn btn-sm btn-outline-danger flex-fill" @click="deleteModule(m)" title="Remover">
                <i class="bi bi-trash"></i>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
