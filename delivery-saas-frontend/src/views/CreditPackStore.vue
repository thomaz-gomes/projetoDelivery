<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAddOnStoreStore } from '../stores/addOnStore'
import { useAiCreditsStore } from '../stores/aiCredits'

const router = useRouter()
const store = useAddOnStoreStore()
const credits = useAiCreditsStore()

const purchasing = ref(null) // packId being purchased

function formatPrice(val) {
  if (val == null) return '—'
  return 'R$ ' + Number(val).toFixed(2)
}

async function purchase(pack) {
  if (!confirm(`Confirma a compra de "${pack.name}" por ${formatPrice(pack.price)}? Você será redirecionado para o pagamento.`)) return
  purchasing.value = pack.id
  try {
    const result = await store.purchaseCreditPack(pack.id)
    if (result?.manual) {
      alert(result.message || 'Fatura gerada. Acesse Cobranças para efetuar o pagamento.')
      router.push('/billing')
      return
    }
    await credits.fetch()
  } catch (e) {
    alert(e?.response?.data?.message || 'Erro ao processar pagamento')
  } finally {
    purchasing.value = null
  }
}

onMounted(() => {
  store.fetchCreditPacks()
  credits.fetch()
})
</script>

<template>
  <div class="container py-3">
    <router-link to="/store" class="text-decoration-none mb-3 d-inline-block">
      <i class="bi bi-arrow-left me-1"></i>Voltar para a loja
    </router-link>

    <h2 class="mb-4">Créditos de IA</h2>

    <!-- Current balance card -->
    <div class="card mb-4" style="max-width: 360px;">
      <div class="card-body text-center">
        <p class="text-muted mb-1">Saldo atual</p>
        <p class="display-5 fw-bold mb-0">{{ credits.balance ?? '—' }}</p>
        <p class="text-muted small">créditos disponíveis</p>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="!store.creditPacks.length && store.loading" class="text-center py-4">
      <div class="spinner-border text-primary" role="status">
        <span class="visually-hidden">Carregando...</span>
      </div>
    </div>

    <!-- Error -->
    <div v-if="store.error" class="alert alert-danger">
      {{ store.error }}
    </div>

    <!-- Credit packs grid -->
    <div class="row g-3">
      <div
        v-for="pack in store.creditPacks"
        :key="pack.id"
        class="col-md-6"
      >
        <div class="card h-100">
          <div class="card-body d-flex flex-column text-center">
            <h5 class="card-title">{{ pack.name }}</h5>
            <p class="display-6 fw-bold text-primary my-2">{{ pack.credits }}</p>
            <p class="text-muted mb-3">créditos</p>
            <p class="fs-5 fw-semibold mb-3">{{ formatPrice(pack.price) }}</p>
            <button
              class="btn btn-primary mt-auto"
              :disabled="purchasing === pack.id"
              @click="purchase(pack)"
            >
              <span v-if="purchasing === pack.id" class="spinner-border spinner-border-sm me-1" role="status"></span>
              Comprar
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Empty state -->
    <div v-if="!store.creditPacks.length && !store.loading" class="text-center text-muted py-4">
      Nenhum pacote disponível no momento.
    </div>
  </div>
</template>
