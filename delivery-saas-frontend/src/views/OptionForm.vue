<template>
  <div class="container py-4">
    <h2>{{ isEdit ? 'Editar opção' : 'Nova opção' }}</h2>
    <div class="card p-4 mt-3">
      <form @submit.prevent="save">
        <div class="mb-3">
          <TextInput label="Nome" labelClass="form-label" v-model="form.name" placeholder="Ex: Extra queijo" required maxlength="80" />
        </div>

        <div class="mb-3">
          <label class="form-label">Descrição (opcional)</label>
          <TextareaInput v-model="form.description" rows="3" maxlength="400" placeholder="Detalhes da opção" />
        </div>

        <div class="row mb-3">
          <div class="col-md-3">
            <CurrencyInput label="Preço" labelClass="form-label" v-model="effectivePrice" inputClass="form-control" :min="0" placeholder="0,00" :disabled="isLinked && !overridePrice" />
            <div v-if="isLinked" class="form-check mt-1">
              <input class="form-check-input" type="checkbox" id="overridePrice" v-model="overridePrice" />
              <label class="form-check-label small text-muted" for="overridePrice">Usar preço personalizado</label>
            </div>
          </div>
            <div class="col-md-3">
              <label class="form-label">Ficha Técnica (opcional)</label>
              <SelectInput v-model="form.technicalSheetId" class="form-select">
                <option :value="null">-- Nenhuma --</option>
                <option v-for="s in technicalSheets" :key="s.id" :value="s.id">{{ s.name }} ({{ s.itemCount || 0 }} itens)</option>
              </SelectInput>
              <div class="small text-muted mt-1">
                <div v-if="sheetCost !== undefined && sheetCost !== null">Custo: <strong>{{ sheetCost.toFixed(2) }}</strong></div>
                <div v-if="cmvPercent !== null">CMV: <strong>{{ cmvPercent.toFixed(2) }}%</strong> (R$ {{ sheetCost.toFixed(2) }})</div>
                <div v-else class="text-muted">Preencha o preço para ver o CMV</div>
              </div>
            </div>
          <div class="col-md-3">
            <label class="form-label">Posição</label>
            <input v-model.number="form.position" type="number" class="form-control" />
          </div>
          <div class="col-md-3 d-flex align-items-end">
            <div class="form-check form-switch">
              <input class="form-check-input" type="checkbox" id="optActive" v-model="effectiveAvailable" :disabled="isLinked && !overrideAvailability" />
              <label class="form-check-label small text-muted" for="optActive">Disponível</label>
            </div>
          </div>
          <div class="col-md-3 d-flex align-items-end">
            <div class="form-check form-switch">
              <input class="form-check-input" type="checkbox" id="optHighlight" v-model="form.highlightOnSlip" />
              <label class="form-check-label small text-muted" for="optHighlight">Destacar na comanda</label>
            </div>
          </div>
        </div>

        <div class="mb-3">
          <label class="form-label">Vincular a produto (opcional)</label>
          <SelectInput v-model="form.linkedProductId" class="form-select">
            <option :value="null">Nenhum</option>
            <option v-for="p in productsList" :key="p.id" :value="p.id">{{ p.name }}</option>
          </SelectInput>
          <div v-if="isLinked" class="small text-muted mt-1">
            Quando vinculada, preço, disponibilidade, horário e imagem herdam do produto vinculado. Marque as opções de personalização para usar valores próprios.
          </div>
        </div>

        <!-- Availability scheduler: show linked product schedule (read-only) or own schedule -->
        <div v-if="isLinked && !overrideAvailability" class="mb-3">
          <div class="form-check mt-1 mb-2">
            <input class="form-check-input" type="checkbox" id="overrideAvailability" v-model="overrideAvailability" />
            <label class="form-check-label small text-muted" for="overrideAvailability">Usar horário personalizado</label>
          </div>
          <AvailabilityScheduler
            v-if="linkedProduct && !linkedProduct.alwaysAvailable"
            :alwaysAvailable="false"
            :schedule="linkedProduct.weeklySchedule || []"
            disabled
          />
          <div v-else class="small text-muted">Produto vinculado: sempre disponível</div>
        </div>
        <div v-else-if="isLinked && overrideAvailability" class="mb-3">
          <div class="form-check mt-1 mb-2">
            <input class="form-check-input" type="checkbox" id="overrideAvailability2" v-model="overrideAvailability" />
            <label class="form-check-label small text-muted" for="overrideAvailability2">Usar horário personalizado</label>
          </div>
          <AvailabilityScheduler
            v-model:alwaysAvailable="form.alwaysAvailable"
            v-model:schedule="form.weeklySchedule"
          />
        </div>
        <AvailabilityScheduler
          v-else
          v-model:alwaysAvailable="form.alwaysAvailable"
          v-model:schedule="form.weeklySchedule"
        />

        <!-- Image: show linked product image (read-only) or own image -->
        <div class="mb-3">
          <div v-if="isLinked && !overrideImage">
            <label class="form-label">Imagem (herdada do produto vinculado)</label>
            <div v-if="linkedProduct && linkedProduct.image" class="mb-2">
              <img :src="linkedProduct.image" alt="Imagem do produto" style="max-height: 120px; border-radius: 8px;" />
            </div>
            <div v-else class="small text-muted mb-2">Produto vinculado sem imagem.</div>
            <div class="form-check">
              <input class="form-check-input" type="checkbox" id="overrideImage" v-model="overrideImage" />
              <label class="form-check-label small text-muted" for="overrideImage">Usar imagem própria</label>
            </div>
          </div>
          <div v-else-if="isLinked && overrideImage">
            <div class="form-check mb-2">
              <input class="form-check-input" type="checkbox" id="overrideImage2" v-model="overrideImage" />
              <label class="form-check-label small text-muted" for="overrideImage2">Usar imagem própria</label>
            </div>
            <MediaField v-model="form.image" label="Imagem da opção" field-id="option-image" />
          </div>
          <div v-else>
            <MediaField v-model="form.image" label="Imagem da opção (opcional)" field-id="option-image" />
          </div>
        </div>

        <div class="d-flex justify-content-between align-items-center">
          <div>
            <button class="btn btn-secondary" type="button" @click="cancel">Voltar</button>
          </div>
          <div>
            <button class="btn btn-primary" :disabled="saving">{{ isEdit ? 'Salvar alterações' : 'Criar opção' }}</button>
          </div>
        </div>

        <div v-if="error" class="alert alert-danger mt-3">{{ error }}</div>
      </form>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import api from '../api'
