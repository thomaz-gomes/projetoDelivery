<template>
  <div class="container py-4">
    <h2>{{ isEdit ? 'Editar produto' : 'Novo produto' }}</h2>
    <div class="card p-4 mt-3">
      <form @submit.prevent="save">
        <ul class="nav nav-tabs mb-3" role="tablist">
          <li class="nav-item" role="presentation">
            <button :class="['nav-link', { active: activeTab === 'general' }]" id="tab-general" type="button" @click="activeTab = 'general'">Geral</button>
          </li>
          <li class="nav-item" role="presentation">
            <button :class="['nav-link', { active: activeTab === 'marketplace' }]" id="tab-marketplace" type="button" @click="activeTab = 'marketplace'">MARKETPLACE</button>
          </li>
          <li class="nav-item" role="presentation">
            <button :class="['nav-link', { active: activeTab === 'pricing' }]" type="button" @click="activeTab = 'pricing'">PRECIFICAÇÃO</button>
          </li>
        </ul>
        <div class="tab-content">
          <div :class="['tab-pane', activeTab === 'general' ? 'show active' : '']" id="general" role="tabpanel" aria-labelledby="tab-general">
        <div class="mb-3">
          <TextInput label="Nome do Produto" labelClass="form-label" v-model="form.name" placeholder="Ex: Coxinha" required maxlength="80" />
        </div>
        <div class="mb-3">
          <div class="d-flex align-items-center gap-2 mb-1">
            <label class="form-label mb-0">Descrição</label>
            <button
              type="button"
              class="btn btn-sm btn-outline-primary py-0 px-2"
              :disabled="!canGenerateDesc || generatingDesc"
              :title="canGenerateDesc ? 'Descrever com IA' : 'Preencha o nome e a imagem para usar a IA'"
              @click="generateDescription"
            >
              <span v-if="generatingDesc" class="spinner-border spinner-border-sm me-1" role="status"></span>
              <i v-else class="bi bi-stars me-1"></i>
              {{ generatingDesc ? 'Gerando...' : 'Descrever com IA' }}
            </button>
          </div>
          <TextareaInput v-model="form.description" placeholder="Descrição" rows="4" maxlength="1000" />
        </div>
        <div class="row mb-3">
          <div class="col-md-4">
            <CurrencyInput label="Preço" labelClass="form-label" v-model="form.price" inputClass="form-control" placeholder="0,00" />
          </div>
          <div v-if="cashbackEnabled" class="col-md-4">
            <label class="form-label">Cashback (%)</label>
            <input type="number" step="0.01" class="form-control" v-model.number="form.cashbackPercent" placeholder="Ex: 3.5" />
            <div class="small text-muted">Deixe vazio para usar o percentual padrão da loja</div>
          </div>
          <div class="col-md-4">
            <label class="form-label">Categoria</label>
            <SelectInput   v-model="form.categoryId"  class="form-control">
              <option :value="null">— Sem categoria —</option>
              <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
            </SelectInput>
          </div>
            <div class="col-md-4">
              <label class="form-label">Menu (opcional)</label>
              <SelectInput   v-model="form.menuId"  class="form-control">
                <option :value="null">-- Nenhum --</option>
                <option v-for="m in menus" :key="m.id" :value="m.id">{{ m.name }}</option>
              </SelectInput>
            </div>
            <div class="col-md-4">
              <label class="form-label">Ficha Técnica (opcional)</label>
              <SelectInput v-model="form.technicalSheetId" class="form-control" :disabled="!!form.stockIngredientId">
                <option :value="null">-- Nenhuma --</option>
                <option v-for="s in technicalSheets" :key="s.id" :value="s.id">{{ s.name }} ({{ s.itemCount || 0 }} itens)</option>
              </SelectInput>
              <div class="small text-muted mt-1">
                <div v-if="sheetCost !== undefined && sheetCost !== null">Custo da ficha: <strong>{{ sheetCost.toFixed(2) }}</strong></div>
                <div v-if="cmvPercent !== null">CMV: <strong>{{ cmvPercent.toFixed(2) }}%</strong> (R$ {{ sheetCost.toFixed(2) }})</div>
                <div v-else class="text-muted">Preencha o preço para ver o CMV</div>
              </div>
            </div>
            <div class="col-md-4">
              <label class="form-label">Ingrediente de Estoque (opcional)</label>
              <SelectInput v-model="form.stockIngredientId" class="form-control" :disabled="!!form.technicalSheetId">
                <option :value="null">-- Nenhum --</option>
                <option v-for="i in stockIngredients" :key="i.id" :value="i.id">{{ i.description }} ({{ Number(i.currentStock || 0) }} un)</option>
              </SelectInput>
              <div class="small text-muted mt-1">Para produtos de revenda (1 vendido = 1 baixa)</div>
            </div>
            <div class="col-md-4">
              <label class="form-label">Dados Fiscais (opcional)</label>
              <SelectInput v-model="form.dadosFiscaisId" class="form-control">
                <option :value="null">-- Usar da categoria --</option>
                <option v-for="d in dadosFiscaisList" :key="d.id" :value="d.id">{{ d.descricao }}</option>
              </SelectInput>
              <div class="small text-muted mt-1">Se selecionado, sobrescreve os dados fiscais da categoria</div>
            </div>
          <div class="col-md-4">
            <label class="form-label">Posição</label>
            <input v-model.number="form.position" type="number" class="form-control" />
          </div>
        </div>

        <!-- Disponibilidade e destaque -->
        <fieldset class="mb-3 p-3 border rounded bg-light">
          <legend class="h6 text-muted mb-2" style="font-size:0.8rem; letter-spacing:0.04em; text-transform:uppercase;">
            Disponibilidade
          </legend>
          <div class="row g-3">
            <div class="col-md-6">
              <div class="form-check form-switch">
                <input
                  class="form-check-input"
                  type="checkbox"
                  id="prodActive"
                  v-model="form.isActive"
                  role="switch"
                />
                <label class="form-check-label fw-semibold" for="prodActive">
                  Produto disponível
                </label>
                <div class="small text-muted">
                  {{ form.isActive ? 'Visível para os clientes no cardápio' : 'Oculto no cardápio' }}
                </div>
              </div>
            </div>
            <div class="col-md-6">
              <div class="form-check form-switch">
                <input
                  class="form-check-input"
                  type="checkbox"
                  id="prodHighlight"
                  v-model="form.highlightOnSlip"
                  role="switch"
                />
                <label class="form-check-label fw-semibold" for="prodHighlight">
                  Destacar na comanda
                </label>
                <div class="small text-muted">
                  Imprime o nome deste item com destaque no recibo
                </div>
              </div>
            </div>
          </div>
        </fieldset>

        <div class="mb-3" v-if="!saas.isCardapioSimplesOnly">
          <label class="form-label">Grupos de complementos</label>
          <div v-if="groups.length===0" class="small text-muted">Nenhum grupo cadastrado.</div>
          <div v-else>
            <div class="form-check" v-for="g in groups" :key="g.id">
              <input class="form-check-input" type="checkbox" :id="'grp-'+g.id" :value="g.id" v-model="form.optionGroupIds" />
              <label class="form-check-label" :for="'grp-'+g.id">{{ g.name }} <small class="text-muted">(min: {{ g.min || 0 }} / max: {{ g.max ?? '∞' }})</small></label>
            </div>
          </div>
        </div>

        <div class="mb-3">
          <MediaField v-model="form.image" label="Imagem do produto" field-id="product-image" />
          <div v-if="form.image" class="ai-photo-cta mt-2">
            <i class="bi bi-stars me-1"></i>
            Otimize sua foto com IA — cardápios com fotos chamativas convertem até 60% a mais
          </div>
        </div>

        <AvailabilityScheduler
          v-model:alwaysAvailable="form.alwaysAvailable"
          v-model:schedule="form.weeklySchedule"
        />

        </div>

          <div :class="['tab-pane', activeTab === 'marketplace' ? 'show active' : '']" id="marketplace" role="tabpanel" aria-labelledby="tab-marketplace">
            <MarketplaceTab :cmv="sheetCost" :store-price="Number(form.price || 0)" :initial="form.marketplace" @change="onMarketplaceChange" />
          </div>

          <div :class="['tab-pane', activeTab === 'pricing' ? 'show active' : '']" role="tabpanel">
            <PricingPanel
              v-if="isEdit && id"
              :product-id="id"
              :current-price="form.price"
              @apply-suggested-price="form.price = $event"
            />
            <div v-else class="alert alert-info">Salve o produto primeiro para ver a análise de precificação.</div>
          </div>
        </div>

        <div class="d-flex justify-content-between align-items-center">
          <div>
            <button class="btn btn-secondary" type="button" @click="cancel">Voltar</button>
          </div>
          <div>
            <button class="btn btn-primary" :disabled="saving">{{ isEdit ? 'Salvar alterações' : 'Criar produto' }}</button>
          </div>
        </div>

        <div v-if="error" class="alert alert-danger mt-3">{{ error }}</div>
      </form>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, nextTick, onBeforeUnmount, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import api from '../api'
