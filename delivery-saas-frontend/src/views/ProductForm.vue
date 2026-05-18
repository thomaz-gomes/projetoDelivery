<template>
  <div class="container py-4">
    <!-- Type chooser modal — only on create -->
    <div v-if="!isEdit && !typeConfirmed" class="modal show d-block" tabindex="-1" style="background: rgba(0,0,0,0.4);">
      <div class="modal-dialog modal-dialog-centered modal-lg">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">Que tipo de item você quer criar?</h5>
          </div>
          <div class="modal-body">
            <div class="row g-3">
              <div class="col-12 col-md-6">
                <div
                  class="card h-100 text-center p-4 type-choice-card"
                  role="button"
                  @click="chooseType(false)"
                >
                  <i class="bi bi-box-seam fs-1 text-primary"></i>
                  <h6 class="mt-3 mb-1 fw-semibold">Produto</h6>
                  <small class="text-muted">Item único com preço próprio</small>
                </div>
              </div>
              <div class="col-12 col-md-6">
                <div
                  class="card h-100 text-center p-4 type-choice-card"
                  role="button"
                  @click="chooseType(true)"
                >
                  <i class="bi bi-collection fs-1 text-primary"></i>
                  <h6 class="mt-3 mb-1 fw-semibold">Combo</h6>
                  <small class="text-muted">Vários produtos com preço fechado</small>
                </div>
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-outline-secondary" @click="cancel">Cancelar</button>
          </div>
        </div>
      </div>
    </div>

    <h2>
      {{ isEdit ? 'Editar' : 'Novo' }} {{ form.isCombo ? 'combo' : 'produto' }}
      <span v-if="form.isCombo" class="badge bg-primary ms-2" style="font-size:0.65em; vertical-align:middle;">
        <i class="bi bi-collection me-1"></i>Combo
      </span>
    </h2>
    <div class="card p-4 mt-3">
      <form @submit.prevent="save">
        <ul class="nav nav-tabs mb-3" role="tablist">
          <li class="nav-item" role="presentation">
            <button :class="['nav-link', { active: activeTab === 'general' }]" id="tab-general" type="button" @click="activeTab = 'general'">Geral</button>
          </li>
          <li v-if="form.isCombo" class="nav-item" role="presentation">
            <button :class="['nav-link', { active: activeTab === 'combo' }]" id="tab-combo" type="button" @click="activeTab = 'combo'">
              <i class="bi bi-collection me-1"></i>Componentes do combo
            </button>
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
          <div v-if="!form.isCombo" class="col-md-4">
            <CurrencyInput label="Preço" labelClass="form-label" v-model="form.price" inputClass="form-control" placeholder="0,00" />
          </div>
          <div v-if="!form.isCombo" class="col-md-4">
            <label class="form-label d-block">Preço especial para o balcão</label>
            <div class="form-check form-switch mb-2">
              <input
                class="form-check-input"
                type="checkbox"
                id="prodSpecialTakeoutEnabled"
                v-model="form.specialTakeoutPriceEnabled"
                role="switch"
              />
              <label class="form-check-label small" for="prodSpecialTakeoutEnabled">
                {{ form.specialTakeoutPriceEnabled ? 'Ativado' : 'Desativado' }}
              </label>
            </div>
            <CurrencyInput
              v-if="form.specialTakeoutPriceEnabled"
              v-model="form.specialTakeoutPrice"
              inputClass="form-control"
              placeholder="0,00"
            />
            <div v-if="form.specialTakeoutPriceEnabled" class="small text-muted mt-1">
              Aplicado em pedidos do tipo <strong>balcão / retirada</strong>.
            </div>
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
              <div v-if="sheetCost > 0" class="small text-muted mt-1">
                Custo da ficha: <strong>R$ {{ sheetCost.toFixed(2) }}</strong>
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

          <div v-if="form.isCombo" :class="['tab-pane', activeTab === 'combo' ? 'show active' : '']" id="combo" role="tabpanel" aria-labelledby="tab-combo">
            <div class="mb-4">
              <h6 class="text-uppercase text-muted small mb-2" style="letter-spacing:0.04em;">Precificação</h6>
              <div class="row g-3">
                <div class="col-md-6">
                  <CurrencyInput label="Preço do combo" labelClass="form-label" v-model="form.price" inputClass="form-control" placeholder="0,00" />
                  <small class="text-muted">Valor fixo pago pelo cliente, independente das escolhas.</small>
                </div>
                <div class="col-md-6">
                  <label class="form-label d-block">Preço especial para o balcão</label>
                  <div class="form-check form-switch mb-2">
                    <input
                      class="form-check-input"
                      type="checkbox"
                      id="comboSpecialTakeoutEnabled"
                      v-model="form.specialTakeoutPriceEnabled"
                      role="switch"
                    />
                    <label class="form-check-label small" for="comboSpecialTakeoutEnabled">
                      {{ form.specialTakeoutPriceEnabled ? 'Ativado' : 'Desativado' }}
                    </label>
                  </div>
                  <CurrencyInput
                    v-if="form.specialTakeoutPriceEnabled"
                    v-model="form.specialTakeoutPrice"
                    inputClass="form-control"
                    placeholder="0,00"
                  />
                  <div v-if="form.specialTakeoutPriceEnabled" class="small text-muted mt-1">
                    Aplicado em pedidos do tipo <strong>balcão / retirada</strong>.
                  </div>
                </div>
              </div>
            </div>

            <div class="mb-3">
              <h5 class="mb-1">Componentes do combo</h5>
              <p class="text-muted small mb-3">
                Defina os slots (ex: Lanche, Bebida) e as opções de produto que o cliente poderá escolher em cada um.
              </p>
              <ComboSlotsEditor
                v-model="form.combo.slots"
                :company-id="companyId"
                :exclude-product-id="id || null"
                :preco-combo="Number(form.price || 0)"
              />
            </div>
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
import ComboSlotsEditor from '../components/ComboSlotsEditor.vue'
import { normalizeToIngredientUnit } from '../utils/unitConversion.js'

