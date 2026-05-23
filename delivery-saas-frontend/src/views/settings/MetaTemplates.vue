<script setup>
import { ref, computed, onMounted } from 'vue'
import Swal from 'sweetalert2'
import api from '../../api'
import BaseButton from '../../components/BaseButton.vue'

const loading = ref(false)
const syncing = ref(false)
const accounts = ref([])
const templates = ref([])
const selectedAccountId = ref(null)
const statusFilter = ref('')

const filteredTemplates = computed(() => {
  let list = templates.value
  if (selectedAccountId.value) {
    list = list.filter(t => t.metaWaAccountId === selectedAccountId.value)
  }
  if (statusFilter.value) {
    list = list.filter(t => t.status === statusFilter.value)
  }
  return list
})

const statusBadge = (status) => {
  const map = {
    APPROVED: 'bg-success',
    PENDING: 'bg-warning text-dark',
    REJECTED: 'bg-danger',
    PAUSED: 'bg-secondary',
    DISABLED: 'bg-secondary',
    DELETED: 'bg-dark',
  }
  return map[status] || 'bg-light text-dark'
}

const categoryLabel = (cat) => {
  const map = {
    UTILITY: 'Utilidade',
    MARKETING: 'Marketing',
    AUTHENTICATION: 'Autenticação',
  }
  return map[cat] || cat
}

const bodyText = (components) => {
  if (!Array.isArray(components)) return ''
  const body = components.find(c => String(c.type).toUpperCase() === 'BODY')
  return body?.text || ''
}

const placeholderCount = (components) => {
  const text = JSON.stringify(components || [])
  const matches = text.match(/\{\{\d+\}\}/g) || []
  const ids = new Set(matches.map(m => m.replace(/[{}]/g, '')))
  return ids.size
}

async function load() {
  loading.value = true
  try {
    // Conta de canais conectadas (apenas META_WA).
    // O endpoint retorna { accounts: [...] }, não um array puro.
    const accResp = await api.get('/auth/meta/connected')
    const allConnected = Array.isArray(accResp.data?.accounts) ? accResp.data.accounts : []
    accounts.value = allConnected.filter(a => a.provider === 'META_WA')
    if (accounts.value.length && !selectedAccountId.value) {
      selectedAccountId.value = accounts.value[0].id
    }
    // Templates cacheados
    const tplResp = await api.get('/meta/templates')
    templates.value = Array.isArray(tplResp.data) ? tplResp.data : []
  } catch (err) {
    console.error('[MetaTemplates] load failed:', err)
    await Swal.fire({ icon: 'error', title: 'Erro ao carregar', text: err?.response?.data?.message || err.message })
  } finally {
    loading.value = false
  }
}

async function syncTemplates() {
  if (!selectedAccountId.value) {
    await Swal.fire({ icon: 'warning', title: 'Selecione um número', text: 'Escolha qual número WhatsApp sincronizar.' })
    return
  }
  syncing.value = true
  try {
    const resp = await api.post('/meta/templates/sync', { accountId: selectedAccountId.value })
    const { synced, markedDeleted } = resp.data || {}
    await Swal.fire({
      icon: 'success',
      title: 'Sincronizado',
      text: `${synced || 0} templates atualizados, ${markedDeleted || 0} marcados como removidos.`,
      timer: 3000,
      showConfirmButton: false,
    })
    await load()
  } catch (err) {
    console.error('[MetaTemplates] sync failed:', err)
    const metaErr = err?.response?.data?.meta
    const msg = metaErr?.message || err?.response?.data?.message || err.message
    await Swal.fire({ icon: 'error', title: 'Falha na sincronização', text: msg })
  } finally {
    syncing.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="container py-4">
    <div class="d-flex align-items-center justify-content-between mb-3">
      <h2 class="mb-0">Templates WhatsApp</h2>
      <BaseButton @click="syncTemplates" :loading="syncing" :disabled="loading || !selectedAccountId">
        <i class="bi bi-arrow-repeat me-1"></i> Sincronizar
      </BaseButton>
    </div>

    <div class="alert alert-info small mb-3">
      <i class="bi bi-info-circle me-1"></i>
      Templates são criados e aprovados no <a href="https://business.facebook.com" target="_blank" rel="noopener">Meta Business Manager</a> (WhatsApp Manager → Modelos de mensagem).
      Esta página apenas lista o que já está cadastrado lá e permite usá-lo via API. Use o botão "Sincronizar" depois de criar ou alterar templates.
    </div>

    <div class="card p-3 mb-3" v-if="accounts.length">
      <div class="row g-3">
        <div class="col-md-6">
          <label class="form-label">Número WhatsApp</label>
          <select class="form-select" v-model="selectedAccountId">
            <option v-for="acc in accounts" :key="acc.id" :value="acc.id">
              {{ acc.displayName || acc.externalId }}
            </option>
          </select>
        </div>
        <div class="col-md-6">
          <label class="form-label">Status</label>
          <select class="form-select" v-model="statusFilter">
            <option value="">Todos</option>
            <option value="APPROVED">Aprovados</option>
            <option value="PENDING">Pendentes</option>
            <option value="REJECTED">Rejeitados</option>
            <option value="PAUSED">Pausados</option>
            <option value="DISABLED">Desativados</option>
            <option value="DELETED">Removidos</option>
          </select>
        </div>
      </div>
    </div>

    <div v-if="loading" class="text-center py-5 text-muted">
      <div class="spinner-border" role="status"></div>
      <div class="mt-2">Carregando...</div>
    </div>

    <div v-else-if="!accounts.length" class="alert alert-warning">
      Nenhum número WhatsApp Cloud conectado. Conecte um em
      <router-link to="/settings/whatsapp-cloud">WhatsApp Cloud API</router-link> antes.
    </div>

    <div v-else-if="!filteredTemplates.length" class="alert alert-light border text-center py-4">
      <i class="bi bi-inbox" style="font-size: 2rem;"></i>
      <div class="mt-2">Nenhum template encontrado para este número.</div>
      <div class="small text-muted mt-1">Clique em "Sincronizar" para puxar os templates aprovados do Meta Business Manager.</div>
    </div>

    <div v-else class="table-responsive">
      <table class="table table-hover align-middle">
        <thead>
          <tr>
            <th>Nome</th>
            <th>Idioma</th>
            <th>Categoria</th>
            <th>Status</th>
            <th>Placeholders</th>
            <th>Texto do corpo</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="t in filteredTemplates" :key="t.id">
            <td><code>{{ t.name }}</code></td>
            <td><span class="badge bg-light text-dark">{{ t.language }}</span></td>
            <td>{{ categoryLabel(t.category) }}</td>
            <td><span class="badge" :class="statusBadge(t.status)">{{ t.status }}</span></td>
            <td class="text-center">{{ placeholderCount(t.components) }}</td>
            <td class="text-muted small" style="max-width: 400px;">
              <div class="text-truncate" :title="bodyText(t.components)">{{ bodyText(t.components) }}</div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
