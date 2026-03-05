<script setup>
import { ref, onMounted } from 'vue'
import { useAddOnStoreStore } from '../stores/addOnStore'

const store = useAddOnStoreStore()
const period = ref('MONTHLY')

function getPrice(mod, p) {
  if (!mod.prices || !mod.prices.length) return null
  const found = mod.prices.find(pr => pr.period === p)
  return found ? Number(found.price) : null
}

function formatPrice(val) {
  if (val == null) return '—'
  return 'R$ ' + val.toFixed(2)
}

onMounted(() => {
  store.fetchStoreModules()
})
</script>

<template>
  <div class="container py-3">
    <h2 class="mb-3">Loja de Complementos</h2>

    <!-- Period toggle -->
    <div class="btn-group mb-4" role="group">
      <button
        class="btn"
        :class="period === 'MONTHLY' ? 'btn-primary' : 'btn-outline-primary'"
        @click="period = 'MONTHLY'"
      >Mensal</button>
      <button
        class="btn"
        :class="period === 'ANNUAL' ? 'btn-primary' : 'btn-outline-primary'"
        @click="period = 'ANNUAL'"
      >Anual</button>
    </div>

    <!-- Loading -->
    <div v-if="store.loading" class="text-center py-5">
      <div class="spinner-border text-primary" role="status">
        <span class="visually-hidden">Carregando...</span>
      </div>
    </div>

    <!-- Error -->
    <div v-else-if="store.error" class="alert alert-danger">
      {{ store.error }}
    </div>

    <!-- Modules grid -->
    <div v-else>
      <div class="row g-3">
        <div
          v-for="mod in store.modules"
          :key="mod.id"
          class="col-md-6 col-lg-4"
        >
          <div class="card h-100">
            <div class="card-body d-flex flex-column">
              <div class="d-flex justify-content-between align-items-start mb-2">
                <h5 class="card-title mb-0">{{ mod.name }}</h5>
                <span v-if="mod.isSubscribed" class="badge bg-success">Ativo</span>
              </div>
              <p class="card-text text-muted flex-grow-1">{{ mod.description }}</p>
              <div class="mb-3">
                <span class="fs-4 fw-bold">{{ formatPrice(getPrice(mod, period)) }}</span>
                <span class="text-muted">/{{ period === 'MONTHLY' ? 'mês' : 'ano' }}</span>
              </div>
              <div class="d-flex gap-2">
                <router-link
                  :to="`/store/${mod.key.toLowerCase()}`"
                  class="btn btn-outline-primary flex-grow-1"
                >Ver detalhes</router-link>
                <router-link
                  v-if="mod.isSubscribed"
                  :to="`/store/${mod.key.toLowerCase()}`"
                  class="btn btn-secondary"
                >Gerenciar</router-link>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Empty state -->
      <div v-if="!store.modules.length" class="text-center text-muted py-5">
        Nenhum módulo disponível no momento.
      </div>

      <!-- AI Credits section -->
      <hr class="my-4" />
      <div class="card">
        <div class="card-body d-flex justify-content-between align-items-center">
          <div>
            <h5 class="mb-1"><i class="bi bi-stars me-2"></i>Créditos de IA</h5>
            <p class="text-muted mb-0">Compre pacotes adicionais de créditos para funcionalidades de inteligência artificial.</p>
          </div>
          <router-link to="/store/credits" class="btn btn-primary">
            Ver pacotes
          </router-link>
        </div>
      </div>
    </div>
  </div>
</template>
