<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import api from '../../api'
import ListCard from '../../components/ListCard.vue'
import BaseButton from '../../components/BaseButton.vue'
import Swal from 'sweetalert2'

const router = useRouter()
const campaigns = ref([])
const loading = ref(false)

const STATUS_LABELS = {
  DRAFT:     { label: 'Rascunho',  class: 'bg-secondary' },
  SCHEDULED: { label: 'Agendada',  class: 'bg-info text-dark' },
  RUNNING:   { label: 'Rodando',   class: 'bg-success' },
  PAUSED:    { label: 'Pausada',   class: 'bg-warning text-dark' },
  COMPLETED: { label: 'Concluída', class: 'bg-dark' },
  FAILED:    { label: 'Falhou',    class: 'bg-danger' },
  CANCELLED: { label: 'Cancelada', class: 'bg-danger' },
}

const PAUSE_STATUSES = ['RUNNING', 'SCHEDULED']
const RESUME_STATUSES = ['PAUSED']
const EDIT_STATUSES = ['PAUSED', 'DRAFT']
const CANCEL_STATUSES = ['DRAFT', 'SCHEDULED', 'RUNNING', 'PAUSED']

const acting = ref(new Set())

async function load() {
  loading.value = true
  try {
    const { data } = await api.get('/marketing/campaigns')
    campaigns.value = data
  } finally { loading.value = false }
}
onMounted(load)

async function doAction(c, kind, confirmText) {
  const r = await Swal.fire({
    title: confirmText,
    text: c.name,
    icon: 'question',
    showCancelButton: true,
    confirmButtonText: 'Confirmar',
    cancelButtonText: 'Cancelar',
  })
  if (!r.isConfirmed) return
  acting.value.add(c.id)
  try {
    await api.post(`/marketing/campaigns/${c.id}/${kind}`)
    await load()
  } catch (e) {
    Swal.fire({ icon: 'error', text: e?.response?.data?.message || 'Falha na ação' })
  } finally {
    acting.value.delete(c.id)
  }
}
</script>

<template>
  <ListCard :title="`Campanhas (${campaigns.length})`" icon="bi bi-broadcast">
    <template #actions>
      <router-link to="/marketing/segments" class="btn btn-outline-secondary">
        <i class="bi bi-people me-1"></i>Segmentos
      </router-link>
      <BaseButton variant="primary" icon="+" @click="router.push('/marketing/campaigns/new')">
        Nova campanha
      </BaseButton>
    </template>
    <div v-if="loading" class="text-center py-5">
      <div class="spinner-border text-primary"></div>
    </div>
    <div v-else-if="!campaigns.length" class="text-center py-5 text-muted">
      Nenhuma campanha ainda.
    </div>
    <div v-else class="table-responsive">
      <table class="table table-hover align-middle">
        <thead>
          <tr>
            <th>Nome</th>
            <th>Tipo</th>
            <th>Status</th>
            <th>Mensagens</th>
            <th class="text-end">Ações</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in campaigns" :key="c.id">
            <td>
              <div class="fw-semibold">{{ c.name }}</div>
              <small class="text-muted">{{ c.segment?.name }}</small>
            </td>
            <td><small>{{ c.scheduleType }}</small></td>
            <td><span class="badge" :class="STATUS_LABELS[c.status]?.class">{{ STATUS_LABELS[c.status]?.label }}</span></td>
            <td>{{ c._count?.messages || 0 }}</td>
            <td class="text-end">
              <div class="btn-group btn-group-sm" role="group">
                <router-link :to="`/marketing/campaigns/${c.id}`"
                             class="btn btn-outline-primary"
                             title="Ver detalhes">
                  <i class="bi bi-eye"></i>
                </router-link>
                <router-link v-if="EDIT_STATUSES.includes(c.status)"
                             :to="`/marketing/campaigns/${c.id}/edit`"
                             class="btn btn-outline-secondary"
                             title="Editar">
                  <i class="bi bi-pencil"></i>
                </router-link>
                <button v-if="PAUSE_STATUSES.includes(c.status)"
                        type="button"
                        class="btn btn-outline-warning"
                        :disabled="acting.has(c.id)"
                        title="Pausar"
                        @click="doAction(c, 'pause', 'Pausar campanha?')">
                  <i class="bi bi-pause-fill"></i>
                </button>
                <button v-if="RESUME_STATUSES.includes(c.status)"
                        type="button"
                        class="btn btn-outline-success"
                        :disabled="acting.has(c.id)"
                        title="Retomar"
                        @click="doAction(c, 'resume', 'Retomar campanha?')">
                  <i class="bi bi-play-fill"></i>
                </button>
                <button v-if="CANCEL_STATUSES.includes(c.status)"
                        type="button"
                        class="btn btn-outline-danger"
                        :disabled="acting.has(c.id)"
                        title="Cancelar"
                        @click="doAction(c, 'cancel', 'Cancelar campanha? Esta ação é irreversível.')">
                  <i class="bi bi-x-circle"></i>
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </ListCard>
</template>
