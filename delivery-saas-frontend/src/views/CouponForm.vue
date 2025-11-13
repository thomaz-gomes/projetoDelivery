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
            <label class="form-label">Código</label>
            <input class="form-control" v-model="form.code" required />
          </div>

          <div class="mb-3">
            <label class="form-label">Descrição</label>
            <input class="form-control" v-model="form.description" />
          </div>

          <div class="row g-3">
            <div class="col-md-4">
              <label class="form-label">Tipo</label>
              <select class="form-select" v-model="form.isPercentage">
                <option :value="true">Percentual</option>
                <option :value="false">Valor absoluto</option>
              </select>
            </div>

            <div class="col-md-8">
              <label class="form-label">Valor (se percentual coloque 0.1 = 10%)</label>
              <input class="form-control" v-model.number="form.value" type="number" step="0.01" />
            </div>
          </div>

          <div class="row g-3 mt-3">
            <div class="col-md-8">
              <label class="form-label">Afiliado (opcional)</label>
              <select class="form-select" v-model="form.affiliateId">
                <option :value="null">— Nenhum —</option>
                <option v-for="a in affiliates" :key="a.id" :value="a.id">{{ a.name }}</option>
              </select>
            </div>

            <div class="col-md-4">
              <label class="form-label">Status</label>
              <select class="form-select" v-model="form.isActive">
                <option :value="true">Ativo</option>
                <option :value="false">Inativo</option>
              </select>
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
import { ref, onMounted } from 'vue'
import api from '@/api.js'
import { useRoute, useRouter } from 'vue-router'

export default {
  name: 'CouponForm',
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
        form.value = { ...res.data }
      } catch (e) { console.error(e); alert('Erro ao carregar cupom') }
    }

  const validationErrors = ref([])
  const serverError = ref('')

    const validate = () => {
      validationErrors.value = []
      if (!form.value.code || String(form.value.code).trim() === '') validationErrors.value.push('Código é obrigatório')
      if (form.value.isPercentage) {
        if (Number(form.value.value) <= 0 || Number(form.value.value) > 1) validationErrors.value.push('Percentual deve ser > 0 e <= 1 (ex: 0.1 = 10%)')
      } else {
        if (Number(form.value.value) < 0) validationErrors.value.push('Valor absoluto deve ser >= 0')
      }
      return validationErrors.value.length === 0
    }

    const save = async () => {
      serverError.value = ''
      try {
        if (!validate()) return

        if (isEdit) {
          await api.put(`/coupons/${route.params.id}`, form.value)
        } else {
          await api.post('/coupons', form.value)
        }
        router.push('/coupons')
      } catch (e) {
        console.error(e)
        serverError.value = e.response?.data?.message || 'Erro ao salvar'
      }
    }

    const cancel = () => router.back()

    onMounted(() => { loadAffiliates(); load() })

    return { isEdit, form, affiliates, save, cancel, validationErrors, serverError }
  }
}
</script>

<style scoped>
.coupon-form { padding: 20px }
.form-group { margin-bottom: 12px }
.form-actions { margin-top: 16px }
</style>
