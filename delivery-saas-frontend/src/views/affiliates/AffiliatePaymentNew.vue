<template>
  <div class="affiliate-page">
    <h1>Registrar Pagamento</h1>

    <div v-if="loading">Carregando...</div>

    <div v-else>
      <AffiliatePaymentForm
        :affiliate="affiliate"
        :initialAmount="affiliate?.currentBalance || 0"
        :processing="processing"
        :accounts="accounts"
        @submit="handleSubmit"
        @cancel="onCancel"
      />
    </div>
  </div>
</template>

<script>
import { ref, computed, onMounted } from 'vue'
import Swal from 'sweetalert2'
import { useRoute, useRouter } from 'vue-router'
import api from '@/api.js'
import { bindLoading } from '../../state/globalLoading.js'
import AffiliatePaymentForm from '@/components/AffiliatePaymentForm.vue'

export default {
  name: 'AffiliatePaymentNew',
  components: { AffiliatePaymentForm },
  setup() {
    const route = useRoute()
    const router = useRouter()
    const affiliate = ref(null)
    const accounts = ref([])
  const loading = ref(true)
  bindLoading(loading)
    const processing = ref(false)

    const paymentForm = ref({ amount: '', method: '', note: '' })

    const load = async () => {
      loading.value = true
      try {
        const res = await api.get(`/affiliates/${route.params.id}`)
        affiliate.value = res.data
        // normalize numeric
        affiliate.value.currentBalance = Number(affiliate.value.currentBalance || 0)
      } catch (err) {
        console.error('Failed to load affiliate', err)
      }
      // Load financial accounts (module may be disabled)
      try {
        const { data } = await api.get('/financial/accounts')
        accounts.value = Array.isArray(data) ? data.filter(a => a.isActive !== false) : []
      } catch (_) {
        accounts.value = []
      }
      loading.value = false
    }

    const setMax = () => {
      paymentForm.value.amount = Number(affiliate.value?.currentBalance || 0)
    }

    const canSubmit = computed(() => {
      return Number(paymentForm.value.amount) > 0 && Number(paymentForm.value.amount) <= Number(affiliate.value?.currentBalance || 0)
    })

    const handleSubmit = async (payload) => {
      // payload: { amount, method, note }
      if (!affiliate.value) return
      processing.value = true
      try {
        await api.post(`/affiliates/${affiliate.value.id}/payments`, payload)
        router.push('/affiliates')
      } catch (err) {
        await Swal.fire({ icon: 'error', text: err.response?.data?.message || 'Erro ao processar pagamento' })
      } finally {
        processing.value = false
      }
    }

    const onCancel = () => router.push('/affiliates')

    onMounted(load)

    return { affiliate, accounts, loading, handleSubmit, onCancel, processing }
  }
}
</script>

<style scoped>
.affiliate-page { padding: 20px }
.form-group { margin-bottom: 16px }
.form-actions { display:flex; gap:12px; justify-content:flex-end }
.btn-primary { background:#3498db; color:white; padding:8px 16px; border-radius:6px }
.btn-secondary { background:#f8f9fa; padding:8px 16px; border-radius:6px }
.btn-max { margin-left:8px }
</style>
