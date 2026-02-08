<script setup>
import { ref, onMounted, computed } from 'vue';
import { useCustomersStore } from '../stores/customers';
import { useRouter } from 'vue-router';
import { formatCurrency, formatDate } from '../utils/formatters.js';
import BaseButton from '../components/BaseButton.vue';
import ListCard from '../components/ListCard.vue';
import Swal from 'sweetalert2'

const store = useCustomersStore();
const router = useRouter();

const q = ref('');
const error = ref('');
const loading = ref(false)

const limit = ref(20)
const offset = ref(0)
const total = ref(0)

const load = async () => {
  loading.value = true
  error.value = ''
  try{
    const token = localStorage.getItem('token')
    if(!token){ router.push({ path: '/login', query: { redirect: '/customers' } }); return }
    await store.fetch()
    let list = store.list || []
    if(q.value) list = list.filter(c => (c.fullName||'').toLowerCase().includes(q.value.toLowerCase()) || (c.whatsapp||'').includes(q.value) || (c.cpf||'').includes(q.value))
    total.value = list.length
  }catch(e){ console.error('Failed to fetch customers', e); error.value = e?.response?.data?.message || 'Falha ao carregar clientes' }
  finally{ loading.value = false }
}

onMounted(()=> load())

function goNew(){ router.push('/customers/new') }
function goProfile(id){ router.push(`/customers/${id}`) }

function onQuickSearch(val){ q.value = val; offset.value = 0; load() }
function onQuickClear(){ resetFilters() }

async function onImport(e){
  const file = e.target.files?.[0]
  if(!file) return
  try{
    const res = await store.importFile(file)
    await load()
    Swal.fire({ icon:'success', text: `Importação: criados ${res.created}, atualizados ${res.updated}.` })
  }catch(e){ console.error(e); Swal.fire({ icon:'error', text: 'Falha ao importar' }) }
}

const resetFilters = () => { q.value=''; offset.value=0; load() }
const nextPage = () => { if(offset.value + limit.value < total.value) offset.value += limit.value }
const prevPage = () => { offset.value = Math.max(0, offset.value - limit.value) }

const displayed = computed(()=>{
  let list = store.list || []
  if(q.value) list = list.filter(c => (c.fullName||'').toLowerCase().includes(q.value.toLowerCase()) || (c.whatsapp||'').includes(q.value) || (c.cpf||'').includes(q.value))
  total.value = list.length
  return list.slice(offset.value, offset.value + limit.value)
})

function editCustomer(id){ router.push(`/customers/${id}/edit`) }

const tierColors = {
  em_risco: '#dc3545',
  regular: '#ffc107',
  fiel: '#0d6efd',
  vip: '#198754',
}

const tierBgColors = {
  em_risco: 'rgba(220,53,69,0.1)',
  regular: 'rgba(255,193,7,0.1)',
  fiel: 'rgba(13,110,253,0.1)',
  vip: 'rgba(25,135,84,0.1)',
}

function starsHtml(stars) {
  return '★'.repeat(stars) + '☆'.repeat(4 - stars)
}
</script>