import Swal from 'sweetalert2'
import MediaField from '../components/MediaLibrary/MediaField.vue'
import TextInput from '../components/form/input/TextInput.vue'
import TextareaInput from '../components/form/input/TextareaInput.vue'
import CurrencyInput from '../components/form/input/CurrencyInput.vue'
import SelectInput from '../components/form/select/SelectInput.vue'
import AvailabilityScheduler from '../components/AvailabilityScheduler.vue'
import { normalizeToIngredientUnit } from '../utils/unitConversion.js'

const route = useRoute()
const router = useRouter()
const id = route.params.id || null
const isEdit = Boolean(id)
const query = route.query || {}
const groupId = query.groupId || null

const form = ref({ id: null, name: '', description: '', price: 0, position: 0, isAvailable: true, alwaysAvailable: true, weeklySchedule: [], linkedProductId: null, image: null, technicalSheetId: null, highlightOnSlip: false })
const productsList = ref([])
const technicalSheets = ref([])
const saving = ref(false)
const error = ref('')

// Override flags — when linked to a product, these control whether the option uses its own values
const overridePrice = ref(false)
const overrideImage = ref(false)
const overrideAvailability = ref(false)

const isLinked = computed(() => !!form.value.linkedProductId)
const linkedProduct = computed(() => {
  if (!form.value.linkedProductId) return null
  return productsList.value.find(p => p.id === form.value.linkedProductId) || null
})

// Effective price: shows linked product price when no override, otherwise the option's own price
const effectivePrice = computed({
  get() {
    if (isLinked.value && !overridePrice.value && linkedProduct.value) {
      return Number(linkedProduct.value.price || 0)
    }
    return form.value.price
  },
  set(val) {
    form.value.price = val
  }
})

// Effective availability: shows linked product isActive when no override
const effectiveAvailable = computed({
  get() {
    if (isLinked.value && !overrideAvailability.value && linkedProduct.value) {
      return linkedProduct.value.isActive
    }
    return form.value.isAvailable
  },
  set(val) {
    form.value.isAvailable = val
  }
})

// When the user changes the linked product, reset overrides
watch(() => form.value.linkedProductId, (newVal, oldVal) => {
  if (newVal !== oldVal) {
    overridePrice.value = false
    overrideImage.value = false
    overrideAvailability.value = false
  }
})

// When disabling override, sync value from linked product
watch(overridePrice, (val) => {
  if (!val && linkedProduct.value) {
    form.value.price = Number(linkedProduct.value.price || 0)
  }
})
watch(overrideImage, (val) => {
  if (!val) {
    form.value.image = null
  }
})
watch(overrideAvailability, (val) => {
  if (!val && linkedProduct.value) {
    form.value.isAvailable = linkedProduct.value.isActive
    form.value.alwaysAvailable = linkedProduct.value.alwaysAvailable !== false
    form.value.weeklySchedule = Array.isArray(linkedProduct.value.weeklySchedule) ? linkedProduct.value.weeklySchedule : []
  }
})

const daysOfWeek = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb']

