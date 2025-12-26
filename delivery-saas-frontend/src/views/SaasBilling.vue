<script setup>
import { ref, onMounted } from 'vue'
import api from '../api'
import { useAuthStore } from '../stores/auth'

const auth = useAuthStore()
const subscription = ref(null)
const invoices = ref([])
const companies = ref([])
const selectedCompany = ref(null)

const page = ref(1)
const pageSize = ref(10)
const total = ref(0)
const yearFilter = ref('')
const monthFilter = ref('')
const statusFilter = ref('')

const newInvoice = ref({ year: new Date().getFullYear(), month: new Date().getMonth()+1, amount: 0, dueDate: '' })

async function load(){
  // default for regular ADMIN: load current company subscription and invoices with pagination & filters
  const subRes = await api.get('/saas/subscription/me')
  subscription.value = subRes.data || null
  const params = { page: page.value, pageSize: pageSize.value }
  if (yearFilter.value) params.year = yearFilter.value
  if (monthFilter.value) params.month = monthFilter.value
  if (statusFilter.value) params.status = statusFilter.value
  const invRes = await api.get('/saas/invoices', { params })
  invoices.value = invRes.data.rows || []
  total.value = invRes.data.total || 0
}

async function loadForCompany(companyId){
  try{
    const subRes = await api.get(`/saas/subscription/${companyId}`)
    subscription.value = subRes.data || null
  }catch(e){ subscription.value = null }
  try{
    const params = { companyId, page: page.value, pageSize: pageSize.value }
    if (yearFilter.value) params.year = yearFilter.value
    if (monthFilter.value) params.month = monthFilter.value
    if (statusFilter.value) params.status = statusFilter.value
    const invRes = await api.get('/saas/invoices', { params })
    invoices.value = invRes.data.rows || []
    total.value = invRes.data.total || 0
  }catch(e){ invoices.value = []; total.value = 0 }
}

onMounted(async () => {
  if (auth.user && String(auth.user.role || '').toUpperCase() === 'SUPER_ADMIN') {
    // load companies for selection
    const res = await api.get('/saas/companies')
    companies.value = res.data || []
    if (companies.value.length) {
      selectedCompany.value = companies.value[0].id
      await loadForCompany(selectedCompany.value)
    }
  } else {
    await load()
  }
})

async function markPaid(id){
  await api.post(`/saas/invoices/${id}/pay`)
  if (selectedCompany.value) await loadForCompany(selectedCompany.value)
  else await load()
}

async function createInvoice(){
  try{
    const payload = { companyId: selectedCompany.value, year: Number(newInvoice.value.year), month: Number(newInvoice.value.month), amount: Number(newInvoice.value.amount), dueDate: newInvoice.value.dueDate || null }
    await api.post('/saas/invoices', payload)
    if (selectedCompany.value) await loadForCompany(selectedCompany.value)
    else await load()
    newInvoice.value.amount = 0
  }catch(e){ console.warn('Failed to create invoice', e) }
}

async function editInvoice(inv){
  try{
    const year = window.prompt('Ano', String(inv.year))
    if (year === null) return
    const month = window.prompt('Mês (1-12)', String(inv.month))
    if (month === null) return
    const amount = window.prompt('Valor', String(inv.amount))
    if (amount === null) return
    const dueDate = window.prompt('Vencimento (YYYY-MM-DD)', inv.dueDate ? new Date(inv.dueDate).toISOString().slice(0,10) : '')
    if (dueDate === null) return
    const status = window.prompt('Status (PENDING, PAID, OVERDUE)', inv.status || 'PENDING')
    if (status === null) return
    await api.put(`/saas/invoices/${inv.id}`, { year: Number(year), month: Number(month), amount: Number(amount), dueDate: dueDate || null, status })
    if (selectedCompany.value) await loadForCompany(selectedCompany.value)
    else await load()
  }catch(e){ console.warn('Failed to edit invoice', e) }
}

async function deleteInvoice(inv){
  try{
    if (!window.confirm(`Remover fatura ${inv.month}/${inv.year} — R$ ${inv.amount} ?`)) return;
    await api.delete(`/saas/invoices/${inv.id}`)
    if (selectedCompany.value) await loadForCompany(selectedCompany.value)
    else await load()
  }catch(e){ console.warn('Failed to delete invoice', e) }
}

function totalPages(){ return Math.max(1, Math.ceil((total.value || 0) / pageSize.value)) }

function goToPage(p){ if (p<1) p=1; if (p>totalPages()) p=totalPages(); page.value = p; if (selectedCompany.value) return loadForCompany(selectedCompany.value); return load() }
</script>

