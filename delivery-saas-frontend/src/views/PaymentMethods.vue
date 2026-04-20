<template>
  <div>
    <ListCard
      title="Formas de pagamento"
      icon="bi-credit-card"
      :subtitle="methods.length ? `${methods.length} formas cadastradas` : ''"
    >
      <template #actions>
        <BaseButton variant="primary" size="sm" icon="+" @click="goNew">Nova forma</BaseButton>
      </template>

      <template #default>
        <div v-if="loading" class="text-center py-4">Carregando...</div>
        <div v-else-if="methods.length === 0" class="text-center py-4 text-muted">Nenhuma forma de pagamento cadastrada.</div>
        <div v-else class="table-responsive">
          <table class="table table-hover align-middle">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Código</th>
                <th>Estado</th>
                <th class="text-end">Ações</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="m in methods" :key="m.id">
                <td><strong>{{ m.name }}</strong></td>
                <td><span class="text-muted small">{{ m.code }}</span></td>
                <td>
                  <span v-if="m.isActive" class="badge bg-success">Ativo</span>
                  <span v-else class="badge bg-secondary">Inativo</span>
                </td>
                <td class="text-end">
                  <BaseIconButton color="primary" title="Editar" @click="edit(m)">
                    <i class="bi-pencil"></i>
                  </BaseIconButton>
                  <BaseIconButton v-if="m.code !== 'CASH'" color="danger" title="Remover" @click="remove(m)">
                    <i class="bi-trash"></i>
                  </BaseIconButton>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </ListCard>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { bindLoading } from '../state/globalLoading.js'
import api from '../api'
import Swal from 'sweetalert2'
import ListCard from '@/components/ListCard.vue'
import BaseButton from '@/components/BaseButton.vue'
import BaseIconButton from '@/components/BaseIconButton.vue'

const loading = ref(false)
bindLoading(loading)
const methods = ref([])
const router = useRouter()

async function load() {
  loading.value = true
  try {
    const res = await api.get('/menu/payment-methods')
    methods.value = res.data || []

    const hasCash = methods.value.some(m => String(m.code || '').toUpperCase() === 'CASH')
    if (!hasCash) {
      try {
        await api.post('/menu/payment-methods', { name: 'Dinheiro', code: 'CASH', isActive: true, config: {} })
        const r2 = await api.get('/menu/payment-methods')
        methods.value = r2.data || []
      } catch (createErr) { console.warn('failed to create default CASH payment method', createErr) }
    }
  } catch (e) {
    console.error(e)
    Swal.fire({ icon: 'error', text: 'Falha ao carregar formas' })
  } finally {
    loading.value = false
  }
}

function goNew() {
  router.push({ path: '/settings/payment-methods/new' })
}

function edit(m) {
  router.push({ path: `/settings/payment-methods/${m.id}` })
}

async function remove(m) {
  if (String(m.code || '').toUpperCase() === 'CASH') {
    Swal.fire({ icon: 'info', text: "A forma 'Dinheiro' não pode ser removida — você pode apenas desativá-la." })
    return
  }
  const r = await Swal.fire({
    title: 'Remover forma?',
    text: `Remover "${m.name}"?`,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'Remover',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#dc3545',
  })
  if (!r.isConfirmed) return
  try {
    await api.delete(`/menu/payment-methods/${m.id}`)
    await load()
    Swal.fire({ icon: 'success', text: 'Forma removida', timer: 1500, showConfirmButton: false })
  } catch (e) {
    console.error(e)
    Swal.fire({ icon: 'error', text: e.response?.data?.message || 'Falha ao remover' })
  }
}

onMounted(() => load())
</script>
