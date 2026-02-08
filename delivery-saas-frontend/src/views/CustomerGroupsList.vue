<template>
  <div class="container p-3">
    <ListCard title="Grupos de clientes" icon="bi bi-people" :subtitle="groups.length ? `${groups.length} grupos` : ''" :quickSearch="true" quickSearchPlaceholder="Buscar por nome" @quick-search="onQuickSearch" @quick-clear="onQuickClear">
      <template #actions>
        <router-link class="btn btn-primary" :to="{ path: '/customer-groups/new' }">Novo grupo</router-link>
      </template>

      <template #default>
        <div v-if="loading" class="text-center py-4">Carregando...</div>
        <div v-else>
          <table class="table table-sm">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Ativo</th>
                <th>Membros</th>
                <th>Regras</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="g in displayed" :key="g.id">
                <td>{{ g.name }}</td>
                <td>{{ g.active ? 'Sim' : 'Não' }}</td>
                <td>{{ (g.members || []).length }}</td>
                <td>{{ (g.rules || []).length }}</td>
                <td class="text-end">
                  <router-link class="btn btn-sm btn-outline-primary me-2" :to="`/customer-groups/${g.id}`">Editar</router-link>
                  <button class="btn btn-sm btn-outline-danger" @click="removeGroup(g)">Excluir</button>
                </td>
              </tr>
            </tbody>
          </table>
          <div v-if="displayed.length===0" class="text-muted">Nenhum grupo encontrado.</div>
        </div>
      </template>
    </ListCard>
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue'
import api from '../api'
import ListCard from '../components/ListCard.vue'

const groups = ref([])
const q = ref('')

const displayed = computed(() => {
  if(!q.value) return groups.value
  const term = q.value.toLowerCase()
  return (groups.value || []).filter(g => (g.name || '').toLowerCase().includes(term))
})
const loading = ref(false)

async function load(){
  loading.value = true
  try{
    const { data } = await api.get('/customer-groups')
    groups.value = data || []
  }catch(e){ console.error('Failed to load groups', e); }
  loading.value = false
}

onMounted(() => { load() })

async function removeGroup(g){
  if(!confirm('Excluir grupo "' + g.name + '"?')) return
  try{
    await api.delete(`/customer-groups/${g.id}`)
    groups.value = groups.value.filter(x => x.id !== g.id)
  }catch(e){ alert('Falha ao excluir') }
}
function onQuickSearch(val){ q.value = val }
function onQuickClear(){ q.value = '' }
</script>

<style scoped>
/* minimal styles kept */
</style>
