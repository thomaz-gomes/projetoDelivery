<script setup>
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import api from '../api'

const route = useRoute()
const router = useRouter()
const id = route.params.id
const company = ref(null)
const plans = ref([])
const subscription = ref(null)
const form = ref({ name: '', slug: '', planId: '', nextDueAt: '', period: 'MONTHLY' })

async function load(){
  // fetch company
  try {
    const [cRes, pRes, sRes] = await Promise.all([
      api.get(`/saas/companies/${id}`),
      api.get('/saas/plans'),
      api.get(`/saas/subscription/${id}`).catch(()=>({ data: null }))
    ])
    const row = cRes.data
    if (!row) { router.push('/saas/companies'); return }
    company.value = row
    plans.value = pRes.data || []
    subscription.value = sRes && sRes.data ? sRes.data : null
    form.value = {
      name: row.name || '',
      slug: row.slug || '',
      planId: subscription.value ? (subscription.value.planId || (subscription.value.plan && subscription.value.plan.id) ) : '',
      nextDueAt: subscription.value && subscription.value.nextDueAt ? new Date(subscription.value.nextDueAt).toISOString().slice(0,10) : '',
      period: subscription.value && subscription.value.period ? subscription.value.period : 'MONTHLY'
    }
  } catch (e) {
    console.error('Failed to load company edit data', e)
    router.push('/saas/companies')
  }
}

onMounted(load)

async function submit(){
  // update company
  await api.put(`/saas/companies/${id}`, { name: form.value.name, slug: form.value.slug })
  // update or create subscription
  if (form.value.planId) {
    await api.post('/saas/subscriptions', { companyId: id, planId: form.value.planId, nextDueAt: form.value.nextDueAt || null, period: form.value.period })
  }
  router.push('/saas/companies')
}

async function suspend(){
  if (!confirm('Suspender empresa?')) return
  await api.post(`/saas/companies/${id}/suspend`, { suspend: true })
  router.push('/saas/companies')
}

async function removeCompany(){
  if (!confirm('Excluir (soft-delete) empresa?')) return
  await api.delete(`/saas/companies/${id}`)
  router.push('/saas/companies')
}
</script>

<template>
  <div class="container py-3">
    <h2 class="mb-3">Editar Empresa</h2>
    <div class="card">
        <div class="card-body">
          <div class="row g-2">
            <div class="col-md-6">
              <label class="form-label">Nome da empresa</label>
              <input v-model="form.name" class="form-control" />
            </div>
            <div class="col-md-6">
              <label class="form-label">Slug (opcional)</label>
              <input v-model="form.slug" class="form-control" />
            </div>
          </div>

          <div class="row g-2 mt-3">
            <div class="col-md-6">
              <label class="form-label">Plano</label>
              <select v-model="form.planId" class="form-select">
                <option value="">Sem assinatura</option>
                <option v-for="p in plans" :key="p.id" :value="p.id">{{ p.name }} - {{ p.description || '' }}</option>
              </select>
            </div>
            <div class="col-md-3">
              <label class="form-label">Recorrência</label>
              <select v-model="form.period" class="form-select">
                <option value="MONTHLY">Mensal</option>
                <option value="YEARLY">Anual</option>
              </select>
            </div>
            <div class="col-md-3">
              <label class="form-label">Próxima cobrança</label>
              <input type="date" v-model="form.nextDueAt" class="form-control" />
            </div>
          </div>

          <div class="mt-3">
            <button class="btn btn-primary" @click="submit">Salvar</button>
            <button class="btn btn-warning ms-2" @click="suspend">Suspender</button>
            <button class="btn btn-danger ms-2" @click="removeCompany">Excluir</button>
            <router-link class="btn btn-link ms-2" to="/saas/companies">Voltar</router-link>
          </div>
        </div>
      </div>
  </div>
</template>
