<template>
  <div class="coupon-form container py-4">
    <div class="card mx-auto" style="max-width:720px">
      <div class="card-body">
        <h3 class="card-title mb-3">{{ isEdit ? 'Editar Cupom' : 'Novo Cupom' }}</h3>

        <form @submit.prevent="save">
          <div v-if="validationErrors.length" class="alert alert-danger">
            <ul class="mb-0">
              <li v-for="(err, idx) in validationErrors" :key="idx">{{ err }}</li>
            </ul>
          </div>
          <div v-if="serverError" class="alert alert-warning">{{ serverError }}</div>

          <div class="mb-3">
            <TextInput label="Código" labelClass="form-label" v-model="form.code" required inputClass="form-control" />
          </div>

          <div class="mb-3">
            <TextInput label="Descrição" labelClass="form-label" v-model="form.description" inputClass="form-control" />
          </div>

          <div class="row g-3">
            <div class="col-md-4">
              <label class="form-label">Tipo</label>
              <SelectInput  class="form-select"  v-model="form.isPercentage" >
                <option :value="true">Percentual</option>
                <option :value="false">Valor absoluto</option>
              </SelectInput>
            </div>

            <div class="col-md-8">
              <CurrencyInput label="Valor (se percentual coloque 0.1 = 10%)" labelClass="form-label" v-model="form.value" inputClass="form-control" placeholder="0,00" />
            </div>
          </div>

          <div class="row g-3 mt-3">
            <div class="col-md-8">
              <label class="form-label">Afiliado (opcional)</label>
              <SelectInput  class="form-select"  v-model="form.affiliateId" >
                <option :value="null">— Nenhum —</option>
                <option v-for="a in affiliates" :key="a.id" :value="a.id">{{ a.name }}</option>
              </SelectInput>
            </div>

            <div class="col-md-4">
              <label class="form-label">Status</label>
              <SelectInput  class="form-select"  v-model="form.isActive" >
                <option :value="true">Ativo</option>
                <option :value="false">Inativo</option>
              </SelectInput>
            </div>
          </div>

          <div class="row g-3 mt-3">
            <div class="col-md-6">
              <label class="form-label">Data de expiração (opcional)</label>
              <div class="date-picker-wrapper" style="position:relative">
                <DateInput v-model="internalDate" inputClass="form-control" aria-label="Escolher data de expiração" />
              </div>
            </div>
            <div class="col-md-6">
              <CurrencyInput label="Subtotal mínimo (opcional)" labelClass="form-label" v-model="form.minSubtotal" inputClass="form-control" :min="0" placeholder="0,00" />
            </div>
          </div>

          <div class="row g-3 mt-3">
            <div class="col-md-6">
              <label class="form-label">Máximo de usos (global) (opcional)</label>
              <input class="form-control" v-model.number="form.maxUses" type="number" min="0" />
            </div>
            <div class="col-md-6">
              <label class="form-label">Máximo de usos por cliente (opcional)</label>
              <input class="form-control" v-model.number="form.maxUsesPerCustomer" type="number" min="0" />
            </div>
          </div>

          <div class="form-actions mt-4 d-flex gap-2">
            <button class="btn btn-primary" type="submit">Salvar</button>
            <button class="btn btn-outline-secondary" type="button" @click="cancel">Cancelar</button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, onMounted, watch } from 'vue'
import api from '@/api.js'
import TextInput from '../components/form/input/TextInput.vue'
import DateInput from '../components/form/date/DateInput.vue'
import CurrencyInput from '../components/form/input/CurrencyInput.vue'
import SelectInput from '../components/form/select/SelectInput.vue'
import { useRoute, useRouter } from 'vue-router'