<template>
  <div class="container py-3">
    <h2 class="mb-3">Mensalidades</h2>

    <div v-if="(auth && auth.user && String(auth.user.role||'').toUpperCase()==='SUPER_ADMIN')" class="mb-3">
      <label class="form-label">Empresa</label>
      <select class="form-select w-50 mb-2" v-model="selectedCompany" @change="loadForCompany(selectedCompany)">
        <option v-for="c in companies" :key="c.id" :value="c.id">{{ c.name }}</option>
      </select>
      <div class="card mb-3">
        <div class="card-body">
          <h6>Criar fatura</h6>
          <div class="row g-2 align-items-end">
            <div class="col-auto"><label class="form-label">Ano</label><input type="number" class="form-control" v-model.number="newInvoice.year" /></div>
            <div class="col-auto"><label class="form-label">Mês</label><input type="number" class="form-control" v-model.number="newInvoice.month" min="1" max="12" /></div>
            <div class="col-auto"><label class="form-label">Valor</label><input type="number" class="form-control" v-model.number="newInvoice.amount" step="0.01" /></div>
            <div class="col-auto"><label class="form-label">Vencimento</label><input type="date" class="form-control" v-model="newInvoice.dueDate" /></div>
            <div class="col-auto"><button class="btn btn-primary" @click="createInvoice">Criar fatura</button></div>
          </div>
        </div>
      </div>
    </div>

    <div class="card mb-3" v-if="subscription">
      <div class="card-body">
        <div><strong>Plano:</strong> {{ subscription.plan?.name }} — R$ {{ Number(subscription.plan?.price || 0).toFixed(2) }}</div>
        <div class="small text-muted">Próximo vencimento: {{ subscription.nextDueAt ? new Date(subscription.nextDueAt).toLocaleDateString() : '—' }}</div>
        <div class="mt-2 small">Módulos habilitados:
          <span v-for="pm in (subscription.plan?.modules||[])" :key="pm.moduleId" class="badge bg-secondary me-1">{{ pm.module?.name || pm.moduleId }}</span>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-body">
        <h6>Faturas</h6>
        <div class="row mb-2 g-2 align-items-end">
          <div class="col-auto">
            <label class="form-label">Ano</label>
            <input class="form-control" type="number" v-model="yearFilter" />
          </div>
          <div class="col-auto">
            <label class="form-label">Mês</label>
            <input class="form-control" type="number" v-model="monthFilter" min="1" max="12" />
          </div>
          <div class="col-auto">
            <label class="form-label">Status</label>
            <select class="form-select" v-model="statusFilter">
              <option value="">(todos)</option>
              <option value="PENDING">PENDING</option>
              <option value="PAID">PAID</option>
              <option value="OVERDUE">OVERDUE</option>
            </select>
          </div>
          <div class="col-auto">
            <label class="form-label">Por página</label>
            <select class="form-select" v-model.number="pageSize">
              <option :value="5">5</option>
              <option :value="10">10</option>
              <option :value="25">25</option>
            </select>
          </div>
          <div class="col-auto">
            <button class="btn btn-outline-secondary" @click="page=1; if(selectedCompany) loadForCompany(selectedCompany) ; else load()">Filtrar</button>
          </div>
        </div>
        <table class="table table-sm">
          <thead>
            <tr><th>Mês</th><th>Valor</th><th>Status</th><th>Ações</th></tr>
          </thead>
          <tbody>
            <tr v-for="i in invoices" :key="i.id">
              <td>{{ i.month }}/{{ i.year }}</td>
              <td>R$ {{ Number(i.amount).toFixed(2) }}</td>
              <td>{{ i.status }}</td>
              <td>
                <button v-if="i.status!=='PAID'" class="btn btn-sm btn-success me-1" @click="markPaid(i.id)">Marcar como pago</button>
                <button v-if="auth.user && String(auth.user.role||'').toUpperCase()==='SUPER_ADMIN'" class="btn btn-sm btn-outline-secondary me-1" @click="editInvoice(i)">Editar</button>
                <button v-if="auth.user && String(auth.user.role||'').toUpperCase()==='SUPER_ADMIN'" class="btn btn-sm btn-outline-danger" @click="deleteInvoice(i)">Remover</button>
              </td>
            </tr>
          </tbody>
        </table>
        <div class="d-flex justify-content-between align-items-center">
          <div class="small text-muted">Total: {{ total }} faturas</div>
          <div>
            <button class="btn btn-sm btn-outline-secondary me-2" :disabled="page<=1" @click="goToPage(page-1)">Anterior</button>
            <span class="mx-2">Página {{ page }} / {{ totalPages() }}</span>
            <button class="btn btn-sm btn-outline-secondary ms-2" :disabled="page>=totalPages()" @click="goToPage(page+1)">Próxima</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
