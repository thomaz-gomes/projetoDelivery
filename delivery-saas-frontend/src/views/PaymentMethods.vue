<template>
  <div class="container py-4">
    <div class="d-flex align-items-center justify-content-between mb-3">
      <h2 class="m-0">Formas de pagamento</h2>
      <div>
        <router-link class="btn btn-primary" :to="{ path: '/settings/payment-methods/new' }">Criar nova forma</router-link>
      </div>
    </div>

    <div v-if="loading" class="text-center py-3">Carregando...</div>

    <div v-else>
      <div class="table-responsive">
        <table class="table table-striped">
          <thead>
            <tr>
              <th>Nome</th>
              <th>Código</th>
              <th>Estado</th>
              <th style="width:220px">Ações</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in methods" :key="m.id">
              <td><strong>{{ m.name }}</strong></td>
              <td class="text-muted">{{ m.code }}</td>
              <td>
                <span v-if="m.isActive" class="badge bg-success">Ativo</span>
                <span v-else class="badge bg-secondary">Inativo</span>
              </td>
              <td>
                <router-link class="btn btn-sm btn-outline-primary me-2" :to="{ path: `/settings/payment-methods/${m.id}` }">Editar</router-link>
                <button v-if="m.code !== 'CASH'" class="btn btn-sm btn-danger" @click="remove(m)">Remover</button>
                <button v-else class="btn btn-sm btn-outline-secondary" disabled title="A forma 'Dinheiro' não pode ser removida">Remover</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { bindLoading } from '../state/globalLoading.js'
import api from '../api'
import Swal from 'sweetalert2'
import { useRouter } from 'vue-router'

const loading = ref(false)
bindLoading(loading)
const methods = ref([])
const router = useRouter()

async function load(){
  loading.value = true
  try{
    const res = await api.get('/menu/payment-methods')
    methods.value = res.data || []

    // ensure default Dinheiro (CASH) exists — if not, create it and reload
    const hasCash = methods.value.some(m => String(m.code || '').toUpperCase() === 'CASH')
    if(!hasCash){
      try{
        await api.post('/menu/payment-methods', { name: 'Dinheiro', code: 'CASH', isActive: true, config: {} })
        // reload list after creation
        const r2 = await api.get('/menu/payment-methods')
        methods.value = r2.data || []
      }catch(createErr){ console.warn('failed to create default CASH payment method', createErr) }
    }

  }catch(e){ console.error(e); Swal.fire({ icon: 'error', text: 'Falha ao carregar formas' }) }
  finally{ loading.value = false }
}

function edit(m){
  // navigate to edit page
  router.push({ path: `/settings/payment-methods/${m.id}` })
}

async function remove(m){
  if(String(m.code || '').toUpperCase() === 'CASH'){
    // do not allow deletion of default method
    Swal.fire({ icon: 'info', text: "A forma 'Dinheiro' não pode ser removida — você pode apenas desativá-la." })
    return
  }
  const r = await Swal.fire({ title: 'Remover forma?', text: `Remover "${m.name}"?`, icon: 'warning', showCancelButton:true, confirmButtonText:'Sim', cancelButtonText:'Cancelar' })
  if(!r.isConfirmed) return
  try{ await api.delete(`/menu/payment-methods/${m.id}`); await load(); Swal.fire({ icon:'success', text: 'Forma removida' }) }catch(e){ console.error(e); Swal.fire({ icon:'error', text: 'Falha ao remover' }) }
}

onMounted(()=> load())
</script>

<style scoped>
</style>