export default {
  name: 'CouponForm',
  components: { TextInput, DateInput, CurrencyInput, SelectInput },
  setup() {
    const route = useRoute()
    const router = useRouter()
    const isEdit = !!route.params.id
    const form = ref({ code: '', description: '', isPercentage: true, value: 0, affiliateId: null, isActive: true })
    const affiliates = ref([])

    const loadAffiliates = async () => {
      try {
        const res = await api.get('/affiliates')
        affiliates.value = res.data || []
      } catch (e) { console.error(e) }
    }

    const load = async () => {
      if (!isEdit) return
      try {
        const res = await api.get(`/coupons/${route.params.id}`)
        // normalize fields for form inputs
        const src = { ...res.data }
        // convert expiresAt to dd/mm/YYYY string if present
        if (src.expiresAt) {
          try{
            const d = new Date(src.expiresAt)
            const pad = (n)=>String(n).padStart(2,'0')
            const yyyy = d.getFullYear()
            const mm = pad(d.getMonth()+1)
            const dd = pad(d.getDate())
            src.expiresAtLocal = `${dd}/${mm}/${yyyy}`
            internalDate.value = `${yyyy}-${mm}-${dd}`
          }catch(e){ src.expiresAtLocal = ''; internalDate.value = '' }
        } else { src.expiresAtLocal = ''; internalDate.value = '' }
        form.value = src
      } catch (e) { console.error(e); alert('Erro ao carregar cupom') }
    }

  const validationErrors = ref([])
  const serverError = ref('')
  const internalDate = ref('') // yyyy-mm-dd used by native date input

  // keep display (dd/mm/YYYY) in sync when native picker changes
  watch(internalDate, (val) => {
    try{
      if (!val) { form.value.expiresAtLocal = ''; return }
      const parts = String(val).split('-')
      if (parts.length === 3) {
        const yyyy = parts[0]; const mm = parts[1]; const dd = parts[2]
        form.value.expiresAtLocal = `${dd}/${mm}/${yyyy}`
      }
    }catch(e){ /* ignore */ }
  })

    const validate = () => {
      validationErrors.value = []
      if (!form.value.code || String(form.value.code).trim() === '') validationErrors.value.push('Código é obrigatório')
      if (form.value.isPercentage) {
        if (Number(form.value.value) <= 0 || Number(form.value.value) > 1) validationErrors.value.push('Percentual deve ser > 0 e <= 1 (ex: 0.1 = 10%)')
      } else {
        if (Number(form.value.value) < 0) validationErrors.value.push('Valor absoluto deve ser >= 0')
      }
      // optional numeric rules
      if (form.value.minSubtotal !== undefined && form.value.minSubtotal !== null) {
        if (Number(form.value.minSubtotal) < 0) validationErrors.value.push('Subtotal mínimo deve ser >= 0')
      }
      if (form.value.maxUses !== undefined && form.value.maxUses !== null) {
        if (!Number.isFinite(Number(form.value.maxUses)) || Number(form.value.maxUses) < 0) validationErrors.value.push('Máximo de usos inválido')
      }
      if (form.value.maxUsesPerCustomer !== undefined && form.value.maxUsesPerCustomer !== null) {
        if (!Number.isFinite(Number(form.value.maxUsesPerCustomer)) || Number(form.value.maxUsesPerCustomer) < 0) validationErrors.value.push('Máximo de usos por cliente inválido')
      }
      // expiresAtLocal validation (dd/mm/YYYY)
      if (form.value.expiresAtLocal) {
        const s = String(form.value.expiresAtLocal).trim()
        const parts = s.split('/')
        if (parts.length !== 3) validationErrors.value.push('Data de expiração inválida (use dd/mm/YYYY)')
        else {
          const day = Number(parts[0])
          const month = Number(parts[1])
          const year = Number(parts[2])
          const ok = Number.isFinite(day) && Number.isFinite(month) && Number.isFinite(year) && day >=1 && month >=1 && month <=12 && year > 1900
          if (!ok) validationErrors.value.push('Data de expiração inválida (use dd/mm/YYYY)')
          else {
            const d = new Date(year, month-1, day)
            if (Number.isNaN(d.getTime())) validationErrors.value.push('Data de expiração inválida')
          }
        }
      }
      return validationErrors.value.length === 0
    }

    const save = async () => {
      serverError.value = ''
      try {
        if (!validate()) return
        // prepare payload: map expiresAtLocal -> expiresAt ISO if provided
        const payload = { ...form.value }
        // prefer internalDate (native yyyy-mm-dd) when available
        if (internalDate.value) {
          try{
            const parts = String(internalDate.value).split('-')
            if (parts.length === 3) {
              const yyyy = Number(parts[0])
              const mm = Number(parts[1])
              const dd = Number(parts[2])
              const d = new Date(yyyy, mm-1, dd)
              payload.expiresAt = Number.isFinite(d.getTime()) ? d.toISOString() : null
            } else payload.expiresAt = null
          }catch(e){ payload.expiresAt = null }
        } else if (payload.expiresAtLocal) {
          try{
            const s = String(payload.expiresAtLocal).trim()
            const parts = s.split('/')
            if (parts.length === 3) {
              const day = Number(parts[0])
              const month = Number(parts[1])
              const year = Number(parts[2])
              const d = new Date(year, month-1, day)
              payload.expiresAt = Number.isFinite(d.getTime()) ? d.toISOString() : null
            } else payload.expiresAt = null
          }catch(e){ payload.expiresAt = null }
        } else {
          payload.expiresAt = null
        }
        // remove helper local field before sending
        delete payload.expiresAtLocal

        if (isEdit) {
          await api.put(`/coupons/${route.params.id}`, payload)
        } else {
          await api.post('/coupons', payload)
        }
        router.push('/coupons')
      } catch (e) {
        console.error(e)
        serverError.value = e.response?.data?.message || 'Erro ao salvar'
      }
    }

    const cancel = () => router.back()

    onMounted(() => { loadAffiliates(); load() })

    // expose internalDate so the template's v-model can bind to it
    return { isEdit, form, affiliates, save, cancel, validationErrors, serverError, internalDate, load }
  }
}
</script>

<style scoped>
.coupon-form { padding: 20px }
.form-group { margin-bottom: 12px }
.form-actions { margin-top: 16px }
.date-picker-wrapper { min-width: 220px }
.calendar-icon { position: absolute; right: 10px; top: 50%; transform: translateY(-50%); z-index: 3; pointer-events: none; color: #6c757d; }
.calendar-icon svg { display: block }
</style>