import Swal from 'sweetalert2'
import { useSaasStore } from '../stores/saas'
import MediaField from '../components/MediaLibrary/MediaField.vue'
import TextInput from '../components/form/input/TextInput.vue'
import TextareaInput from '../components/form/input/TextareaInput.vue'
import CurrencyInput from '../components/form/input/CurrencyInput.vue'
import SelectInput from '../components/form/select/SelectInput.vue'
import MarketplaceTab from '../components/MarketplaceTab.vue'
import AvailabilityScheduler from '../components/AvailabilityScheduler.vue'
import PricingPanel from '../components/PricingPanel.vue'
import { normalizeToIngredientUnit } from '../utils/unitConversion.js'

const saas = useSaasStore()

const route = useRoute()
const router = useRouter()
const id = route.params.id || null
const isEdit = Boolean(id)

const form = ref({ id: null, name: '', description: '', price: 0, position: 0, isActive: true, highlightOnSlip: false, image: null, optionGroupIds: [], categoryId: null, technicalSheetId: null, stockIngredientId: null, cashbackPercent: null, dadosFiscaisId: null, marketplace: null, marketplaceCalc: null, alwaysAvailable: true, weeklySchedule: [] })
const activeTab = ref('general')
const cashbackEnabled = ref(false)
const groups = ref([])
const categories = ref([])
const menus = ref([])
const technicalSheets = ref([])
const stockIngredients = ref([])
const dadosFiscaisList = ref([])
const saving = ref(false)
const error = ref('')
const uploadProgress = ref(0)
const isUploading = ref(false)
const generatingDesc = ref(false)

