<template>
  <div class="affiliate-page">
    <h1>Registrar Venda Manual</h1>

    <div v-if="loading">Carregando...</div>

    <div v-else>
      <AffiliateSaleForm
        :affiliate="affiliate"
        :initialAmount="saleForm.saleAmount"
        :processing="processing"
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
import AffiliateSaleForm from '@/components/AffiliateSaleForm.vue'

export default {
  name: 'AffiliateSaleNew',
  components: { AffiliateSaleForm },
  setup() {
    const route = useRoute()
    const router = useRouter()
    const affiliate = ref(null)
  const loading = ref(true)
  bindLoading(loading)
    const processing = ref(false)

    const saleForm = ref({ saleAmount: '', note: '' })

    const load = async () => {
      loading.value = true
      try {
        const res = await api.get(`/affiliates/${route.params.id}`)
        affiliate.value = res.data
      } catch (err) {
        console.error('Failed to load affiliate', err)
      } finally {
        loading.value = false
      }
    }

    const commissionAmount = computed(() => {
      const amt = Number(saleForm.value.saleAmount || 0)
      const rate = Number(affiliate.value?.commissionRate || 0)
      return amt * rate
    })

    const handleSubmit = async (payload) => {
      if (!affiliate.value) return
      processing.value = true
      try {
        await api.post(`/affiliates/${affiliate.value.id}/sales`, payload)
        router.push('/affiliates')
      } catch (err) {
        await Swal.fire({ icon: 'error', text: err.response?.data?.message || 'Erro ao registrar venda' })
      } finally {
        processing.value = false
      }
    }

    const onCancel = () => router.push('/affiliates')

    onMounted(load)

    return { affiliate, loading, saleForm, commissionAmount, handleSubmit, onCancel, processing }
  }
}
</script>

<style scoped>
.affiliate-page { padding: 20px }
.form-group { margin-bottom: 16px }
.commission-preview { margin: 12px 0; font-weight: bold }
.form-actions { display:flex; gap:12px; justify-content:flex-end }
.btn-primary { background:#3498db; color:white; padding:8px 16px; border-radius:6px }
.btn-secondary { background:#f8f9fa; padding:8px 16px; border-radius:6px }
</style>
