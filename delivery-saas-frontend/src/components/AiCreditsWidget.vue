<template>
  <!-- Versão compacta (sidebar) -->
  <div v-if="compact" class="ai-credits-widget-compact px-3 pb-2">
    <div class="d-flex align-items-center justify-content-between mb-1">
      <small class="text-muted fw-semibold">
        <i class="bi bi-stars me-1"></i>Créditos IA
      </small>
      <small v-if="store.balance !== null" :class="badgeClass">
        {{ store.balance }} / {{ store.monthlyLimit }}
      </small>
      <small v-else class="text-muted">—</small>
    </div>
    <div class="progress" style="height: 5px;">
      <div
        class="progress-bar"
        :class="`bg-${store.progressVariant()}`"
        :style="{ width: store.percent() + '%' }"
        role="progressbar"
      ></div>
    </div>
    <div class="d-flex justify-content-between mt-1">
      <small v-if="store.balance === 0" class="text-danger">
        <a href="#" class="text-danger" @click.prevent="$emit('upgrade')">Upgrade de Plano</a>
      </small>
      <small v-else-if="store.nextResetFormatted()" class="text-muted">
        Renova em {{ store.nextResetFormatted() }}
      </small>
    </div>
  </div>

  <!-- Versão expandida (card completo para painéis/modais) -->
  <div v-else class="card border-0 shadow-sm">
    <div class="card-body p-3">
      <div class="d-flex align-items-center justify-content-between mb-2">
        <span class="fw-semibold">
          <i class="bi bi-stars me-1 text-primary"></i>Créditos de IA
        </span>
        <span v-if="store.loading" class="spinner-border spinner-border-sm text-primary"></span>
        <span v-else-if="store.balance !== null" class="badge" :class="`bg-${store.progressVariant()}`">
          {{ store.balance }} créditos
        </span>
      </div>

      <div class="progress mb-2" style="height: 8px;">
        <div
          class="progress-bar"
          :class="`bg-${store.progressVariant()}`"
          :style="{ width: store.percent() + '%' }"
          role="progressbar"
          :aria-valuenow="store.percent()"
          aria-valuemin="0"
          aria-valuemax="100"
        ></div>
      </div>

      <div class="d-flex justify-content-between align-items-center">
        <small class="text-muted">{{ store.balance ?? '—' }} / {{ store.monthlyLimit }} mensais</small>
        <small v-if="store.balance === 0" class="text-danger fw-semibold">
          <i class="bi bi-exclamation-triangle me-1"></i>
          <a href="#" class="text-danger" @click.prevent="$emit('upgrade')">Upgrade de Plano</a>
        </small>
        <small v-else-if="store.nextResetFormatted()" class="text-muted">
          Renova em {{ store.nextResetFormatted() }}
        </small>
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted } from 'vue'
import { useAiCreditsStore } from '../stores/aiCredits.js'

const props = defineProps({
  /** Exibe versão compacta para sidebar (linha única + mini barra) */
  compact: { type: Boolean, default: false },
})

defineEmits(['upgrade'])

const store = useAiCreditsStore()

const badgeClass = {
  'text-success': store.progressVariant() === 'success',
  'text-warning': store.progressVariant() === 'warning',
  'text-danger': store.progressVariant() === 'danger',
}

onMounted(() => {
  if (store.balance === null) store.fetch()
})
</script>
