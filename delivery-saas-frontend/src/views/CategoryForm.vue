<template>
  <div class="container py-4">
    <h2>{{ isEdit ? 'Editar categoria' : 'Nova categoria' }}</h2>
    <div class="card p-4 mt-3">
      <form @submit.prevent="save">
        <div class="mb-3">
          <label class="form-label">Nome da categoria</label>
          <TextInput v-model="name" placeholder="Ex: Bebidas" inputClass="form-control" required />
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
                          <label class="form-label">Cardápios vinculados</label>
                          <div class="border rounded p-2" style="max-height:150px;overflow-y:auto">
                            <div v-for="m in menus" :key="m.id" class="form-check">
                              <input class="form-check-input" type="checkbox" :id="'cf-menu-'+m.id"
                                :value="m.id" v-model="selectedMenuIds" />
                              <label class="form-check-label" :for="'cf-menu-'+m.id">
                                {{ m.name }} <small class="text-muted">({{ storesMap[m.storeId]?.name || '' }})</small>
                              </label>
                            </div>
                            <div v-if="!menus.length" class="text-muted small">Nenhum cardápio</div>
                          </div>
                        </div>
              <div class="col-md-6 mb-3 d-flex align-items-center">
                <div class="form-check form-switch ms-2">
                  <input class="form-check-input" type="checkbox" id="isActive" v-model="isActive">
                  <label class="form-check-label" for="isActive">Ativa</label>
                </div>
              </div>
            </div>

            <div class="col-md-6 mb-3">
              <label class="form-label">Dados Fiscais (opcional)</label>
              <SelectInput v-model="dadosFiscaisId" class="form-select">
                <option :value="null">-- Nenhum --</option>
                <option v-for="d in dadosFiscaisList" :key="d.id" :value="d.id">{{ d.descricao }}</option>
              </SelectInput>
              <div class="small text-muted">Aplicado a todos os produtos desta categoria (pode ser sobrescrito por produto)</div>
            </div>

            <AvailabilityScheduler
              v-model:alwaysAvailable="alwaysAvailable"
              v-model:schedule="weeklySchedule"
            />

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
import SelectInput from '../components/form/select/SelectInput.vue'
import AvailabilityScheduler from '../components/AvailabilityScheduler.vue'

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
const selectedMenuIds = ref([])
const dadosFiscaisId = ref(null)
const dadosFiscaisList = ref([])
const alwaysAvailable = ref(true)
const weeklySchedule = ref([])

async function load(){
  if(!isEdit) return
  try{
    const res = await api.get(`/menu/categories/${id}`)
    const c = res.data
    if(c){
      name.value = c.name || '';
      description.value = c.description || '';
      position.value = c.position || 0;
      isActive.value = c.isActive ?? true;
      dadosFiscaisId.value = c.dadosFiscaisId || null;
      alwaysAvailable.value = c.alwaysAvailable !== false;
      weeklySchedule.value = Array.isArray(c.weeklySchedule) ? c.weeklySchedule : [];
      if (c.menuLinks) {
        selectedMenuIds.value = c.menuLinks.map(l => l.menuId || l.menu?.id).filter(Boolean)
      }
    }
  }catch(e){ console.error(e); error.value = 'Falha ao carregar categoria' }
}

async function loadDadosFiscais(){
  try{ const r = await api.get('/settings/dados-fiscais'); dadosFiscaisList.value = r.data || [] }catch(e){}
}

async function loadMenus(){
  try{
    const r = await api.get('/menu/menus')
    menus.value = r.data || []
    // fetch stores to build a simple map for display
    try{ const st = await api.get('/stores'); (st.data||[]).forEach(s=>storesMap[s.id]=s) }catch(e){}
  }catch(e){ console.warn('Failed to load menus', e) }
}

onMounted(() => {
  load()
  loadMenus()
  loadDadosFiscais()
  // Pre-select menu from query param when creating from a specific menu
  const qMenuId = route.query.menuId
  if (qMenuId && !isEdit) {
    selectedMenuIds.value = [qMenuId]
  }
})

function cancel(){
  const prevHistory = (typeof window !== 'undefined' && window.history && window.history.length > 1)
  if(prevHistory){ router.back(); return }
  const qMenu = route.query.menuId || (selectedMenuIds.value.length > 0 ? selectedMenuIds.value[0] : null)
  if(qMenu) router.push({ path: '/menu/admin', query: { menuId: qMenu } })
  else router.push({ path: '/menu/admin' })
}

async function save(){
  error.value = ''
  saving.value = true
  try{
    if(!name.value) { error.value = 'Nome é obrigatório'; return }
    const payload = {
      name: name.value,
      position: position.value,
      description: description.value,
      isActive: isActive.value,
      menuIds: selectedMenuIds.value,
      dadosFiscaisId: dadosFiscaisId.value,
      alwaysAvailable: !!alwaysAvailable.value,
      weeklySchedule: alwaysAvailable.value ? null : weeklySchedule.value,
    }
    if(isEdit){
      await api.patch(`/menu/categories/${id}`, payload)
      // sync menu links
      await api.post(`/menu/categories/${id}/menus`, { menuIds: selectedMenuIds.value })
      Swal.fire({ icon: 'success', text: 'Categoria atualizada' })
    } else {
      const res = await api.post('/menu/categories', payload)
      const created = res && res.data ? res.data : null
      Swal.fire({ icon: 'success', text: 'Categoria criada' })
      // If category was created for a specific menu, redirect back to the Menu Admin
      if(selectedMenuIds.value.length > 0){
        router.push({ path: '/menu/admin', query: { menuId: selectedMenuIds.value[0] } })
        return
      }
      // fallback: if no menu selected, try to go back, else generic admin
      const prevHistory = (typeof window !== 'undefined' && window.history && window.history.length > 1)
      if(prevHistory){ router.back(); return }
      router.push({ path: '/menu/admin' })
    }
  }catch(e){ console.error(e); error.value = e?.response?.data?.message || e.message || 'Erro' }
  finally{ saving.value = false }
}
</script>
