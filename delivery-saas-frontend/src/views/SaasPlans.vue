<script setup>
import { ref, onMounted } from 'vue'
import api from '../api'

const modules = ref([])
const plans = ref([])

const PERIOD_OPTIONS = [
  { value: 'MONTHLY', label: 'Mensal' },
  { value: 'BIMONTHLY', label: 'Bimensal' },
  { value: 'QUARTERLY', label: 'Trimestral' },
  { value: 'ANNUAL', label: 'Anual' }
]

const newPlan = ref({ id: null, name: '', price: 0, menuLimit: null, storeLimit: null, unlimitedMenus: false, unlimitedStores: false, moduleIds: [], prices: [] })
const editingId = ref(null)

async function loadAll(){
  const [modsRes, plansRes] = await Promise.all([
    api.get('/saas/modules'),
    api.get('/saas/plans')
  ])
  modules.value = modsRes.data || []
  plans.value = plansRes.data || []
}

onMounted(loadAll)
async function createPlan(){
  const payload = { ...newPlan.value }
  payload.price = Number(newPlan.value.price || 0)
  // normalize prices (ensure price is string/number)
  if (Array.isArray(payload.prices)) payload.prices = payload.prices.map(p => ({ period: p.period, price: String(Number(p.price || 0)) }))
  try {
    if (editingId.value) {
      await api.put(`/saas/plans/${editingId.value}`, payload)
      editingId.value = null
    } else {
      await api.post('/saas/plans', payload)
    }
    newPlan.value = { id: null, name: '', price: 0, menuLimit: null, storeLimit: null, unlimitedMenus: false, unlimitedStores: false, moduleIds: [], prices: [] }
    await loadAll()
  } catch (e) { console.error(e) }
}

function editPlan(p){
  // populate form for inline editing
  newPlan.value = {
    id: p.id,
    name: p.name,
    price: Number(p.price || 0),
    menuLimit: p.menuLimit,
    storeLimit: p.storeLimit,
    unlimitedMenus: p.unlimitedMenus || false,
    unlimitedStores: p.unlimitedStores || false,
    moduleIds: (p.modules || []).map(pm => pm.moduleId),
    prices: (p.prices || []).map(pr => ({ period: pr.period, price: String(Number(pr.price || 0)) }))
  }
  editingId.value = p.id
}

async function deletePlan(p){
  try{
    if (!window.confirm(`Remover plano "${p.name}" ?`)) return;
    await api.delete(`/saas/plans/${p.id}`)
    await loadAll()
  }catch(e){ console.warn('Failed to delete plan', e) }
}
</script>

<template>
  <div class="container py-3">
    <h2 class="mb-3">Planos</h2>

    <div class="row g-3">
      <div class="col-md-6">
        <div class="card">
          <div class="card-body">
            <h5 class="card-title">Criar plano</h5>
            <div class="mb-2">
              <label class="form-label">Nome do plano</label>
              <input v-model="newPlan.name" class="form-control" />
            </div>
            <div class="mb-2">
              <label class="form-label">Preço padrão (R$) — usado se não houver preços por período</label>
              <input v-model.number="newPlan.price" type="number" step="0.01" class="form-control" />
            </div>

            <div class="mb-2">
              <label class="form-label">Preços por período</label>
              <div v-for="(pr, idx) in newPlan.prices" :key="idx" class="d-flex gap-2 mb-2 align-items-center">
                <select v-model="pr.period" class="form-select w-auto">
                  <option v-for="opt in PERIOD_OPTIONS" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
                </select>
                <input v-model.number="pr.price" type="number" step="0.01" class="form-control" />
                <button class="btn btn-outline-danger btn-sm" @click.prevent="newPlan.prices.splice(idx,1)">Remover</button>
              </div>
              <button class="btn btn-sm btn-outline-primary" @click.prevent="newPlan.prices.push({ period: 'MONTHLY', price: 0 })">Adicionar outro período</button>
            </div>
            <div class="mb-2 d-flex gap-2">
              <div class="flex-fill">
                <label class="form-label">Limite de cardápios</label>
                <input v-model.number="newPlan.menuLimit" type="number" min="0" class="form-control" />
              </div>
              <div class="flex-fill">
                <label class="form-label">Limite de lojas</label>
                <input v-model.number="newPlan.storeLimit" type="number" min="0" class="form-control" />
              </div>
            </div>
            <div class="form-check form-check-inline">
              <input class="form-check-input" type="checkbox" v-model="newPlan.unlimitedMenus" id="chkMenus" />
              <label class="form-check-label" for="chkMenus">Cardápios ilimitados</label>
            </div>
            <div class="form-check form-check-inline">
              <input class="form-check-input" type="checkbox" v-model="newPlan.unlimitedStores" id="chkStores" />
              <label class="form-check-label" for="chkStores">Lojas ilimitadas</label>
            </div>
            <div class="mt-2">
              <label class="form-label">Módulos do plano</label>
              <div>
                <label v-for="m in modules" :key="m.id" class="form-check form-check-inline">
                  <input class="form-check-input" type="checkbox" :value="m.id" v-model="newPlan.moduleIds" />
                  <span class="ms-1">{{ m.name }}</span>
                </label>
              </div>
              <div class="mt-2 small text-muted">Gerencie módulos em <router-link to="/saas/modules">Módulos</router-link>.</div>
            </div>
            <button class="btn btn-primary mt-2" @click="createPlan">Salvar plano</button>
            <button v-if="editingId" class="btn btn-secondary mt-2 ms-2" @click.prevent="(editingId=null, newPlan={ id: null, name: '', price: 0, menuLimit: null, storeLimit: null, unlimitedMenus: false, unlimitedStores: false, moduleIds: [], prices: [] })">Cancelar</button>
          </div>
        </div>
        
        <div class="card mt-3">
          <div class="card-body">
            <h6>Planos existentes</h6>
            <ul class="list-group">
              <li v-for="p in plans" :key="p.id" class="list-group-item">
                <div class="fw-semibold">{{ p.name }} — R$ {{ Number(p.price).toFixed(2) }}</div>
                <div class="small text-muted">Lojas: {{ p.unlimitedStores ? 'ilimitado' : (p.storeLimit ?? '—') }} | Menus: {{ p.unlimitedMenus ? 'ilimitado' : (p.menuLimit ?? '—') }}</div>
                  <div class="mt-1">Módulos: <span v-for="pm in p.modules" :key="pm.moduleId" class="badge bg-secondary me-1">{{ pm.module?.name || pm.moduleId }}</span></div>
                  <div class="mt-1">Preços:
                    <span v-if="Array.isArray(p.prices) && p.prices.length" class="ms-1">
                      <span v-for="pr in p.prices" :key="pr.id" class="badge bg-info text-dark me-1">{{ pr.period }} — R$ {{ Number(pr.price).toFixed(2) }}</span>
                    </span>
                  </div>
                  <div class="mt-2">
                    <div class="btn-group">
                      <button class="btn btn-sm btn-outline-secondary" @click="editPlan(p)">Editar</button>
                      <button class="btn btn-sm btn-outline-danger" @click="deletePlan(p)">Remover</button>
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
