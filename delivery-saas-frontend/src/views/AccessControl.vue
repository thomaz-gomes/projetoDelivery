<template>
  <div class="container py-3">
    <div class="d-flex justify-content-between align-items-center mb-3">
      <h4>Gestão de Acessos</h4>
      <div>
        <button class="btn btn-outline-secondary me-2" @click="loadAll">Recarregar</button>
        <button class="btn btn-primary" @click="save" :disabled="saving">Salvar</button>
      </div>
    </div>

    <div v-if="loading" class="text-center">Carregando...</div>

    <div v-else class="row">
      <div class="col-md-3">
        <ul class="list-group">
          <li v-for="r in roles" :key="r" @click="selectRole(r)" :class="['list-group-item', { active: r===selectedRole }]" style="cursor:pointer">{{ r }}</li>
        </ul>
      </div>
      <div class="col-md-9">
        <h6>Permissões disponíveis</h6>
        <div v-if="!mapping[selectedRole]">Nenhuma permissão definida para essa role.</div>
        <div v-else>
          <div class="row">
            <div v-for="perm in permissions" :key="perm" class="col-md-4 mb-2">
              <div class="form-check">
                <input class="form-check-input" type="checkbox" :id="perm" :value="perm" v-model="mapping[selectedRole]">
                <label class="form-check-label" :for="perm">
                  <strong>{{ (permMeta && permMeta[perm] && permMeta[perm].label) || perm }}</strong>
                  <div class="small text-muted">{{ (permMeta && permMeta[perm] && permMeta[perm].description) || '' }}</div>
                </label>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import api from '../api'

const roles = ref([])
const permissions = ref([])
const mapping = ref({})
const permMeta = ref({})

// defensive: ensure permMeta is always an object
if (!permMeta.value) permMeta.value = {}
const selectedRole = ref('')
const loading = ref(false)
const saving = ref(false)

async function loadAll(){
  loading.value = true
  try{
    const res = await api.get('/roles/available')
    roles.value = res.data.roles || []
    permissions.value = res.data.permissions || []
    const rmap = await api.get('/roles/permissions')
    mapping.value = rmap.data || {}
    // fetch permission metadata
    try{
      const pm = await api.get('/roles/permissions/meta')
      permMeta.value = pm.data || {}
    }catch(_){ permMeta.value = {} }
    // ensure arrays for all roles
    for(const r of roles.value) mapping.value[r] = mapping.value[r] || []
    selectedRole.value = roles.value[0] || ''
  }catch(e){
    console.error(e)
    alert(e?.response?.data?.message || 'Erro ao carregar roles/perms')
  }finally{ loading.value = false }
}

function selectRole(r){ selectedRole.value = r }

async function save(){
  if(!confirm('Salvar alterações nas permissões?')) return
  saving.value = true
  try{
    await api.put('/roles/permissions', mapping.value)
    alert('Permissões salvas')
  }catch(e){ console.error(e); alert(e?.response?.data?.message || 'Erro ao salvar') }
  finally{ saving.value = false }
}

onMounted(()=>{ loadAll() })
</script>

<style scoped>
/* simple spacing for page */
.list-group-item.active { background-color: #0d6efd; border-color: #0d6efd; }
</style>
