<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import api from '../api'

const router = useRouter()
const companies = ref([])
const plans = ref([])
const invoices = ref([])

async function load(){
  const [cRes, pRes, iRes] = await Promise.all([
    api.get('/saas/companies'),
    api.get('/saas/plans'),
    api.get('/saas/invoices').catch(() => ({ data: [] }))
  ])
  companies.value = cRes.data || []
  plans.value = pRes.data || []
  invoices.value = iRes.data || []
}

onMounted(load)

function go(path){ router.push(path) }
</script>

<template>
  <div class="container py-3">
    <div class="d-flex justify-content-between align-items-center mb-3">
      <h2>SaaS — Administração</h2>
      <div>
        <button class="btn btn-outline-primary me-2" @click="go('/saas/plans')">Planos & Módulos</button>
        <button class="btn btn-outline-primary me-2" @click="go('/saas/companies')">Empresas</button>
        <button class="btn btn-outline-primary" @click="go('/saas/billing')">Mensalidades</button>
      </div>
    </div>

    <div class="row g-3 mb-3">
      <div class="col-md-4">
        <div class="card p-3">
          <div class="h1 mb-0">{{ companies.length }}</div>
          <div class="text-muted">Empresas</div>
        </div>
      </div>
      <div class="col-md-4">
        <div class="card p-3">
          <div class="h1 mb-0">{{ plans.length }}</div>
          <div class="text-muted">Planos</div>
        </div>
      </div>
      <div class="col-md-4">
        <div class="card p-3">
          <div class="h1 mb-0">{{ invoices.length }}</div>
          <div class="text-muted">Faturas</div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-body">
        <h6>Últimas faturas</h6>
        <table class="table table-sm">
          <thead><tr><th>Empresa</th><th>Mês</th><th>Valor</th><th>Status</th></tr></thead>
          <tbody>
            <tr v-for="inv in invoices" :key="inv.id">
              <td>{{ inv.company?.name || inv.companyId }}</td>
              <td>{{ inv.month }}/{{ inv.year }}</td>
              <td>R$ {{ Number(inv.amount).toFixed(2) }}</td>
              <td>{{ inv.status }}</td>
            </tr>
            <tr v-if="invoices.length===0"><td colspan="4" class="text-muted">Nenhuma fatura encontrada</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
