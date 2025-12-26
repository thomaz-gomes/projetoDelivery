<script setup>
import { ref, onMounted } from 'vue'
import api from '../api'

const modules = ref([])
const newModule = ref({ key: 'RIDERS', name: '', description: '' })

async function load(){
  const res = await api.get('/saas/modules')
  modules.value = res.data || []
}

onMounted(load)

async function createModule(){
  if(!newModule.value.name) return
  await api.post('/saas/modules', newModule.value)
  newModule.value = { key: 'RIDERS', name: '', description: '' }
  await load()
}

async function toggleActive(m){
  try{
    await api.put(`/saas/modules/${m.id}`, { isActive: !m.isActive })
    await load()
  }catch(e){ console.warn('Failed to toggle module active', e) }
}

async function editModule(m){
  try{
    const name = window.prompt('Nome do módulo', m.name);
    if (name === null) return;
    const description = window.prompt('Descrição', m.description || '')
    await api.put(`/saas/modules/${m.id}`, { name, description })
    await load()
  }catch(e){ console.warn('Failed to edit module', e) }
}

async function deleteModule(m){
  try{
    if (!window.confirm(`Remover módulo "${m.name}" ?`)) return;
    await api.delete(`/saas/modules/${m.id}`)
    await load()
  }catch(e){ console.warn('Failed to delete module', e) }
}
</script>

<template>
  <div class="container py-3">
    <h2 class="mb-3">Módulos</h2>

    <div class="row g-3">
      <div class="col-md-6">
        <div class="card">
          <div class="card-body">
            <h5 class="card-title">Criar módulo</h5>
            <div class="mb-2">
              <label class="form-label">Chave</label>
              <select v-model="newModule.key" class="form-select">
                <option value="RIDERS">Riders</option>
                <option value="AFFILIATES">Afiliados</option>
              </select>
            </div>
            <div class="mb-2">
              <label class="form-label">Nome</label>
              <input v-model="newModule.name" class="form-control" />
            </div>
            <div class="mb-2">
              <label class="form-label">Descrição</label>
              <textarea v-model="newModule.description" class="form-control"></textarea>
            </div>
            <button class="btn btn-primary" @click="createModule">Salvar módulo</button>
          </div>
        </div>
      </div>

      <div class="col-md-6">
        <div class="card">
          <div class="card-body">
            <h6>Módulos existentes</h6>
            <ul class="list-group">
              <li v-for="m in modules" :key="m.id" class="list-group-item d-flex justify-content-between align-items-center">
                <div>
                  <div class="fw-semibold">{{ m.key }} — {{ m.name }}</div>
                  <div class="small text-muted">{{ m.description }}</div>
                </div>
                <div>
                      <div class="btn-group" role="group">
                        <button class="btn btn-sm btn-outline-secondary" @click="editModule(m)">Editar</button>
                        <button class="btn btn-sm btn-outline-secondary" @click="toggleActive(m)">{{ m.isActive ? 'Desativar' : 'Ativar' }}</button>
                        <button class="btn btn-sm btn-outline-danger" @click="deleteModule(m)">Remover</button>
                      </div>
                </div>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
