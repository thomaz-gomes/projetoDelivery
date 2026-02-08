<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import api from '../api'

const router = useRouter()
const plans = ref([])
const form = ref({ name: '', masterName: '', masterEmail: '', masterPassword: '', planId: '' })

async function loadPlans(){
  const res = await api.get('/saas/plans')
  plans.value = res.data || []
}

loadPlans()

async function submit(){
  if(!form.value.name || !form.value.masterName || !form.value.masterEmail || !form.value.masterPassword) return
  await api.post('/saas/companies', form.value)
  router.push('/saas/companies')
}
</script>

<template>
  <div class="container py-3">
    <h2 class="mb-3">Criar Empresa</h2>
    <div class="card">
      <div class="card-body">
        <div class="row g-2">
          <div class="col-md-6">
            <label class="form-label">Nome da empresa</label>
            <input v-model="form.name" class="form-control" />
          </div>
          <div class="col-md-6">
            <label class="form-label">Plano (opcional)</label>
            <select v-model="form.planId" class="form-select">
              <option value="">(sem plano)</option>
              <option v-for="p in plans" :key="p.id" :value="p.id">{{ p.name }}</option>
            </select>
          </div>
          <div class="col-md-4">
            <label class="form-label">Usuário master (nome)</label>
            <input v-model="form.masterName" class="form-control" />
          </div>
          <div class="col-md-4">
            <label class="form-label">E-mail do master</label>
            <input v-model="form.masterEmail" type="email" class="form-control" />
          </div>
          <div class="col-md-4">
            <label class="form-label">Senha do master</label>
            <input v-model="form.masterPassword" type="password" class="form-control" />
          </div>
        </div>
        <div class="mt-3">
          <button class="btn btn-primary" @click="submit">Criar</button>
          <router-link class="btn btn-link ms-2" to="/saas/companies">Voltar</router-link>
        </div>
      </div>
    </div>
  </div>
</template>
