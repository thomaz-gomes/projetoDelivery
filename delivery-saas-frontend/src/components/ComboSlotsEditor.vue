<template>
  <div class="combo-slots-editor">
    <div v-if="loading" class="text-muted small mb-3">
      <span class="spinner-border spinner-border-sm me-1"></span>
      Carregando produtos...
    </div>

    <div v-if="!loading && slots.length === 0" class="alert alert-info py-2 small mb-3">
      <i class="bi bi-info-circle me-1"></i>
      Nenhum slot configurado. Adicione um slot para definir os componentes deste combo.
    </div>

    <div
      v-if="slots.length > 0 && precoComboNum > 0"
      :class="['alert', 'py-2', 'small', 'mb-3', somaExcede ? 'alert-danger' : 'alert-secondary']"
    >
      <i :class="['bi', somaExcede ? 'bi-exclamation-triangle-fill' : 'bi-info-circle', 'me-1']"></i>
      <strong>Soma dos valores declarados:</strong>
      R$ {{ somaDeclarada.toFixed(2) }} de R$ {{ precoComboNum.toFixed(2) }}
      <span v-if="somaExcede">
        — excede o preço do combo em R$ {{ (somaDeclarada - precoComboNum).toFixed(2) }}.
      </span>
      <span v-else-if="restanteDisponivel > 0">
        — resta R$ {{ restanteDisponivel.toFixed(2) }} para distribuir.
      </span>
    </div>

    <div
      v-for="(slot, sIdx) in slots"
      :key="sIdx"
      :class="['card', 'mb-3', 'combo-slot-card', somaExcede ? 'combo-slot-card--invalid' : '']"
    >
      <div class="card-body">
        <div class="d-flex align-items-center mb-3 gap-2">
          <div class="combo-slot-badge">
            <i class="bi bi-collection me-1"></i>
            Slot {{ sIdx + 1 }}
          </div>
          <div class="flex-grow-1">
            <TextInput
              v-model="slot.name"
              placeholder="Ex: Lanche, Bebida, Acompanhamento"
              maxlength="60"
            />
          </div>
          <BaseIconButton
            color="danger"
            title="Remover slot"
            @click="removeSlot(sIdx)"
          >
            <i class="bi bi-trash"></i>
          </BaseIconButton>
        </div>

        <div class="row g-2 mb-3">
          <div class="col-6 col-md-3">
            <label class="form-label small mb-1">Mínimo</label>
            <input
              type="number"
              min="0"
              class="form-control form-control-sm"
              v-model.number="slot.minSelect"
            />
          </div>
          <div class="col-6 col-md-3">
            <label class="form-label small mb-1">Máximo</label>
            <input
              type="number"
              min="1"
              class="form-control form-control-sm"
              v-model.number="slot.maxSelect"
            />
          </div>
          <div class="col-12 col-md-6">
            <label class="form-label small mb-1">Valor declarado (NFC-e)</label>
            <CurrencyInput
              v-model="slot.vUnComDeclarado"
              :inputClass="'form-control form-control-sm' + (somaExcede ? ' is-invalid' : '')"
              placeholder="0,00"
            />
            <small :class="somaExcede ? 'text-danger' : 'text-muted'">
              Valor que cada opção deste slot terá no `&lt;vUnCom&gt;` da nota fiscal.
            </small>
          </div>
        </div>

        <div class="combo-options-section">
          <div class="d-flex align-items-center justify-content-between mb-2">
            <label class="form-label small mb-0 fw-semibold">
              Opções deste slot ({{ (slot.options || []).length }})
            </label>
          </div>

          <div
            v-if="!slot.options || slot.options.length === 0"
            class="text-muted small fst-italic mb-2"
          >
            Nenhuma opção. Adicione produtos que o cliente poderá escolher neste slot.
          </div>

          <div
            v-for="(opt, oIdx) in slot.options || []"
            :key="oIdx"
            class="combo-option-row mb-2"
          >
            <div class="row g-2 align-items-end">
              <div class="col-10 col-md-11">
                <label class="form-label small mb-1">Produto</label>
                <SelectInput
                  :model-value="opt.linkedProductId"
                  class="form-control"
                  @update:model-value="(v) => (opt.linkedProductId = v)"
                >
                  <option value="">— Selecione um produto —</option>
                  <option
                    v-for="p in availableProducts"
                    :key="p.id"
                    :value="p.id"
                  >
                    {{ p.name }} — R$ {{ Number(p.price || 0).toFixed(2) }}
                  </option>
                </SelectInput>
              </div>
              <div class="col-2 col-md-1 d-flex justify-content-end">
                <BaseIconButton
                  color="danger"
                  title="Remover opção"
                  @click="removeOption(slot, oIdx)"
                >
                  <i class="bi bi-x-lg"></i>
                </BaseIconButton>
              </div>
            </div>
          </div>

          <button
            type="button"
            class="btn btn-sm btn-outline-primary mt-1"
            @click="addOption(slot)"
          >
            <i class="bi bi-plus-lg me-1"></i>
            Adicionar opção
          </button>
        </div>
      </div>
    </div>

    <button
      type="button"
      class="btn btn-outline-primary"
      @click="addSlot"
    >
      <i class="bi bi-plus-lg me-1"></i>
      Adicionar slot
    </button>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import api from '../api'
