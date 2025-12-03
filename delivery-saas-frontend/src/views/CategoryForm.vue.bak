<template>
  <div class="container py-4">
    <h2>{{ isEdit ? 'Editar categoria' : 'Nova categoria' }}</h2>
    <div class="card p-4 mt-3">
      <form @submit.prevent="save">
        <div class="mb-3">
          <label class="form-label">Nome da categoria</label>
          <input v-model="name" class="form-control" placeholder="Ex: Bebidas" required />
        </div>
            <div class="mb-3">
              <label class="form-label">Descrição (opcional)</label>
              <textarea v-model="description" class="form-control" rows="3" placeholder="Texto curto sobre a categoria"></textarea>
            </div>

            <div class="row">
              <div class="col-md-6 mb-3">
                <label class="form-label">Posição</label>
                <input v-model.number="position" type="number" class="form-control" />
              </div>
                        <div class="col-md-6 mb-3">
                          <label class="form-label">Menu (opcional)</label>
                          <select class="form-select" v-model="menuId">
                            <option :value="null">-- Nenhum --</option>
                            <option v-for="m in menus" :key="m.id" :value="m.id">{{ m.name }} (loja: {{ storesMap[m.storeId]?.name || m.storeId }})</option>
                          </select>
                        </div>
              <div class="col-md-6 mb-3 d-flex align-items-center">
                <div class="form-check form-switch ms-2">
                  <input class="form-check-input" type="checkbox" id="isActive" v-model="isActive">
                  <label class="form-check-label" for="isActive">Ativa</label>
                </div>
              </div>
            </div>

            <div class="d-flex justify-content-between">
              <button class="btn btn-secondary" type="button" @click="cancel">Voltar</button>
              <button class="btn btn-primary" :disabled="saving">{{ saving ? 'Salvando...' : 'Criar categoria' }}</button>
            </div>

            <div v-if="error" class="alert alert-danger mt-3">{{ error }}</div>
      </form>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import api from '../api'
import Swal from 'sweetalert2'

const router = useRouter()
const route = useRoute()
const name = ref('')
const position = ref(0)
const description = ref('')
const isActive = ref(true)
const saving = ref(false)
const error = ref('')
const id = route.params.id || null
const isEdit = Boolean(id)
const menus = ref([])
const storesMap = {}
const menuId = ref(null)

async function load(){
  if(!isEdit) return
  try{
    const res = await api.get(`/menu/categories/${id}`)
    const c = res.data
    if(c){ name.value = c.name || ''; description.value = c.description || ''; position.value = c.position || 0; isActive.value = c.isActive ?? true }
  }catch(e){ console.error(e); error.value = 'Falha ao carregar categoria' }
}

async function loadMenus(){
  try{
    const r = await api.get('/menu/menus')
    menus.value = r.data || []
    // fetch stores to build a simple map for display
    try{ const st = await api.get('/stores'); (st.data||[]).forEach(s=>storesMap[s.id]=s) }catch(e){}
    if(isEdit){
      try{ const res = await api.get(`/menu/categories/${id}`); menuId.value = res.data.menuId || null }catch(e){}
    }
  }catch(e){ console.warn('Failed to load menus', e) }
}

onMounted(()=> load())
onMounted(()=> loadMenus())

function cancel(){ router.push({ path: '/menu/admin' }) }

async function save(){
  error.value = ''
  saving.value = true
  try{
    if(!name.value) { error.value = 'Nome é obrigatório'; return }
    const payload = { name: name.value, position: position.value, description: description.value, isActive: isActive.value, menuId: menuId.value }
    if(isEdit){
      await api.patch(`/menu/categories/${id}`, payload)
      Swal.fire({ icon: 'success', text: 'Categoria atualizada' })
    } else {
      await api.post('/menu/categories', payload)
      Swal.fire({ icon: 'success', text: 'Categoria criada' })
    }
    // navigate back to admin and consider refreshing the list there
    router.push({ path: '/menu/admin' })
  }catch(e){ console.error(e); error.value = e?.response?.data?.message || e.message || 'Erro' }
  finally{ saving.value = false }
}
</script>