<template>
  <ListCard :title="`Clientes (${total || store.list.length})`" icon="bi bi-people" :subtitle="total ? `${total} clientes cadastrados` : ''" :quickSearch="true" quickSearchPlaceholder="Buscar por nome, CPF, WhatsApp" @quick-search="onQuickSearch" @quick-clear="onQuickClear">
    <template #actions>
      <div class="d-flex align-items-center gap-2">
        <label class="btn btn-outline-secondary btn-sm mb-0">
          <i class="bi bi-upload me-1"></i> Importar
          <input type="file" accept=".csv,.xlsx,.xls" class="d-none" @change="onImport" />
        </label>
        <button class="btn btn-primary" @click="goNew"><i class="bi bi-plus-lg me-1"></i> Novo cliente</button>
      </div>
    </template>

    <template #default>
      <div v-if="loading" class="text-center py-4">
        <div class="spinner-border spinner-border-sm text-secondary me-2"></div>
        Carregando...
      </div>
      <div v-else-if="error" class="alert alert-danger">{{ error }}</div>
      <div v-else>
        <div class="table-responsive">
          <table class="table table-hover align-middle mb-0 customers-table">
            <thead>
              <tr>
                <th>Cliente</th>
                <th>WhatsApp</th>
                <th class="text-center">Pedidos</th>
                <th class="text-end">Total gasto</th>
                <th class="text-center">Classificação</th>
                <th style="width:120px">Ações</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in displayed" :key="c.id" class="customer-row" @click="goProfile(c.id)">
                <td>
                  <div class="d-flex align-items-center gap-2">
                    <div class="customer-avatar" :style="{ background: tierBgColors[c.stats?.tier] || '#f0f0f0', color: tierColors[c.stats?.tier] || '#666' }">
                      {{ (c.fullName || '?')[0].toUpperCase() }}
                    </div>
                    <div>
                      <div class="fw-semibold">{{ c.fullName }}</div>
                      <div class="text-muted small">{{ c.cpf || '' }}</div>
                    </div>
                  </div>
                </td>
                <td>
                  <span v-if="c.whatsapp || c.phone" class="text-nowrap">
                    {{ c.whatsapp || c.phone }}
                  </span>
                  <span v-else class="text-muted">—</span>
                </td>
                <td class="text-center">
                  <span class="badge bg-light text-dark">{{ c.stats?.totalOrders || 0 }}</span>
                </td>
                <td class="text-end">
                  <span class="fw-medium">{{ formatCurrency(c.stats?.totalSpent || 0) }}</span>
                  <div v-if="c.stats?.lastOrderDate" class="text-muted small">
                    Último: {{ formatDate(c.stats.lastOrderDate) }}
                  </div>
                </td>
                <td class="text-center">
                  <div v-if="c.stats?.tier">
                    <span class="tier-stars" :style="{ color: tierColors[c.stats.tier] }">
                      {{ starsHtml(c.stats.stars) }}
                    </span>
                    <div>
                      <span class="badge tier-badge" :style="{ background: tierBgColors[c.stats.tier], color: tierColors[c.stats.tier] }">
                        {{ c.stats.label }}
                      </span>
                    </div>
                  </div>
                  <span v-else class="text-muted">—</span>
                </td>
                <td @click.stop>
                  <div class="d-flex gap-1">
                    <button class="btn btn-sm btn-outline-primary" title="Ver perfil" @click="goProfile(c.id)">
                      <i class="bi bi-person"></i>
                    </button>
                    <button class="btn btn-sm btn-outline-secondary" title="Editar" @click="editCustomer(c.id)">
                      <i class="bi bi-pencil"></i>
                    </button>
                  </div>
                </td>
              </tr>
              <tr v-if="total === 0">
                <td colspan="6" class="text-center text-secondary py-4">Nenhum cliente encontrado.</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="d-flex align-items-center justify-content-between mt-3 px-1">
          <small class="text-muted">Mostrando {{ offset + 1 }} - {{ Math.min(offset + limit, total) }} de {{ total }}</small>
          <div class="d-flex gap-2">
            <button class="btn btn-sm btn-outline-secondary" @click="prevPage" :disabled="offset===0">
              <i class="bi bi-chevron-left"></i> Anterior
            </button>
            <button class="btn btn-sm btn-secondary" @click="nextPage" :disabled="offset+limit >= total">
              Próxima <i class="bi bi-chevron-right"></i>
            </button>
          </div>
        </div>
      </div>
    </template>
  </ListCard>
</template>

<style scoped>
.customers-table thead th {
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: #6c757d;
  border-bottom: 2px solid #e9ecef;
  padding: 0.6rem 0.75rem;
}
.customers-table tbody td {
  padding: 0.7rem 0.75rem;
  vertical-align: middle;
}
.customer-row {
  cursor: pointer;
  transition: background-color 0.15s;
}
.customer-row:hover {
  background-color: #f8f9ff !important;
}
.customer-avatar {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 0.95rem;
  flex-shrink: 0;
}
.tier-stars {
  font-size: 1rem;
  letter-spacing: 1px;
}
.tier-badge {
  font-size: 0.7rem;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 10px;
  margin-top: 2px;
  display: inline-block;
}
</style>
