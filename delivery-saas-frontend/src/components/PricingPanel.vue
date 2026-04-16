<template>
  <div class="pricing-panel">
    <!-- Not saved yet -->
    <div v-if="!productId" class="alert alert-info">
      Salve o produto primeiro para ver a análise de precificação.
    </div>

    <!-- Loading -->
    <div v-else-if="loading" class="text-center py-4">
      <div class="spinner-border text-primary" role="status">
        <span class="visually-hidden">Carregando...</span>
      </div>
    </div>

    <!-- Error -->
    <div v-else-if="errorMsg" class="alert alert-danger">{{ errorMsg }}</div>

    <!-- Data loaded -->
    <div v-else-if="data">
      <!-- Section 1: Composição de custo -->
      <div class="card bg-light mb-4">
        <div class="card-body">
          <h6 class="card-title mb-3">Composição de custo</h6>
          <table class="table table-sm table-borderless mb-0">
            <tbody>
              <tr>
                <td>Ficha técnica</td>
                <td class="text-end">{{ formatCurrency(data.sheetCost) }}</td>
              </tr>
              <tr>
                <td>Embalagem</td>
                <td class="text-end">{{ formatCurrency(data.packagingCost) }}</td>
              </tr>
              <tr>
                <td colspan="2"><hr class="my-1" /></td>
              </tr>
              <tr class="fw-bold">
                <td>Custo direto</td>
                <td class="text-end">{{ formatCurrency((data.sheetCost || 0) + (data.packagingCost || 0)) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Section 2: Deduções sobre venda -->
      <div class="card bg-light mb-4">
        <div class="card-body">
          <h6 class="card-title mb-3">Deduções sobre venda</h6>
          <table class="table table-sm table-borderless mb-0">
            <tbody>
              <tr>
                <td>Imposto (Simples)</td>
                <td class="text-end">{{ formatPercent(data.taxBreakdown?.salesTax) }}</td>
              </tr>
              <tr>
                <td>Marketplace</td>
                <td class="text-end">{{ formatPercent(data.taxBreakdown?.marketplaceFee) }}</td>
              </tr>
              <tr>
                <td>Cartão</td>
                <td class="text-end">{{ formatPercent(data.taxBreakdown?.cardFee) }}</td>
              </tr>
              <tr>
                <td colspan="2"><hr class="my-1" /></td>
              </tr>
              <tr class="fw-bold">
                <td>Total deduções</td>
                <td class="text-end">{{ formatPercent(data.taxBreakdown?.totalDeductionPct) }}</td>
              </tr>
            </tbody>
          </table>
          <div class="small text-muted mt-2">Edite em Configurações &rarr; Loja &rarr; Precificação</div>
        </div>
      </div>

      <!-- Section 3: Margem-alvo -->
      <div class="card bg-light mb-4">
        <div class="card-body">
          <h6 class="card-title mb-3">Margem-alvo</h6>
          <div class="d-flex align-items-center gap-2">
            <span class="pricing-kpi-value">{{ formatPercent(data.targetMarginPercent) }}</span>
            <span class="badge bg-primary">Margem-alvo</span>
          </div>
          <div class="small text-muted mt-2">Margem-alvo definida nos defaults da loja</div>
        </div>
      </div>

      <!-- Section 4: Resultado -->
      <div class="card mb-4">
        <div class="card-body">
          <h6 class="card-title mb-3">Resultado</h6>

          <!-- Preço sugerido -->
          <div class="mb-3">
            <div class="pricing-label">Preço sugerido</div>
            <div class="pricing-kpi-value">{{ formatCurrency(data.suggestedPrice) }}</div>
          </div>

          <!-- Preço atual + delta -->
          <div class="mb-3">
            <div class="pricing-label">Preço atual</div>
            <div class="d-flex align-items-center gap-2">
              <span class="pricing-kpi-value">{{ formatCurrency(data.currentPrice) }}</span>
              <span v-if="data.delta != null" :class="deltaClass">
                {{ data.delta >= 0 ? '+' : '' }}{{ formatCurrency(data.delta) }}
              </span>
            </div>
          </div>

          <!-- CMV atual -->
          <div class="mb-3">
            <div class="pricing-label">CMV atual</div>
            <div class="d-flex align-items-center gap-2">
              <span class="pricing-kpi-value">{{ formatPercent(data.cmvPercent) }}</span>
              <span :class="['badge', cmvBadgeClass]">{{ cmvBadgeText }}</span>
            </div>
          </div>

          <!-- Margem real -->
          <div class="mb-3">
            <div class="pricing-label">Margem real</div>
            <div class="pricing-kpi-value">{{ formatPercent(data.actualMarginPercent) }}</div>
          </div>

          <!-- Apply button -->
          <button
            type="button"
            class="btn btn-primary"
            :disabled="!data?.suggestedPrice"
            @click="$emit('apply-suggested-price', data.suggestedPrice)"
          >
            Aplicar preço sugerido
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, onMounted, computed } from 'vue'
import api from '../api'

const props = defineProps({
  productId: { type: String, required: true },
  currentPrice: { type: Number, default: 0 }
})

defineEmits(['apply-suggested-price'])

const data = ref(null)
const loading = ref(false)
const errorMsg = ref('')

function formatCurrency(value) {
  if (value == null) return 'R$ 0,00'
  return Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatPercent(value) {
  if (value == null) return '0,0%'
  return Number(value).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%'
}

const deltaClass = computed(() => {
  if (!data.value || data.value.delta == null) return ''
  return data.value.delta < 0 ? 'text-danger fw-bold' : 'text-success fw-bold'
})

const cmvBadgeClass = computed(() => {
  if (!data.value) return 'bg-secondary'
  switch (data.value.cmvStatus) {
    case 'healthy': return 'bg-success'
    case 'warning': return 'bg-warning text-dark'
    case 'critical': return 'bg-danger'
    case 'over_priced': return 'bg-info'
    default: return 'bg-secondary'
  }
})

const cmvBadgeText = computed(() => {
  if (!data.value) return ''
  switch (data.value.cmvStatus) {
    case 'healthy': return 'Saudável'
    case 'warning': return 'Atenção'
    case 'critical': return 'Crítico'
    case 'over_priced': return 'Possível sobrepreço'
    default: return data.value.cmvStatus || ''
  }
})

async function fetchPricing() {
  if (!props.productId) return
  loading.value = true
  errorMsg.value = ''
  data.value = null
  try {
    const res = await api.get(`/menu/products/${props.productId}/pricing-analysis`)
    data.value = res.data
  } catch (e) {
    errorMsg.value = e?.response?.data?.message || e.message || 'Erro ao carregar análise de precificação'
  } finally {
    loading.value = false
  }
}

onMounted(() => fetchPricing())

let debounceTimer = null;
watch(() => props.currentPrice, () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => fetchPricing(), 400);
})
</script>

<style scoped>
.pricing-kpi-value {
  font-size: 1.5rem;
  font-weight: 700;
}

.pricing-label {
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--text-secondary, #6c757d);
}
</style>