import TextInput from './form/input/TextInput.vue'
import SelectInput from './form/select/SelectInput.vue'
import CurrencyInput from './form/input/CurrencyInput.vue'
import BaseIconButton from './BaseIconButton.vue'

const props = defineProps({
  modelValue: { type: Array, default: () => [] },
  companyId: { type: String, default: null },
  excludeProductId: { type: String, default: null },
  precoCombo: { type: [Number, String], default: 0 },
})

const emit = defineEmits(['update:modelValue'])

const slots = ref([])
const products = ref([])
const loading = ref(false)
let lastEmittedSnapshot = null

function normalizeSlots(arr) {
  return Array.isArray(arr)
    ? arr.map(s => ({
        name: s?.name || '',
        minSelect: typeof s?.minSelect === 'number' ? s.minSelect : 1,
        maxSelect: typeof s?.maxSelect === 'number' ? s.maxSelect : 1,
        vUnComDeclarado:
          s?.vUnComDeclarado !== undefined && s?.vUnComDeclarado !== null
            ? Number(s.vUnComDeclarado)
            : 0,
        options: Array.isArray(s?.options)
          ? s.options.map(o => ({
              linkedProductId: o?.linkedProductId || '',
              integrationCode: o?.integrationCode || '',
            }))
          : [],
      }))
    : []
}

function hydrate() {
  slots.value = normalizeSlots(props.modelValue)
}

watch(
  () => props.modelValue,
  (val) => {
    const incomingSnapshot = JSON.stringify(val)
    if (incomingSnapshot === lastEmittedSnapshot) return
    hydrate()
  },
  { deep: false }
)

watch(
  slots,
  (val) => {
    const snapshot = JSON.parse(JSON.stringify(val))
    lastEmittedSnapshot = JSON.stringify(snapshot)
    emit('update:modelValue', snapshot)
  },
  { deep: true }
)

const availableProducts = computed(() => {
  return (products.value || [])
    .filter(p => !p.isCombo)
    .filter(p => !props.excludeProductId || p.id !== props.excludeProductId)
})

const precoComboNum = computed(() => {
  const n = Number(props.precoCombo)
  return Number.isFinite(n) && n > 0 ? n : 0
})

const somaDeclarada = computed(() => {
  return (slots.value || []).reduce((acc, s) => acc + (Number(s.vUnComDeclarado) || 0), 0)
})

const somaExcede = computed(() => {
  if (precoComboNum.value <= 0) return false
  // tolera 1 centavo de arredondamento
  return Math.round(somaDeclarada.value * 100) > Math.round(precoComboNum.value * 100)
})

const restanteDisponivel = computed(() => {
  return Math.max(0, precoComboNum.value - somaDeclarada.value)
})

async function loadProducts() {
  loading.value = true
  try {
    const res = await api.get('/menu/products')
    products.value = res.data || []
  } catch (e) {
    console.error('Failed to load products for combo editor', e)
    products.value = []
  } finally {
    loading.value = false
  }
}

function addSlot() {
  slots.value.push({
    name: '',
    minSelect: 1,
    maxSelect: 1,
    vUnComDeclarado: 0,
    options: [],
  })
}

function removeSlot(idx) {
  slots.value.splice(idx, 1)
}

function addOption(slot) {
  if (!Array.isArray(slot.options)) slot.options = []
  slot.options.push({
    linkedProductId: '',
    integrationCode: '',
  })
}

function removeOption(slot, idx) {
  if (!Array.isArray(slot.options)) return
  slot.options.splice(idx, 1)
}

onMounted(() => {
  hydrate()
  loadProducts()
})
</script>

<style scoped>
.combo-slot-card {
  border: 1px solid var(--border-color, #e6e6e6);
  border-radius: var(--border-radius, 1rem);
  background: var(--bg-card, #fff);
}

.combo-slot-card--invalid {
  border-color: var(--danger, #dc3545);
  box-shadow: 0 0 0 1px var(--danger, #dc3545) inset;
}

.combo-slot-badge {
  display: inline-flex;
  align-items: center;
  background: var(--primary, #105784);
  color: #fff;
  border-radius: var(--border-radius-pill, 2rem);
  padding: 0.25rem 0.75rem;
  font-size: 0.75rem;
  font-weight: 600;
  white-space: nowrap;
}

.combo-options-section {
  background: var(--bg-zebra, #fafafa);
  border-radius: var(--border-radius-sm, 0.625rem);
  padding: 0.75rem;
}

.combo-option-row {
  background: var(--bg-card, #fff);
  border: 1px solid var(--border-color-soft, rgba(0, 0, 0, 0.06));
  border-radius: var(--border-radius-sm, 0.625rem);
  padding: 0.5rem 0.75rem;
}
</style>
