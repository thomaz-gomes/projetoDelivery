<template>
  <div class="container py-3">
    <div class="d-flex justify-content-between align-items-center mb-3">
        <h4>Usuários</h4>
        <div>
          <button class="btn btn-outline-secondary me-2" @click="openPermissions">Permissões por role</button>
          <button class="btn btn-primary" @click="openNew">Novo usuário</button>
        </div>
      </div>

      <div class="row mb-3">
        <div class="col-md-6 mb-2">
          <TextInput v-model="query" placeholder="Pesquisar por nome ou email" inputClass="form-control" />
        </div>
        <div class="col-md-2 mb-2">
          <SelectInput  class="form-select"  v-model.number="pageSize" >
            <option :value="5">5 / página</option>
            <option :value="10">10 / página</option>
            <option :value="20">20 / página</option>
          </SelectInput>
        </div>
      </div>

      <div v-if="loading" class="text-center">Carregando...</div>
      <table v-else class="table table-striped">
        <thead>
          <tr><th>Nome</th><th>Email</th><th>Role</th><th>Atualizado</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="u in paginatedUsers" :key="u.id">
            <td>{{ u.name }}</td>
            <td>{{ u.email }}</td>
            <td>{{ u.role }}</td>
            <td>{{ formatDate(u.updatedAt || u.createdAt) }}</td>
            <td class="text-end">
              <button class="btn btn-sm btn-outline-secondary me-2" @click="edit(u)">Editar</button>
              <button class="btn btn-sm btn-outline-danger" @click="remove(u)" v-if="canDelete">Remover</button>
            </td>
          </tr>
        </tbody>
      </table>

      <nav v-if="totalPages > 1" class="d-flex justify-content-end">
        <ul class="pagination">
          <li class="page-item" :class="{ disabled: page===1 }"><a class="page-link" href="#" @click.prevent="page = page - 1">Anterior</a></li>
          <li v-for="p in totalPages" :key="p" class="page-item" :class="{ active: p===page }"><a class="page-link" href="#" @click.prevent="page = p">{{ p }}</a></li>
          <li class="page-item" :class="{ disabled: page===totalPages }"><a class="page-link" href="#" @click.prevent="page = page + 1">Próxima</a></li>
        </ul>
      </nav>

  <div v-if="showForm" class="modal-backdrop d-block" style="background: rgba(0,0,0,0.4);">
      <div class="modal d-block" tabindex="-1" style="max-width:600px;margin:80px auto;">
        <div class="modal-dialog">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title">{{ editing ? 'Editar usuário' : 'Novo usuário' }}</h5>
              <button type="button" class="btn-close" @click="closeForm"></button>
            </div>
            <div class="modal-body">
              <div class="mb-2"><TextInput label="Nome" labelClass="form-label" v-model="form.name" inputClass="form-control" /></div>
                <div class="mb-2">
                  <TextInput label="Email" labelClass="form-label" v-model="form.email" inputClass="form-control" />
                  <div v-if="emailError" class="form-text text-danger">{{ emailError }}</div>
                </div>
                <div class="mb-2"><TextInput label="Whatsapp" labelClass="form-label" v-model="form.whatsapp" inputClass="form-control" /></div>
                <div class="mb-2"><label class="form-label">Role</label>
                <SelectInput  class="form-select"  v-model="form.role" >
                  <option value="ADMIN">Admin</option>
                  <option value="ATTENDANT">Atendimento</option>
                </SelectInput>
              </div>
              <div class="mb-2" v-if="!editing"><TextInput label="Senha (opcional)" labelClass="form-label" v-model="form.password" inputClass="form-control" /></div>
            </div>
            <div class="modal-footer">
              <button class="btn btn-outline-secondary" @click="closeForm">Cancelar</button>
              <button class="btn btn-primary" @click="save">Salvar</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Permissions modal -->
    <div v-if="showPermissions" class="modal-backdrop d-block" style="background: rgba(0,0,0,0.4);">
      <div class="modal d-block" tabindex="-1" style="max-width:900px;margin:40px auto;">
        <div class="modal-dialog modal-lg">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title">Permissões por role</h5>
              <button type="button" class="btn-close" @click="closePermissions"></button>
            </div>
            <div class="modal-body">
              <div v-if="permLoading">Carregando...</div>
              <div v-else>
                <div class="row">
                  <div class="col-md-4">
                    <ul class="list-group">
                      <li v-for="r in rolesList" :key="r" @click="selectedRole = r" :class="['list-group-item', { active: selectedRole===r }]" style="cursor:pointer">{{ r }}</li>
                    </ul>
                  </div>
                  <div class="col-md-8">
                    <h6>Permissões para <strong>{{ selectedRole }}</strong></h6>
                    <div v-if="!mapping[selectedRole]">Nenhuma permissão definida</div>
                    <div v-else>
                      <div v-for="perm in allPerms" :key="perm" class="form-check mb-1">
                        <input class="form-check-input" type="checkbox" :id="perm" :value="perm" v-model="mapping[selectedRole]">
                        <label class="form-check-label" :for="perm">
                          <strong>{{ permMeta[perm]?.label || perm }}</strong>
                          <div class="small text-muted">{{ permMeta[perm]?.description || '' }}</div>
                        </label>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div class="modal-footer">
              <button class="btn btn-outline-secondary" @click="closePermissions">Fechar</button>
              <button class="btn btn-primary" @click="savePermissions">Salvar</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, computed, watch } from 'vue'