const saas = useSaasStore()

const route = useRoute()
const router = useRouter()
const id = route.params.id || null
const isEdit = Boolean(id)

const form = ref({ id: null, name: '', description: '', price: 0, specialTakeoutPriceEnabled: false, specialTakeoutPrice: 0, position: 0, isActive: true, highlightOnSlip: false, image: null, optionGroupIds: [], categoryId: null, technicalSheetId: null, stockIngredientId: null, cashbackPercent: null, dadosFiscaisId: null, marketplace: null, marketplaceCalc: null, alwaysAvailable: true, weeklySchedule: [], isCombo: false, combo: { slots: [] } })
const activeTab = ref('general')
// In edit mode the type is already known; in create mode it's confirmed via the modal.
const typeConfirmed = ref(isEdit)
const companyId = ref(null)
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

function chooseType(isCombo) {
  form.value.isCombo = !!isCombo
  if (form.value.isCombo && !form.value.combo) {
    form.value.combo = { slots: [] }
  }
  typeConfirmed.value = true
}

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
      if(p){
        const stp = p.specialTakeoutPrice !== undefined && p.specialTakeoutPrice !== null ? Number(p.specialTakeoutPrice) : null
        form.value = {
          ...p,
          optionGroupIds: [],
          categoryId: p.categoryId || (p.category && p.category.id) || null,
          cashbackPercent: (p.cashbackPercent !== undefined ? p.cashbackPercent : (p.cashback || null)),
          dadosFiscaisId: p.dadosFiscaisId || null,
          alwaysAvailable: p.alwaysAvailable !== false,
          weeklySchedule: Array.isArray(p.weeklySchedule) ? p.weeklySchedule : [],
          // The toggle is a derived UI flag — "enabled" iff a non-null special
          // price is persisted. Toggling off in the UI sends specialTakeoutPrice=null.
          specialTakeoutPriceEnabled: stp !== null,
          specialTakeoutPrice: stp !== null ? stp : 0,
          isCombo: !!p.isCombo,
          combo: p.combo && Array.isArray(p.combo.slots)
            ? {
                slots: p.combo.slots.map(s => ({
                  name: s.name || '',
                  minSelect: typeof s.minSelect === 'number' ? s.minSelect : 1,
                  maxSelect: typeof s.maxSelect === 'number' ? s.maxSelect : 1,
                  vUnComDeclarado: s.vUnComDeclarado !== undefined && s.vUnComDeclarado !== null ? Number(s.vUnComDeclarado) : 0,
                  options: Array.isArray(s.options)
                    ? s.options.map(o => ({
                        linkedProductId: o.linkedProductId || '',
                        integrationCode: o.integrationCode || '',
                      }))
                    : [],
                })),
              }
            : { slots: [] },
        }
        if (p.companyId) companyId.value = p.companyId
      }
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

function buildComboPayload() {
  const slots = (form.value.combo?.slots || []).map(s => ({
    name: (s.name || '').trim(),
    minSelect: typeof s.minSelect === 'number' ? s.minSelect : 1,
    maxSelect: typeof s.maxSelect === 'number' ? s.maxSelect : 1,
    vUnComDeclarado: Number(s.vUnComDeclarado || 0),
    options: (s.options || []).map(o => ({
      linkedProductId: o.linkedProductId,
      integrationCode: o.integrationCode ? String(o.integrationCode).trim() : null,
    })),
  }))
  return { slots }
}

