<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import Swal from 'sweetalert2'
import api from '../api'
import ListCard from '../components/ListCard.vue'
import BaseButton from '../components/BaseButton.vue'
import BaseIconButton from '../components/BaseIconButton.vue'

const rows = ref([])
const total = ref(0)
const openCount = ref(0)
const loading = ref(false)
const status = ref('open')      // 'open' | 'resolved' | 'all'
const search = ref('')
const page = ref(1)
const expanded = ref(new Set())
let pollHandle = null

const hasResolved = computed(() => rows.value.some(r => r.resolved))

async function load() {
  loading.value = true
  try {
    const { data } = await api.get('/saas/error-logs', {
      params: { status: status.value, q: search.value, page: page.value },
    })
    rows.value = data.rows || []
    total.value = data.total || 0
    openCount.value = data.openCount || 0
  } catch (e) {
    Swal.fire({ icon: 'error', text: e?.response?.data?.message || 'Erro ao carregar logs' })
  } finally {
    loading.value = false
  }
}

function onSearch(value) { search.value = value; page.value = 1; load() }
function setStatus(s) { status.value = s; page.value = 1; load() }
function toggleExpand(id) {
  if (expanded.value.has(id)) expanded.value.delete(id)
  else expanded.value.add(id)
}

async function toggleResolve(row) {
  const action = row.resolved ? 'Reabrir este log?' : 'Marcar como solucionado?'
  const result = await Swal.fire({
    title: action, icon: 'question',
    showCancelButton: true, confirmButtonText: 'Confirmar', cancelButtonText: 'Cancelar',
  })
  if (!result.isConfirmed) return
  try {
    await api.patch(`/saas/error-logs/${row.id}/resolve`)
    await load()
  } catch (e) {
    Swal.fire({ icon: 'error', text: e?.response?.data?.message || 'Erro ao atualizar' })
  }
}

async function removeRow(row) {
  const result = await Swal.fire({
    title: 'Apagar este log?', text: 'Esta ação é irreversível.',
    icon: 'warning', showCancelButton: true,
    confirmButtonText: 'Apagar', cancelButtonText: 'Cancelar',
    confirmButtonColor: '#dc3545',
  })
  if (!result.isConfirmed) return
  try {
    await api.delete(`/saas/error-logs/${row.id}`)
    await load()
  } catch (e) {
    Swal.fire({ icon: 'error', text: e?.response?.data?.message || 'Erro ao apagar' })
  }
}

async function purgeResolved() {
  const result = await Swal.fire({
    title: 'Limpar todos os solucionados?',
    text: 'Todos os logs marcados como solucionados serão apagados.',
    icon: 'warning', showCancelButton: true,
    confirmButtonText: 'Limpar', cancelButtonText: 'Cancelar',
    confirmButtonColor: '#dc3545',
  })
  if (!result.isConfirmed) return
  try {
    const { data } = await api.post('/saas/error-logs/purge-resolved')
    Swal.fire({ icon: 'success', text: `${data.count} log(s) removido(s)`, timer: 1500, showConfirmButton: false })
    await load()
  } catch (e) {
    Swal.fire({ icon: 'error', text: e?.response?.data?.message || 'Erro ao limpar' })
  }
}

function formatRelative(iso) {
  const diffMs = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diffMs / 60000)
  if (m < 1) return 'agora'
  if (m < 60) return `há ${m} min`
  const h = Math.floor(m / 60)
  if (h < 24) return `há ${h}h`
  const d = Math.floor(h / 24)
  return `há ${d}d`
}

onMounted(() => {
  load()
  pollHandle = setInterval(() => {
    if (Swal.isVisible()) return
    load()
  }, 30000)
})
onBeforeUnmount(() => { if (pollHandle) clearInterval(pollHandle) })
</script>