const canGenerateDesc = computed(() => !!form.value.name?.trim() && !!form.value.image)

async function generateDescription() {
  if (!canGenerateDesc.value || generatingDesc.value) return
  generatingDesc.value = true
  try {
    const { data } = await api.post('/ai-studio/generate-description', {
      name: form.value.name,
      imageUrl: form.value.image,
    })
    form.value.description = data.description
  } catch (e) {
    const msg = e?.response?.data?.message || e.message || 'Erro ao gerar descrição'
    Swal.fire({ icon: 'error', title: 'Erro', text: msg })
  } finally {
    generatingDesc.value = false
  }
}

async function loadCategories(){
  try{
    const menuId = form.value.menuId || route.query.menuId
    const menuQuery = menuId ? `?menuId=${encodeURIComponent(menuId)}` : ''
    const cr = await api.get(`/menu/categories${menuQuery}`)
    // Dedupe by id and filter out stray "Sem categoria" rows from backend
    const seen = new Set()
    categories.value = (cr.data || []).filter(c => {
      if(seen.has(c.id)) return false
      seen.add(c.id)
      if((c.name || '').trim().toLowerCase() === 'sem categoria') return false
      return true
    })
  }catch(e){ categories.value = [] }
}

async function load(){
  try{
    const gr = await api.get('/menu/options')
    groups.value = gr.data || []
    if(isEdit){
      const res = await api.get('/menu/products')
      const all = res.data || []
      const p = all.find(x=>x.id===id)
      if(p){ form.value = { ...p, optionGroupIds: [], categoryId: p.categoryId || (p.category && p.category.id) || null, cashbackPercent: (p.cashbackPercent !== undefined ? p.cashbackPercent : (p.cashback || null)), dadosFiscaisId: p.dadosFiscaisId || null, alwaysAvailable: p.alwaysAvailable !== false, weeklySchedule: Array.isArray(p.weeklySchedule) ? p.weeklySchedule : [] } }
      // load attached groups
      try{ const att = await api.get(`/menu/products/${id}/option-groups`); form.value.optionGroupIds = att.data.attachedIds || [] }catch(e){}
    }
    // load categories for select — scoped to form.menuId (set when editing) or route query menuId
    await loadCategories()
    // load menus for select
    try{ const mr = await api.get('/menu/menus'); menus.value = mr.data || [] }catch(e){ menus.value = [] }
    // load technical sheets for select and CMV calc
    try{ const ts = await api.get('/technical-sheets'); technicalSheets.value = ts.data || [] }catch(e){ technicalSheets.value = [] }
    // load stock ingredients for direct stock link (resale products)
    try{ const si = await api.get('/ingredients'); stockIngredients.value = (si.data || []).filter(i => i.controlsStock && i.unit === 'UN') }catch(e){ stockIngredients.value = [] }
    // prefill category and menu if passed in query
    if(!isEdit){
      if(route.query.categoryId){ form.value.categoryId = route.query.categoryId }
      if(route.query.menuId){ form.value.menuId = route.query.menuId }
    }
    // load cashback settings to decide whether to show product-level input
    try{
      const cr = await api.get('/cashback/settings')
      const s = cr.data || null
      cashbackEnabled.value = !!(s && (s.enabled || s.isEnabled))
    }catch(e){ cashbackEnabled.value = false }
    // load dados fiscais for selector
    try{ const df = await api.get('/settings/dados-fiscais'); dadosFiscaisList.value = df.data || [] }catch(e){}
  }catch(e){ console.error(e); error.value = 'Falha ao carregar dados' }
}

