<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import api from '../../api'
import ListCard from '../../components/ListCard.vue'
import BaseButton from '../../components/BaseButton.vue'
import Swal from 'sweetalert2'

const router = useRouter()
const segments = ref([])
const loading = ref(false)

async function load() {
  loading.value = true
  try {
    const { data } = await api.get('/marketing/segments')
    segments.value = data
  } catch (e) {
    Swal.fire({ icon: 'error', text: 'Falha ao carregar segmentos' })
  } finally { loading.value = false }
}
onMounted(load)

async function remove(seg) {
  const r = await Swal.fire({
    title: `Remover "${seg.name}"?`,
    text: 'O segmento não poderá ser usado em novas campanhas.',
    icon: 'warning', showCancelButton: true,
    confirmButtonText: 'Remover', cancelButtonText: 'Cancelar',
    confirmButtonColor: '#dc3545',
  })
  if (!r.isConfirmed) return
  try {
    await api.delete(`/marketing/segments/${seg.id}`)
    await load()
  } catch (e) {
    Swal.fire({ icon: 'error', text: 'Falha ao remover' })
  }
}

function fmtDate(s) {
  if (!s) return '—'
  try { return new Date(s).toLocaleString('pt-BR') } catch { return '—' }
}
</script>

<template>
  <ListCard title="Segmentos de clientes" icon="bi bi-people">
    <template #actions>
      <BaseButton variant="primary" icon="+" @click="router.push('/marketing/segments/new')">
        Novo segmento
      </BaseButton>
    </template>

    <div v-if="loading" class="text-center py-5">
      <div class="spinner-border text-primary" role="status"></div>
    </div>
    <div v-else-if="!segments.length" class="text-center py-5 text-muted">
      Nenhum segmento criado ainda.
    </div>
    <div v-else class="table-responsive">
      <table class="table table-hover align-middle">
        <thead>
          <tr>
            <th>Nome</th>
            <th>Tamanho estimado</th>
            <th>Última avaliação</th>
            <th class="text-end">Ações</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in segments" :key="s.id">
            <td>
              <div class="fw-semibold">{{ s.name }}</div>
              <div class="small text-muted">{{ s.description || '—' }}</div>
            </td>
            <td>{{ s.estimatedSize ?? '—' }}</td>
            <td><small class="text-muted">{{ fmtDate(s.lastEvaluatedAt) }}</small></td>
            <td class="text-end">
              <router-link :to="`/marketing/segments/${s.id}`" class="btn btn-sm btn-outline-primary me-1">
                Editar
              </router-link>
              <button class="btn btn-sm btn-outline-danger" @click="remove(s)">
                <i class="bi bi-trash"></i>
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </ListCard>
</template>
