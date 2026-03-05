<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import api from '../api'

const route = useRoute()

const status = computed(() => route.query.status || 'unknown')
const paymentId = computed(() => route.query.payment_id || route.query.external_reference || null)
const polling = ref(false)
const paymentStatus = ref(null)
let intervalId = null

const statusConfig = computed(() => {
  const s = paymentStatus.value === 'PAID' ? 'success' : paymentStatus.value === 'FAILED' ? 'failure' : status.value
  switch (s) {
    case 'success':
    case 'approved':
      return { icon: 'bi-check-circle-fill', color: 'text-success', title: 'Pagamento aprovado!', desc: 'Seu pagamento foi processado com sucesso.' }
    case 'pending':
    case 'in_process':
      return { icon: 'bi-clock-fill', color: 'text-warning', title: 'Pagamento pendente', desc: 'Estamos aguardando a confirmação do pagamento.' }
    case 'failure':
    case 'rejected':
      return { icon: 'bi-x-circle-fill', color: 'text-danger', title: 'Pagamento recusado', desc: 'O pagamento não foi aprovado. Tente novamente.' }
    default:
      return { icon: 'bi-question-circle-fill', color: 'text-muted', title: 'Status desconhecido', desc: 'Não foi possível determinar o status do pagamento.' }
  }
})

async function pollStatus() {
  if (!paymentId.value) return
  polling.value = true
  try {
    const { data } = await api.get(`/payment/status/${paymentId.value}`)
    paymentStatus.value = data.status
    if (data.status === 'PAID' || data.status === 'FAILED') {
      if (intervalId) clearInterval(intervalId)
    }
  } catch (e) { /* ignore */ }
  finally { polling.value = false }
}

onMounted(() => {
  if (paymentId.value) {
    pollStatus()
    intervalId = setInterval(pollStatus, 5000)
    setTimeout(() => { if (intervalId) clearInterval(intervalId) }, 120000)
  }
})

onUnmounted(() => { if (intervalId) clearInterval(intervalId) })
</script>

<template>
  <div class="container py-5 text-center" style="max-width: 500px;">
    <i :class="['bi', statusConfig.icon, statusConfig.color]" style="font-size: 4rem;"></i>
    <h2 class="mt-3 mb-2">{{ statusConfig.title }}</h2>
    <p class="text-muted mb-4">{{ statusConfig.desc }}</p>

    <div v-if="polling && paymentStatus !== 'PAID'" class="mb-3">
      <div class="spinner-border spinner-border-sm text-primary me-2" role="status"></div>
      <span class="text-muted">Verificando status...</span>
    </div>

    <div v-if="paymentStatus === 'PAID'" class="alert alert-success">
      Pagamento confirmado!
    </div>

    <div class="d-flex flex-column gap-2">
      <router-link to="/store" class="btn btn-primary">Voltar para a loja</router-link>
      <router-link to="/orders" class="btn btn-outline-secondary">Ir para pedidos</router-link>
    </div>
  </div>
</template>
