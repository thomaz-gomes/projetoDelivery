<template>
  <div class="container py-4">
    <h3>{{ isEdit ? 'Editar grupo de opções' : 'Novo grupo de opções' }}</h3>

    <form @submit.prevent="save">
      <div class="row">
        <div class="col-md-6 mb-3">
          <label class="form-label">Nome</label>
          <input v-model="form.name" class="form-control" required />
        </div>
        <div class="col-md-3 mb-3">
          <label class="form-label">Min</label>
          <input v-model.number="form.min" type="number" class="form-control" />
        </div>
        <div class="col-md-3 mb-3">
          <label class="form-label">Max</label>
          <input v-model.number="form.max" type="number" class="form-control" />
        </div>
      </div>

      <div class="mb-3 form-check form-switch">
        <input class="form-check-input" type="checkbox" v-model="form.isActive" id="grp-active" />
        <label class="form-check-label" for="grp-active">Ativo</label>
      </div>

      <div class="d-flex gap-2">
        <button class="btn btn-primary" :disabled="saving">Salvar</button>
        <button type="button" class="btn btn-outline-secondary" @click="cancel">Cancelar</button>
      </div>
    </form>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import api from '../api'
import { bindLoading } from '../state/globalLoading.js'
import Swal from 'sweetalert2'

const route = useRoute()
const router = useRouter()
const id = route.params.id || null
const isEdit = Boolean(id)
const loading = ref(false)
bindLoading(loading)
const saving = ref(false)

const form = ref({ name: '', min: 0, max: null, position: 0, isActive: true })

onMounted(async ()=>{
  if(isEdit){
    loading.value = true
    try{
      const res = await api.get(`/menu/options/${id}`)
      const g = res.data
      if(g){ form.value = { name: g.name || '', min: g.min || 0, max: g.max === undefined ? null : g.max, position: g.position || 0, isActive: g.isActive !== false } }
    }catch(e){ console.error(e); Swal.fire({ icon: 'error', text: 'Falha ao carregar grupo' }) }
    finally{ loading.value = false }
  }
})

async function save(){
  saving.value = true
  try{
    const payload = { name: String(form.value.name||''), min: Number(form.value.min||0), max: form.value.max === null ? null : Number(form.value.max), position: Number(form.value.position||0), isActive: !!form.value.isActive }
    if(isEdit){
      await api.patch(`/menu/options/${id}`, payload)
      Swal.fire({ icon: 'success', text: 'Grupo atualizado' })
    } else {
      await api.post('/menu/options', payload)
      Swal.fire({ icon: 'success', text: 'Grupo criado' })
    }
    router.push({ path: '/menu/options' })
  }catch(e){ console.error(e); Swal.fire({ icon: 'error', text: e?.response?.data?.message || e.message || 'Erro ao salvar' }) }
  finally{ saving.value = false }
}

function cancel(){ router.push({ path: '/menu/options' }) }
</script>

<style scoped>
</style>
