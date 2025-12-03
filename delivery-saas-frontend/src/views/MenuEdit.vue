<template>
  <div class="container py-4">
    <h2>{{ isEdit ? 'Editar cardápio' : 'Novo cardápio' }}</h2>
    <div class="card p-4 mt-3">
      <form @submit.prevent="save">
        <div class="mb-3">
          <label class="form-label">Nome</label>
          <TextInput v-model="form.name" placeholder="Nome do cardápio" maxlength="120" inputClass="form-control" required />
        </div>

        <div class="mb-3">
          <label class="form-label">Loja</label>
          <SelectInput   v-model="form.storeId"  class="form-select" required>
            <option :value="null">-- Selecione uma loja --</option>
            <option v-for="s in stores" :key="s.id" :value="s.id">{{ s.name }}</option>
          </SelectInput>
        </div>

        <div class="mb-3">
          <label class="form-label">Slug público (opcional)</label>
          <TextInput v-model="form.slug" placeholder="ex: festival-de-verao" maxlength="80" inputClass="form-control" />
          <div class="form-text">Se preenchido, o cardápio ficará acessível em /public/&lt;slug&gt;</div>
        </div>

        <div class="mb-3">
          <label class="form-label">Descrição (opcional)</label>
          <TextInput v-model="form.description" inputClass="form-control" />
        </div>

        <div class="d-flex justify-content-between">
          <div>
            <button class="btn btn-secondary me-2" type="button" @click="cancel">Cancelar</button>
            <button v-if="isEdit" class="btn btn-outline-primary" type="button" @click="openStructure">Editar estrutura</button>
          </div>
          <div>
            <button class="btn btn-primary" type="submit" :disabled="saving">{{ isEdit ? 'Salvar alterações' : 'Criar cardápio' }}</button>
          </div>
        </div>

        <div v-if="error" class="alert alert-danger mt-3">{{ error }}</div>
      </form>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import api from '../api'
import Swal from 'sweetalert2'

const route = useRoute()
const router = useRouter()
const id = route.params.id || null
const isEdit = Boolean(id)

const form = ref({ id: null, name: '', storeId: null, description: '', slug: '' })
const stores = ref([])
const saving = ref(false)
const error = ref('')

async function load(){
  try{
    const st = await api.get('/stores')
    stores.value = st.data || []
    if(isEdit){
      const res = await api.get(`/menu/menus/${id}`)
      const d = res.data || {}
      form.value = { id: d.id, name: d.name || '', storeId: d.storeId || null, description: d.description || '', slug: d.slug || '' }
    }
  }catch(e){ console.error(e); error.value = e.response?.data?.message || 'Falha ao carregar dados' }
}

function cancel(){ router.push({ path: '/menu/menus' }) }

async function save(){
  error.value = ''
  if(!form.value.name) { error.value = 'Nome é obrigatório'; return }
  if(!form.value.storeId) { error.value = 'Loja é obrigatória'; return }
  saving.value = true
    try{
    const payload = { name: form.value.name, description: form.value.description, storeId: form.value.storeId }
    if (form.value.slug !== undefined) payload.slug = form.value.slug || null
      let res = null
      if(isEdit){
        res = await api.patch(`/menu/menus/${id}`, payload)
        Swal.fire({ icon: 'success', text: 'Cardápio atualizado' })
      } else {
        res = await api.post('/menu/menus', payload)
        Swal.fire({ icon: 'success', text: 'Cardápio criado' })
      }
      // After saving, redirect to the same menu we just edited/created so the user
      // continues working on that menu instead of returning to the list view.
    try{
      const targetId = isEdit ? id : (res && res.data && res.data.id ? res.data.id : null)
      if(targetId){
        // Redirect the user directly to the menu structure editor for the saved menu
        router.push({ path: '/menu/admin', query: { menuId: targetId } })
      } else {
        router.push({ path: '/menu/menus' })
      }
    }catch(e){ router.push({ path: '/menu/menus' }) }
  }catch(e){ console.error(e); error.value = e.response?.data?.message || 'Falha ao salvar' }
  finally{ saving.value = false }
}

onMounted(load)

function openStructure(){
  if(!form.value.id) return
  router.push({ path: '/menu/admin', query: { menuId: form.value.id } })
}
</script>

<style scoped>
.container { max-width: 900px }
</style>