function cancel(){
  const prevHistory = (typeof window !== 'undefined' && window.history && window.history.length > 1)
  if(prevHistory){ router.back(); return }
  // preserve menuId query when returning to the admin structure view
  const q = {}
  const mid = form.value.menuId || route.query.menuId
  if(mid) q.menuId = mid
  router.push({ path: '/menu/admin', query: q })
}

async function save(){
  error.value = ''
  saving.value = true
  try{
    if(!form.value.name) { error.value = 'Nome é obrigatório'; return }
    if(isEdit){
      const payload = { name: form.value.name, description: form.value.description, price: form.value.price, position: form.value.position, isActive: form.value.isActive, highlightOnSlip: !!form.value.highlightOnSlip, categoryId: form.value.categoryId, menuId: form.value.menuId, technicalSheetId: form.value.technicalSheetId, stockIngredientId: form.value.stockIngredientId, dadosFiscaisId: form.value.dadosFiscaisId || null, alwaysAvailable: !!form.value.alwaysAvailable, weeklySchedule: form.value.alwaysAvailable ? null : form.value.weeklySchedule }
      if(form.value.marketplace) payload.marketplace = form.value.marketplace
      // include cashbackPercent when cashback module is enabled (allow null to clear)
      if(typeof form.value.cashbackPercent !== 'undefined') payload.cashbackPercent = form.value.cashbackPercent === '' ? null : form.value.cashbackPercent
      await api.patch(`/menu/products/${id}`, payload)
      // sync groups
      try{ await api.post(`/menu/products/${id}/option-groups`, { groupIds: form.value.optionGroupIds || [] }) }catch(e){ console.warn('Failed to sync groups', e) }
      Swal.fire({ icon: 'success', text: 'Produto atualizado' })
      // preserve menuId when navigating back to admin
      try{
        const q = {}
        const mid = form.value.menuId || route.query.menuId
        if(mid) q.menuId = mid
        router.push({ path: '/menu/admin', query: q })
      }catch(e){
        const prevHistory = (typeof window !== 'undefined' && window.history && window.history.length > 1)
        if(prevHistory){ router.back(); }
        else { router.push({ path: '/menu/admin' }) }
      }
    } else {
  const payload = { name: form.value.name, description: form.value.description, price: form.value.price, position: form.value.position, isActive: form.value.isActive, highlightOnSlip: !!form.value.highlightOnSlip, categoryId: form.value.categoryId, menuId: form.value.menuId, technicalSheetId: form.value.technicalSheetId, stockIngredientId: form.value.stockIngredientId, dadosFiscaisId: form.value.dadosFiscaisId || null, alwaysAvailable: !!form.value.alwaysAvailable, weeklySchedule: form.value.alwaysAvailable ? null : form.value.weeklySchedule }
  if(form.value.marketplace) payload.marketplace = form.value.marketplace
  if(typeof form.value.cashbackPercent !== 'undefined') payload.cashbackPercent = form.value.cashbackPercent === '' ? null : form.value.cashbackPercent
      const res = await api.post('/menu/products', payload)
      const newId = res.data.id
      // attach groups
      try{ if((form.value.optionGroupIds||[]).length) await api.post(`/menu/products/${newId}/option-groups`, { groupIds: form.value.optionGroupIds }) }catch(e){ console.warn('Failed to attach groups', e) }
      // if image URL provided via MediaField, persist it to the product record
      if(form.value.image){
        try{ await api.patch(`/menu/products/${newId}`, { image: form.value.image }) }catch(e){ console.warn('image persist failed', e) }
      }
      Swal.fire({ icon: 'success', text: 'Produto criado' })
      try{
        const q = {}
        const mid = form.value.menuId || route.query.menuId
        if(mid) q.menuId = mid
        router.push({ path: '/menu/admin', query: q })
      }catch(e){
        const prevHistory = (typeof window !== 'undefined' && window.history && window.history.length > 1)
        if(prevHistory){ router.back(); }
        else { router.push({ path: '/menu/admin' }) }
      }
    }
  }catch(e){ console.error(e); error.value = e?.response?.data?.message || e.message || 'Erro' }
  finally{ saving.value = false }
}

