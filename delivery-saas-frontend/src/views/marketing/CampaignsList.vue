<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import api from '../../api'
import ListCard from '../../components/ListCard.vue'
import BaseButton from '../../components/BaseButton.vue'

const router = useRouter()
const campaigns = ref([])
const loading = ref(false)

const STATUS_LABELS = {
  DRAFT:     { label: 'Rascunho',  class: 'bg-secondary' },
  SCHEDULED: { label: 'Agendada',  class: 'bg-info text-dark' },
  RUNNING:   { label: 'Rodando',   class: 'bg-success' },
  PAUSED:    { label: 'Pausada',   class: 'bg-warning text-dark' },
  COMPLETED: { label: 'Concluída', class: 'bg-dark' },
  CANCELLED: { label: 'Cancelada', class: 'bg-danger' },
}

async function load() {
  loading.value = true
  try {
    const { data } = await api.get('/marketing/campaigns')
    campaigns.value = data
  } finally { loading.value = false }
}
onMounted(load)
</script>

<template>
  <ListCard :title="`Campanhas (${campaigns.length})`" icon="bi bi-broadcast">
    <template #actions>
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
              <router-link :to="`/marketing/campaigns/${c.id}`" class="btn btn-sm btn-outline-primary">Ver</router-link>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </ListCard>
</template>
