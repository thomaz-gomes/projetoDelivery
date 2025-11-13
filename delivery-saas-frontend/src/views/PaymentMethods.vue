<template>
  <div class="container py-4">
    <h2>Formas de pagamento</h2>

    <div class="row">
      <div class="col-md-6">
        <h5>Formas existentes</h5>
        <div v-if="loading" class="text-center py-3">Carregando...</div>
        <ul class="list-group" v-else>
          <li class="list-group-item d-flex justify-content-between align-items-center" v-for="m in methods" :key="m.id">
            <div>
              <strong>{{ m.name }}</strong>
              <div class="small text-muted">{{ m.code }} {{ m.isActive ? '' : '(inativo)' }}</div>
            </div>
            <div>
              <button class="btn btn-sm btn-outline-primary me-2" @click="edit(m)">Editar</button>
              <button class="btn btn-sm btn-danger" @click="remove(m)">Remover</button>
            </div>
          </li>
        </ul>
      </div>

      <div class="col-md-6">
        <h5>{{ form.id ? 'Editar forma' : 'Nova forma' }}</h5>
        <form @submit.prevent="save">
          <div class="mb-2">
            <input v-model="form.name" class="form-control" placeholder="Nome (ex: Dinheiro, PIX)" required />
          </div>
          <div class="mb-2 row">
            <div class="col-md-6"><input v-model="form.code" class="form-control" placeholder="Código (ex: CASH, PIX)" required /></div>
            <div class="col-md-6">
              <select v-model="form.isActive" class="form-select">
                <option :value="true">Ativo</option>
                <option :value="false">Inativo</option>
              </select>
            </div>
          </div>

          <div class="d-flex gap-2">
            <button class="btn btn-primary" :disabled="saving">Salvar</button>
            <button class="btn btn-secondary" type="button" @click="resetForm">Limpar</button>
          </div>

          <div v-if="error" class="alert alert-danger mt-2">{{ error }}</div>
          <div v-if="success" class="alert alert-success mt-2">{{ success }}</div>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { bindLoading } from '../state/globalLoading.js'
import api from '../api'
import Swal from 'sweetalert2'

const loading = ref(false)
bindLoading(loading)
const methods = ref([])
const saving = ref(false)
const error = ref('')
const success = ref('')

const form = ref({ id: null, name: '', code: '', isActive: true, config: {} })

async function load(){
  loading.value = true
  try{
    const res = await api.get('/menu/payment-methods')
    methods.value = res.data || []
  }catch(e){ console.error(e); error.value = 'Falha ao carregar formas' }
  finally{ loading.value = false }
}

function edit(m){ form.value = { ...m } }
function resetForm(){ form.value = { id: null, name: '', code: '', isActive: true, config: {} }; error.value = ''; success.value = '' }

async function save(){
  error.value = ''; success.value = ''; saving.value = true
  try{
    if(!form.value.name || !form.value.code) { error.value = 'Nome e código são obrigatórios'; return }
    if(form.value.id){
      await api.patch(`/menu/payment-methods/${form.value.id}`, { name: form.value.name, code: form.value.code, isActive: form.value.isActive, config: form.value.config })
      success.value = 'Atualizado'
    }else{
      await api.post('/menu/payment-methods', { name: form.value.name, code: form.value.code, isActive: form.value.isActive, config: form.value.config })
      success.value = 'Criado'
    }
    await load()
    resetForm()
  }catch(e){ console.error(e); error.value = e?.response?.data?.message || e.message }
  finally{ saving.value = false }
}

async function remove(m){
  const r = await Swal.fire({ title: 'Remover forma?', text: `Remover "${m.name}"?`, icon: 'warning', showCancelButton:true, confirmButtonText:'Sim', cancelButtonText:'Cancelar' })
  if(!r.isConfirmed) return
  try{ await api.delete(`/menu/payment-methods/${m.id}`); await load(); Swal.fire({ icon:'success', text: 'Forma removida' }) }catch(e){ console.error(e); Swal.fire({ icon:'error', text: 'Falha ao remover' }) }
}

onMounted(()=> load())
</script>

<style scoped>
</style>
