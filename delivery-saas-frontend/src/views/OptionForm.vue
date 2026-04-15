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
            <CurrencyInput label="Preço" labelClass="form-label" v-model="form.price" inputClass="form-control" :min="0" placeholder="0,00" />
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
              <input class="form-check-input" type="checkbox" id="optActive" v-model="form.isAvailable" />
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
          <SelectInput   v-model="form.linkedProductId"  class="form-select">
            <option :value="null">Nenhum</option>
            <option v-for="p in productsList" :key="p.id" :value="p.id">{{ p.name }}</option>
          </SelectInput>
          <div v-if="form.linkedProductId" class="small text-muted mt-1">
            Quando vinculada, a disponibilidade da opção segue a do produto vinculado.
          </div>
        </div>

        <AvailabilityScheduler
          v-if="!form.linkedProductId"
          v-model:alwaysAvailable="form.alwaysAvailable"
          v-model:schedule="form.weeklySchedule"
        />

        <div class="mb-3">
          <MediaField v-model="form.image" label="Imagem da opção (opcional)" field-id="option-image" />
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
import { ref, onMounted, computed } from 'vue'
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
    if(isNaN(Number(form.value.price)) || Number(form.value.price) < 0){ error.value = 'Preço inválido'; saving.value = false; return }

    const payload = {
      name: form.value.name,
      description: form.value.description,
      technicalSheetId: form.value.technicalSheetId || null,
      price: Number(form.value.price || 0),
      position: Number(form.value.position || 0),
      isAvailable: !!form.value.isAvailable,
      highlightOnSlip: !!form.value.highlightOnSlip,
      linkedProductId: form.value.linkedProductId || null,
      alwaysAvailable: !!form.value.alwaysAvailable,
      weeklySchedule: form.value.linkedProductId || form.value.alwaysAvailable ? null : form.value.weeklySchedule,
    }

    if(isEdit){
      if(form.value.image) payload.image = form.value.image
      await api.patch(`/menu/options/options/${id}`, payload)
      Swal.fire({ icon: 'success', text: 'Opção atualizada' })
    } else {
      if(!groupId){ await Swal.fire({ icon: 'warning', text: 'Grupo não especificado para a nova opção' }); saving.value = false; return }
      const res = await api.post(`/menu/options/${groupId}/options`, payload)
      const newId = res.data && res.data.id
      if(form.value.image && newId){
        try{ await api.patch(`/menu/options/options/${newId}`, { image: form.value.image }) }catch(e){ console.warn('image persist failed', e) }
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
  const price = Number(form.value.price || 0)
  if(!price || price <= 0) return null
  return (sheetCost.value / price) * 100
})

onMounted(()=> load())

</script>

<style scoped>
</style>