<template>
  <div class="container py-3">
    <ListCard
      :title="`Logs de erro (${total})`"
      subtitle="Erros do sistema agrupados por tipo"
      icon="bi-exclamation-triangle"
      quick-search
      quick-search-placeholder="Buscar por mensagem ou rota..."
      @quick-search="onSearch"
    >
      <template #actions>
        <BaseButton variant="outline" size="sm" @click="load">
          <i class="bi-arrow-clockwise me-1"></i> Atualizar
        </BaseButton>
        <BaseButton variant="danger" size="sm" :disabled="!hasResolved" @click="purgeResolved">
          <i class="bi-trash me-1"></i> Limpar solucionados
        </BaseButton>
      </template>

      <template #filters>
        <ul class="nav nav-tabs mb-0">
          <li class="nav-item">
            <a class="nav-link" :class="{ active: status === 'open' }" href="#"
               @click.prevent="setStatus('open')">
              Abertos ({{ openCount }})
            </a>
          </li>
          <li class="nav-item">
            <a class="nav-link" :class="{ active: status === 'resolved' }" href="#"
               @click.prevent="setStatus('resolved')">
              Solucionados
            </a>
          </li>
          <li class="nav-item">
            <a class="nav-link" :class="{ active: status === 'all' }" href="#"
               @click.prevent="setStatus('all')">
              Todos
            </a>
          </li>
        </ul>
      </template>

      <div v-if="loading && rows.length === 0" class="text-center text-muted py-5">
        Carregando...
      </div>

      <div v-else-if="rows.length === 0 && status === 'open'" class="text-center py-5">
        <i class="bi-shield-check display-4 text-success"></i>
        <p class="text-muted mt-3 mb-0">Nenhum erro registrado — sistema operando normalmente.</p>
      </div>

      <div v-else-if="rows.length === 0" class="text-center text-muted py-5">
        Nenhum log encontrado.
      </div>

      <div v-else class="table-responsive">
        <table class="table table-hover align-middle">
          <thead>
            <tr>
              <th style="width:40px"></th>
              <th>Última ocorrência</th>
              <th>Mensagem</th>
              <th>Rota</th>
              <th>Empresa</th>
              <th>Status</th>
              <th class="text-end">Ações</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="row in rows" :key="row.id">
              <tr>
                <td>
                  <BaseIconButton color="light" :title="expanded.has(row.id) ? 'Recolher' : 'Expandir'"
                                  @click="toggleExpand(row.id)">
                    <i :class="expanded.has(row.id) ? 'bi-chevron-down' : 'bi-chevron-right'"></i>
                  </BaseIconButton>
                </td>
                <td><small>{{ formatRelative(row.lastSeen) }}</small></td>
                <td>
                  <div class="fw-medium">{{ row.message.slice(0, 80) }}{{ row.message.length > 80 ? '…' : '' }}</div>
                  <span v-if="row.occurrences > 1" class="badge bg-light text-dark mt-1">
                    ×{{ row.occurrences }} ocorrências
                  </span>
                </td>
                <td><code class="small">{{ row.route || '—' }}</code></td>
                <td>{{ row.company?.name || '—' }}</td>
                <td>
                  <span class="badge" :class="row.resolved ? 'bg-success' : 'bg-danger'">
                    {{ row.resolved ? 'Solucionado' : 'Aberto' }}
                  </span>
                </td>
                <td class="text-end">
                  <BaseIconButton color="success"
                                  :title="row.resolved ? 'Reabrir' : 'Marcar como solucionado'"
                                  @click="toggleResolve(row)">
                    <i :class="row.resolved ? 'bi-arrow-counterclockwise' : 'bi-check-circle'"></i>
                  </BaseIconButton>
                  <BaseIconButton color="danger" title="Apagar" @click="removeRow(row)">
                    <i class="bi-trash"></i>
                  </BaseIconButton>
                </td>
              </tr>
              <tr v-if="expanded.has(row.id)">
                <td colspan="7">
                  <div class="px-3 py-2">
                    <div class="row mb-2">
                      <div class="col-md-4">
                        <small class="text-muted d-block">Primeira ocorrência</small>
                        <span>{{ new Date(row.firstSeen).toLocaleString() }}</span>
                      </div>
                      <div class="col-md-4">
                        <small class="text-muted d-block">Status code</small>
                        <span>{{ row.statusCode || '—' }}</span>
                      </div>
                      <div class="col-md-4">
                        <small class="text-muted d-block">Usuário</small>
                        <span>{{ row.userId || '—' }}</span>
                      </div>
                    </div>
                    <small class="text-muted d-block mb-1">Stack trace</small>
                    <pre class="small p-3 rounded mb-0" style="background:var(--bg-zebra); white-space:pre-wrap;">{{ row.stack || 'Sem stack trace' }}</pre>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </ListCard>
  </div>
</template>