onMounted(()=> load())

// Reload categories when form.menuId changes, and clear stale categoryId selections
// mutual exclusion: technicalSheet vs stockIngredient
watch(() => form.value.technicalSheetId, (v) => { if (v) form.value.stockIngredientId = null })
watch(() => form.value.stockIngredientId, (v) => { if (v) form.value.technicalSheetId = null })

watch(() => form.value.menuId, async (newMenuId, oldMenuId) => {
  if(newMenuId === oldMenuId) return
  await loadCategories()
  if(form.value.categoryId && !categories.value.some(c => c.id === form.value.categoryId)){
    form.value.categoryId = null
  }
})

function onMarketplaceChange(dto, calc){
  form.value.marketplace = dto
  form.value.marketplaceCalc = calc
}

// computed helpers for CMV
const selectedTechnicalSheet = computed(() => {
  try{ return technicalSheets.value.find(s => String(s.id) === String(form.value.technicalSheetId)) || null }catch(e){ return null }
})
function sheetTotalCost(sheet){
  if(!sheet || !sheet.items) return 0
  return sheet.items.reduce((acc, it) => {
    const cost = (it.ingredient && it.ingredient.avgCost) ? Number(it.ingredient.avgCost) : 0
    const rawQty = Number(it.quantity || 0)
    const qty = normalizeToIngredientUnit(rawQty, it.unit, it.ingredient?.unit)
    return acc + (cost * qty)
  }, 0)
}
const sheetCost = computed(() => sheetTotalCost(selectedTechnicalSheet.value))
const cmvPercent = computed(() => {
  const price = Number(form.value.price || 0)
  if(!price || price <= 0) return null
  return (sheetCost.value / price) * 100
})
</script>

<style scoped>
</style>
