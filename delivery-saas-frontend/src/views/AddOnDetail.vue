<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useAddOnStoreStore } from '../stores/addOnStore'
import { useModulesStore } from '../stores/modules'

const route = useRoute()
const store = useAddOnStoreStore()
const modulesStore = useModulesStore()

const selectedPeriod = ref('MONTHLY')
const subscribing = ref(false)
const cancelling = ref(false)

const moduleKey = computed(() => String(route.params.moduleKey || '').toUpperCase())

const mod = computed(() => {
  return store.modules.find(m => m.key === moduleKey.value) || null
})

function getPrice(period) {
  if (!mod.value || !mod.value.prices) return null
  const found = mod.value.prices.find(p => p.period === period)
  return found ? Number(found.price) : null
}

function formatPrice(val) {
  if (val == null) return '—'
  return 'R$ ' + val.toFixed(2)
}

const annualSavings = computed(() => {
  const monthly = getPrice('MONTHLY')
  const annual = getPrice('ANNUAL')
  if (!monthly || !annual || monthly <= 0) return null
  const yearlyIfMonthly = monthly * 12
  if (yearlyIfMonthly <= annual) return null
  return Math.round(((yearlyIfMonthly - annual) / yearlyIfMonthly) * 100)
})

const selectedPrice = computed(() => getPrice(selectedPeriod.value))

async function subscribe() {
  if (!mod.value) return
  subscribing.value = true
  try {
    await store.subscribeToModule(mod.value.id, selectedPeriod.value)
    await modulesStore.fetchEnabled(true)
  } catch (e) {
    alert(e?.response?.data?.message || 'Erro ao processar pagamento')
  } finally {
    subscribing.value = false
  }
}

async function cancel() {
  if (!mod.value) return
  if (!confirm(`Deseja realmente cancelar a assinatura do módulo "${mod.value.name}"?`)) return
  cancelling.value = true
  try {
    await store.cancelModuleSubscription(mod.value.id)
    await modulesStore.fetchEnabled(true)
  } catch (e) {
    alert(e?.response?.data?.message || 'Erro ao cancelar módulo')
  } finally {
    cancelling.value = false
  }
}

onMounted(async () => {
  if (!store.modules.length) {
    await store.fetchStoreModules()
  }
})
</script>

<template>
  <div class="container py-3">
    <router-link to="/store" class="text-decoration-none mb-3 d-inline-block">
      <i class="bi bi-arrow-left me-1"></i>Voltar para a loja
    </router-link>

    <!-- Loading -->
    <div v-if="store.loading" class="text-center py-5">
      <div class="spinner-border text-primary" role="status">
        <span class="visually-hidden">Carregando...</span>
      </div>
    </div>

    <!-- Not found -->
    <div v-else-if="!mod" class="alert alert-warning mt-3">
      Módulo não encontrado.
    </div>

    <template v-else>
      <h2 class="mb-2">{{ mod.name }}</h2>
      <p class="text-muted">{{ mod.description }}</p>

      <!-- Active status -->
      <div v-if="mod.isSubscribed" class="alert alert-success d-flex align-items-center mb-4">
        <i class="bi bi-check-circle-fill me-2 fs-5"></i>
        <span>Este módulo está ativo na sua conta.</span>
      </div>

      <!-- Pricing card -->
      <div class="card mb-4" style="max-width: 480px;">
        <div class="card-header">
          <h6 class="mb-0">Escolha o período</h6>
        </div>
        <div class="card-body">
          <div class="list-group list-group-flush mb-3">
            <button
              class="list-group-item list-group-item-action d-flex justify-content-between align-items-center"
              :class="{ active: selectedPeriod === 'MONTHLY' }"
              @click="selectedPeriod = 'MONTHLY'"
            >
              <span>Mensal</span>
              <span class="fw-bold">{{ formatPrice(getPrice('MONTHLY')) }}/mês</span>
            </button>
            <button
              class="list-group-item list-group-item-action d-flex justify-content-between align-items-center"
              :class="{ active: selectedPeriod === 'ANNUAL' }"
              @click="selectedPeriod = 'ANNUAL'"
            >
              <div>
                <span>Anual</span>
                <span v-if="annualSavings" class="badge bg-success ms-2">{{ annualSavings }}% de economia</span>
              </div>
              <span class="fw-bold">{{ formatPrice(getPrice('ANNUAL')) }}/ano</span>
            </button>
          </div>

          <!-- Subscribe CTA -->
          <button
            v-if="!mod.isSubscribed"
            class="btn btn-primary w-100"
            :disabled="subscribing || selectedPrice == null"
            @click="subscribe"
          >
            <span v-if="subscribing" class="spinner-border spinner-border-sm me-1" role="status"></span>
            Pagar {{ formatPrice(selectedPrice) }} e ativar
          </button>

          <!-- Cancel -->
          <button
            v-if="mod.isSubscribed"
            class="btn btn-outline-danger w-100"
            :disabled="cancelling"
            @click="cancel"
          >
            <span v-if="cancelling" class="spinner-border spinner-border-sm me-1" role="status"></span>
            Cancelar assinatura
          </button>
        </div>
      </div>
    </template>
  </div>
</template>