async function load(){
  try{
    try{ const pr = await api.get('/menu/products'); productsList.value = pr.data || [] }catch(e){ productsList.value = [] }
    if(isEdit){
      const res = await api.get(`/menu/options/options/${id}`)
      const o = res.data
      if(o){
        form.value = {
          id: o.id,
          name: o.name || '',
          description: o.description || '',
          price: Number(o.price||0),
          position: o.position || 0,
          isAvailable: o.isAvailable === undefined ? true : o.isAvailable,
          alwaysAvailable: o.alwaysAvailable !== false,
          weeklySchedule: Array.isArray(o.weeklySchedule) ? o.weeklySchedule : [],
          linkedProductId: o.linkedProductId || null,
          image: o.image || null,
          technicalSheetId: o.technicalSheetId || null,
          highlightOnSlip: !!o.highlightOnSlip
        }
        // Determine override states from saved data
        if (o.linkedProductId && o.linkedProduct) {
          const lp = o.linkedProduct
          // Price override: if the option price differs from the product price, it was overridden
          overridePrice.value = Number(o.price || 0) !== Number(lp.price || 0)
          // Image override: if the option has its own image (different from product)
          overrideImage.value = !!o.image && o.image !== lp.image
          // Availability override: if the option has its own schedule different from the product
          const sameAvailability = o.isAvailable === lp.isActive
          const sameAlways = (o.alwaysAvailable !== false) === (lp.alwaysAvailable !== false)
          const sameSchedule = JSON.stringify(o.weeklySchedule || []) === JSON.stringify(lp.weeklySchedule || [])
          overrideAvailability.value = !(sameAvailability && sameAlways && sameSchedule)
        }
      }
    } else if(groupId){
      // prefill groupId context if provided
    }
    // load technical sheets
    try{ const ts = await api.get('/technical-sheets'); technicalSheets.value = ts.data || [] }catch(e){ technicalSheets.value = [] }
  }catch(e){ console.error(e); error.value = 'Falha ao carregar dados' }
}

function cancel(){ router.push({ path: '/menu/options' }) }

async function save(){
  error.value = ''
  saving.value = true
  try{
    if(!form.value.name) { error.value = 'Nome é obrigatório'; saving.value = false; return }
    if(isNaN(Number(effectivePrice.value)) || Number(effectivePrice.value) < 0){ error.value = 'Preço inválido'; saving.value = false; return }

    // Resolve effective values before sending
    const finalPrice = Number(effectivePrice.value || 0)
    const finalAvailable = effectiveAvailable.value
    const finalImage = isLinked.value && !overrideImage.value
      ? (linkedProduct.value?.image || null)
      : (form.value.image || null)

    let finalAlwaysAvailable, finalWeeklySchedule
    if (isLinked.value && !overrideAvailability.value && linkedProduct.value) {
      finalAlwaysAvailable = linkedProduct.value.alwaysAvailable !== false
      finalWeeklySchedule = finalAlwaysAvailable ? null : (linkedProduct.value.weeklySchedule || null)
    } else {
      finalAlwaysAvailable = !!form.value.alwaysAvailable
      finalWeeklySchedule = finalAlwaysAvailable ? null : (form.value.weeklySchedule || null)
    }

    const payload = {
      name: form.value.name,
      description: form.value.description,
      technicalSheetId: form.value.technicalSheetId || null,
      price: finalPrice,
      position: Number(form.value.position || 0),
      isAvailable: !!finalAvailable,
      highlightOnSlip: !!form.value.highlightOnSlip,
      linkedProductId: form.value.linkedProductId || null,
      alwaysAvailable: finalAlwaysAvailable,
      weeklySchedule: finalWeeklySchedule,
      image: finalImage,
    }

    if(isEdit){
      await api.patch(`/menu/options/options/${id}`, payload)
      Swal.fire({ icon: 'success', text: 'Opção atualizada' })
    } else {
      if(!groupId){ await Swal.fire({ icon: 'warning', text: 'Grupo não especificado para a nova opção' }); saving.value = false; return }
      const res = await api.post(`/menu/options/${groupId}/options`, payload)
      const newId = res.data && res.data.id
      if(finalImage && newId){
        try{ await api.patch(`/menu/options/options/${newId}`, { image: finalImage }) }catch(e){ console.warn('image persist failed', e) }
      }
      Swal.fire({ icon: 'success', text: 'Opção criada' })
    }
    router.push({ path: '/menu/options' })
  }catch(e){ console.error(e); error.value = e?.response?.data?.message || e.message || 'Erro ao salvar' }
  finally{ saving.value = false }
}

// CMV helpers for option
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
  const price = Number(effectivePrice.value || 0)
  if(!price || price <= 0) return null
  return (sheetCost.value / price) * 100
})

onMounted(()=> load())

</script>

<style scoped>
</style>