function validateCombo() {
  const slots = form.value.combo?.slots || []
  if (slots.length === 0) return 'Combo precisa ter ao menos um slot.'
  const precoCombo = Number(form.value.price || 0)
  if (!Number.isFinite(precoCombo) || precoCombo <= 0) {
    return 'Informe o preço do combo antes de validar os slots.'
  }
  let somaDeclarada = 0
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i]
    if (!s.name || !s.name.trim()) return `Slot ${i + 1} sem nome.`
    const min = Number(s.minSelect)
    const max = Number(s.maxSelect)
    if (!Number.isFinite(min) || min < 0) return `Slot ${i + 1}: mínimo inválido.`
    if (!Number.isFinite(max) || max < 1) return `Slot ${i + 1}: máximo inválido.`
    if (max < min) return `Slot ${i + 1}: máximo deve ser >= mínimo.`
    const v = Number(s.vUnComDeclarado)
    if (!Number.isFinite(v) || v <= 0) return `Slot ${i + 1}: informe o valor declarado.`
    somaDeclarada += v
    if (!Array.isArray(s.options) || s.options.length === 0) return `Slot ${i + 1} (${s.name}) sem opções.`
    for (let j = 0; j < s.options.length; j++) {
      const o = s.options[j]
      if (!o.linkedProductId) return `Slot ${i + 1} / opção ${j + 1}: selecione um produto.`
    }
  }
  // soma dos valores declarados não pode ultrapassar o preço pago pelo cliente
  // (a NFC-e não pode declarar mais do que entrou no caixa).
  const somaArred = Math.round(somaDeclarada * 100) / 100
  const precoArred = Math.round(precoCombo * 100) / 100
  if (somaArred > precoArred) {
    return `Soma dos valores declarados (R$ ${somaArred.toFixed(2)}) excede o preço do combo (R$ ${precoArred.toFixed(2)}).`
  }
  return null
}

async function save(){
  error.value = ''
  saving.value = true
  try{
    if(!form.value.name) { error.value = 'Nome é obrigatório'; return }
    if(form.value.isCombo){
      const comboErr = validateCombo()
      if(comboErr){ error.value = comboErr; return }
    }
    if(isEdit){
      const payload = { name: form.value.name, description: form.value.description, price: form.value.price, position: form.value.position, isActive: form.value.isActive, highlightOnSlip: !!form.value.highlightOnSlip, categoryId: form.value.categoryId, menuId: form.value.menuId, technicalSheetId: form.value.technicalSheetId, stockIngredientId: form.value.stockIngredientId, dadosFiscaisId: form.value.dadosFiscaisId || null, alwaysAvailable: !!form.value.alwaysAvailable, weeklySchedule: form.value.alwaysAvailable ? null : form.value.weeklySchedule, isCombo: !!form.value.isCombo }
      if(form.value.isCombo) payload.combo = buildComboPayload()
      if(form.value.marketplace) payload.marketplace = form.value.marketplace
      // include cashbackPercent when cashback module is enabled (allow null to clear)
      if(typeof form.value.cashbackPercent !== 'undefined') payload.cashbackPercent = form.value.cashbackPercent === '' ? null : form.value.cashbackPercent
      // Switch off ⇒ explicit null clears the special price; switch on ⇒ send the value.
      payload.specialTakeoutPrice = form.value.specialTakeoutPriceEnabled ? Number(form.value.specialTakeoutPrice || 0) : null
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
  const payload = { name: form.value.name, description: form.value.description, price: form.value.price, position: form.value.position, isActive: form.value.isActive, highlightOnSlip: !!form.value.highlightOnSlip, categoryId: form.value.categoryId, menuId: form.value.menuId, technicalSheetId: form.value.technicalSheetId, stockIngredientId: form.value.stockIngredientId, dadosFiscaisId: form.value.dadosFiscaisId || null, alwaysAvailable: !!form.value.alwaysAvailable, weeklySchedule: form.value.alwaysAvailable ? null : form.value.weeklySchedule, isCombo: !!form.value.isCombo }
  if(form.value.isCombo) payload.combo = buildComboPayload()
  if(form.value.marketplace) payload.marketplace = form.value.marketplace
  if(typeof form.value.cashbackPercent !== 'undefined') payload.cashbackPercent = form.value.cashbackPercent === '' ? null : form.value.cashbackPercent
  if(form.value.specialTakeoutPriceEnabled) payload.specialTakeoutPrice = Number(form.value.specialTakeoutPrice || 0)
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
.type-choice-card {
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;
  border: 2px solid var(--border-color, #e6e6e6);
}
.type-choice-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-hover, 0 4px 12px rgba(0,0,0,0.08));
  border-color: var(--primary, #105784);
}
</style>