import api from '../api'
import { formatDateTime } from '../utils/dates'
import { useAuthStore } from '../stores/auth'

const auth = useAuthStore()
const users = ref([])
const loading = ref(false)
const showForm = ref(false)
const editing = ref(false)
const form = ref({ id: null, name: '', email: '', whatsapp: '', role: 'ADMIN', password: '' })

// search & pagination
const query = ref('')
const page = ref(1)
const pageSize = ref(10)

const emailError = ref('')

const canDelete = computed(() => auth.user && auth.user.role === 'SUPER_ADMIN')

const formatDate = (d) => { if(!d) return ''; try{ return formatDateTime(d) }catch(e){ return d } }

async function load(){
  loading.value = true
  try{ const res = await api.get('/users'); users.value = res.data || [] }catch(e){ console.error(e) }finally{ loading.value = false }
}

function openNew(){ editing.value = false; form.value = { id: null, name: '', email: '', whatsapp: '', role: 'ADMIN', password: '' }; emailError.value = ''; showForm.value = true }
function closeForm(){ showForm.value = false }
function edit(u){ editing.value = true; form.value = { id: u.id, name: u.name, email: u.email, whatsapp: u.whatsapp || '', role: u.role, password: '' }; emailError.value = ''; showForm.value = true }

function validateEmail(e){
  if(!e) return 'Email obrigatório'
  // simple regex
  const re = /^(([^<>()\[\]\\.,;:\s@\"]+(\.[^<>()\[\]\\.,;:\s@\"]+)*)|(".+"))@(([^<>()[\]\\.,;:\s@\"]+\.)+[^<>()[\]\\.,;:\s@\"]{2,})$/i
  return re.test(String(e).toLowerCase()) ? '' : 'Email inválido'
}

async function save(){
  try{
    emailError.value = validateEmail(form.value.email)
    if(!form.value.name || emailError.value) return
    if(editing.value){
      const body = { name: form.value.name, email: form.value.email, whatsapp: form.value.whatsapp, role: form.value.role }
      if(form.value.password) body.password = form.value.password
      await api.put(`/users/${form.value.id}`, body)
    } else {
      const body = { name: form.value.name, email: form.value.email, whatsapp: form.value.whatsapp, role: form.value.role }
      if(form.value.password) body.password = form.value.password
      await api.post('/users', body)
    }
    await load()
    closeForm()
  }catch(e){ console.error(e); alert(e?.response?.data?.message || 'Erro') }
}

async function remove(u){ if(!confirm('Remover usuário?')) return; try{ await api.delete(`/users/${u.id}`); await load() }catch(e){ console.error(e); alert(e?.response?.data?.message || 'Erro') } }

// computed: filtered + pagination
const filteredUsers = computed(() => {
  const q = String(query.value || '').trim().toLowerCase()
  if(!q) return users.value.slice()
  return users.value.filter(u => (u.name||'').toLowerCase().includes(q) || (u.email||'').toLowerCase().includes(q))
})

const totalPages = computed(() => Math.max(1, Math.ceil(filteredUsers.value.length / pageSize.value)))

watch([query, pageSize], () => { page.value = 1 })

const paginatedUsers = computed(() => {
  const p = Math.max(1, page.value)
  const start = (p - 1) * pageSize.value
  return filteredUsers.value.slice(start, start + pageSize.value)
})

// Permissions modal state
const showPermissions = ref(false)
const permLoading = ref(false)
const mapping = ref({})
const rolesList = ['SUPER_ADMIN','ADMIN','ATTENDANT','RIDER','AFFILIATE']
const permMeta = ref({})
const allPerms = computed(() => Object.keys(permMeta.value).length ? Object.keys(permMeta.value) : ['users:read','users:create','users:update','users:delete','orders:view','orders:update','menu:edit','settings:update','customers:view'])
const selectedRole = ref(rolesList[0])

async function openPermissions(){
  showPermissions.value = true
  permLoading.value = true
  try{
    const res = await api.get('/roles/permissions')
    mapping.value = res.data || {}
    // ensure arrays
    for(const r of rolesList) mapping.value[r] = mapping.value[r] || []
    selectedRole.value = rolesList[0]
    // load permission metadata
    try{
      const pm = await api.get('/roles/permissions/meta')
      permMeta.value = pm.data || {}
    }catch(_){ permMeta.value = {} }
  }catch(e){ console.error(e); alert(e?.response?.data?.message || 'Erro ao carregar permissões') }
  finally{ permLoading.value = false }
}

function closePermissions(){ showPermissions.value = false }

async function savePermissions(){
  try{
    await api.put('/roles/permissions', mapping.value)
    alert('Permissões salvas')
    closePermissions()
  }catch(e){ console.error(e); alert(e?.response?.data?.message || 'Erro ao salvar permissões') }
}

onMounted(()=>{ load() })
</script>

<style scoped>
.modal-backdrop { position: fixed; inset: 0; display: flex; align-items: flex-start; justify-content: center; }
</style>
