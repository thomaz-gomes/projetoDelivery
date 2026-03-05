<script setup>
import { ref, onMounted, computed } from 'vue'
import api from '../api'
import { useAuthStore } from '../stores/auth'
import { useAddOnStoreStore } from '../stores/addOnStore'
import Swal from 'sweetalert2'

const auth = useAuthStore()
const addOnStore = useAddOnStoreStore()
const payingInvoice = ref(null)
const subscription = ref(null)
const invoices = ref([])
const companies = ref([])
const selectedCompany = ref(null)
const expandedInvoice = ref(null)

// Module subscriptions (ADMIN)
const moduleSubs = ref([])
const loadingModuleSubs = ref(false)

const page = ref(1)
const pageSize = ref(10)
const total = ref(0)
const yearFilter = ref('')
const monthFilter = ref('')
const statusFilter = ref('')

const newInvoice = ref({ year: new Date().getFullYear(), month: new Date().getMonth()+1, amount: 0, dueDate: '' })

const isSuperAdmin = computed(() => auth.user && String(auth.user.role || '').toUpperCase() === 'SUPER_ADMIN')
const isAdmin = computed(() => auth.user && ['ADMIN', 'SUPER_ADMIN'].includes(String(auth.user.role || '').toUpperCase()))

async function load(){
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

async function loadModuleSubs() {
  if (!isAdmin.value || isSuperAdmin.value) return
  loadingModuleSubs.value = true
  try {
    const res = await api.get('/saas/module-subscriptions/me')
    moduleSubs.value = res.data || []
  } catch (e) { moduleSubs.value = [] }
  finally { loadingModuleSubs.value = false }
}

async function cancelModuleSub(sub) {
  const result = await Swal.fire({
    title: `Cancelar módulo "${sub.module?.name || sub.moduleId}"?`,
    text: 'O módulo ficará indisponível após o cancelamento.',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#dc3545',
    confirmButtonText: 'Sim, cancelar',
    cancelButtonText: 'Voltar'
  })
  if (!result.isConfirmed) return
  try {
    await api.delete(`/saas/module-subscriptions/${sub.moduleId}`)
    await loadModuleSubs()
    Swal.fire({ icon: 'success', title: 'Cancelado', timer: 1500, showConfirmButton: false })
  } catch (e) {
    Swal.fire({ icon: 'error', title: 'Erro', text: e?.response?.data?.message || 'Falha ao cancelar' })
  }
}

onMounted(async () => {
  if (isSuperAdmin.value) {
    const res = await api.get('/saas/companies')
    companies.value = res.data || []
    if (companies.value.length) {
      selectedCompany.value = companies.value[0].id
      await loadForCompany(selectedCompany.value)
    }
  } else {
    await load()
    await loadModuleSubs()
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
    if (!window.confirm(`Remover fatura ${inv.month}/${inv.year} -- R$ ${inv.amount} ?`)) return;
    await api.delete(`/saas/invoices/${inv.id}`)
    if (selectedCompany.value) await loadForCompany(selectedCompany.value)
    else await load()
  }catch(e){ console.warn('Failed to delete invoice', e) }
}

function toggleInvoiceItems(id) {
  expandedInvoice.value = expandedInvoice.value === id ? null : id
}

function totalPages(){ return Math.max(1, Math.ceil((total.value || 0) / pageSize.value)) }

function goToPage(p){ if (p<1) p=1; if (p>totalPages()) p=totalPages(); page.value = p; if (selectedCompany.value) return loadForCompany(selectedCompany.value); return load() }

function itemTypeLabel(type) {
  const labels = { PLAN: 'Plano', MODULE: 'Módulo', CREDIT_PACK: 'Pacote de Créditos' }
  return labels[type] || type
}

async function payInvoice(invoice) {
  payingInvoice.value = invoice.id
  try {
    await addOnStore.payInvoice(invoice.id)
  } catch (e) {
    alert(e?.response?.data?.message || 'Erro ao iniciar pagamento')
  } finally {
    payingInvoice.value = null
  }
}
</script>

<template>
  <div class="container py-3">
    <h2 class="mb-3">Mensalidades</h2>

    <div v-if="isSuperAdmin" class="mb-3">
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

    <!-- Module Subscriptions (ADMIN only) -->
    <div v-if="isAdmin && !isSuperAdmin" class="card mb-3">
      <div class="card-header">
        <h6 class="mb-0"><i class="bi bi-box-seam me-2"></i>Módulos Assinados</h6>
      </div>
      <div class="card-body">
        <div v-if="loadingModuleSubs" class="text-center py-3">
          <div class="spinner-border spinner-border-sm text-primary"></div>
        </div>
        <div v-else-if="moduleSubs.length === 0" class="text-muted small">
          Nenhum módulo assinado individualmente.
          <router-link to="/store" class="text-primary">Ver loja de add-ons</router-link>
        </div>
        <table v-else class="table table-sm mb-0">
          <thead>
            <tr>
              <th>Módulo</th>
              <th>Período</th>
              <th>Próximo vencimento</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="sub in moduleSubs" :key="sub.id">
              <td>
                <strong>{{ sub.module?.name || sub.moduleId }}</strong>
              </td>
              <td>{{ sub.period || '--' }}</td>
              <td>{{ sub.nextDueAt ? new Date(sub.nextDueAt).toLocaleDateString() : '--' }}</td>
              <td>
                <button class="btn btn-sm btn-outline-danger" @click="cancelModuleSub(sub)">
                  <i class="bi bi-x-lg me-1"></i>Cancelar
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="card mb-3" v-if="subscription">
      <div class="card-body">
        <div><strong>Plano:</strong> {{ subscription.plan?.name }} -- R$ {{ Number(subscription.plan?.price || 0).toFixed(2) }}</div>
        <div class="small text-muted">Próximo vencimento: {{ subscription.nextDueAt ? new Date(subscription.nextDueAt).toLocaleDateString() : '--' }}</div>
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
            <tr><th>Mês</th><th>Valor</th><th>Status</th><th>Itens</th><th>Ações</th></tr>
          </thead>
          <tbody>
            <template v-for="i in invoices" :key="i.id">
              <tr>
                <td>{{ i.month }}/{{ i.year }}</td>
                <td>R$ {{ Number(i.amount).toFixed(2) }}</td>
                <td>
                  <span class="badge" :class="{ 'bg-success': i.status === 'PAID', 'bg-warning text-dark': i.status === 'PENDING', 'bg-danger': i.status === 'OVERDUE' }">
                    {{ i.status }}
                  </span>
                </td>
                <td>
                  <button
                    v-if="i.items && i.items.length"
                    class="btn btn-sm btn-outline-secondary"
                    @click="toggleInvoiceItems(i.id)"
                  >
                    <i class="bi" :class="expandedInvoice === i.id ? 'bi-chevron-up' : 'bi-chevron-down'"></i>
                    {{ i.items.length }} {{ i.items.length === 1 ? 'item' : 'itens' }}
                  </button>
                  <span v-else class="text-muted small">--</span>
                </td>
                <td>
                  <button
                    v-if="i.status === 'PENDING'"
                    class="btn btn-sm btn-primary me-1"
                    :disabled="payingInvoice === i.id"
                    @click="payInvoice(i)"
                  >
                    <span v-if="payingInvoice === i.id" class="spinner-border spinner-border-sm me-1"></span>
                    Pagar
                  </button>
                  <button v-if="i.status!=='PAID'" class="btn btn-sm btn-success me-1" @click="markPaid(i.id)">Marcar como pago</button>
                  <button v-if="isSuperAdmin" class="btn btn-sm btn-outline-secondary me-1" @click="editInvoice(i)">Editar</button>
                  <button v-if="isSuperAdmin" class="btn btn-sm btn-outline-danger" @click="deleteInvoice(i)">Remover</button>
                </td>
              </tr>
              <!-- Invoice line items (collapsible) -->
              <tr v-if="expandedInvoice === i.id && i.items && i.items.length">
                <td colspan="5" class="bg-light p-0">
                  <table class="table table-sm table-borderless mb-0 ms-4" style="max-width: 90%;">
                    <thead>
                      <tr class="text-muted small">
                        <th>Tipo</th>
                        <th>Descrição</th>
                        <th>Valor</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="item in i.items" :key="item.id" class="small">
                        <td><span class="badge bg-secondary">{{ itemTypeLabel(item.type) }}</span></td>
                        <td>{{ item.description }}</td>
                        <td>R$ {{ Number(item.amount).toFixed(2) }}</td>
                      </tr>
                    </tbody>
                  </table>
                </td>
              </tr>
            </template>
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
