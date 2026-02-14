<template>
  <tr>
    <td class="text-center align-middle">{{ index + 1 }}</td>
    <td>
      <TextInput
        v-model="item.xProd"
        placeholder="Descrição do produto"
        required
        inputClass="form-control-sm"
      />
    </td>
    <td>
      <TextInput
        v-model="item.NCM"
        placeholder="00000000"
        maxlength="8"
        inputClass="form-control-sm"
      />
    </td>
    <td>
      <TextInput
        v-model="item.CFOP"
        placeholder="5102"
        maxlength="4"
        inputClass="form-control-sm"
      />
    </td>
    <td>
      <TextInput
        v-model="item.uCom"
        placeholder="UN"
        maxlength="6"
        inputClass="form-control-sm"
      />
    </td>
    <td>
      <TextInput
        v-model.number="item.qCom"
        type="number"
        placeholder="1"
        min="0.001"
        inputClass="form-control-sm"
      />
    </td>
    <td>
      <CurrencyInput
        v-model="item.vUnCom"
        placeholder="0,00"
        inputClass="form-control-sm"
      />
    </td>
    <td class="text-end align-middle fw-semibold">
      {{ formatCurrency(vProd) }}
    </td>
    <td>
      <TextInput
        v-model.number="item.pICMS"
        type="number"
        placeholder="0"
        min="0"
        max="100"
        inputClass="form-control-sm"
      />
    </td>
    <td class="text-end align-middle">
      {{ formatCurrency(vICMS) }}
    </td>
    <td class="text-center align-middle">
      <button type="button" class="btn btn-outline-danger btn-sm" @click="$emit('remove')">
        <i class="bi bi-trash"></i>
      </button>
    </td>
  </tr>
</template>

<script setup>
import { reactive, computed, watch } from 'vue'
import TextInput from '@/components/form/input/TextInput.vue'
import CurrencyInput from '@/components/form/input/CurrencyInput.vue'
import { formatAmount } from '@/utils/formatters.js'

const props = defineProps({
  modelValue: { type: Object, required: true },
  index: { type: Number, required: true }
})
const emit = defineEmits(['update:modelValue', 'remove'])

const item = reactive({
  xProd: '',
  NCM: '00000000',
  CFOP: '5102',
  uCom: 'UN',
  qCom: 1,
  vUnCom: null,
  pICMS: 0,
  ...props.modelValue
})

const vProd = computed(() => {
  const q = Number(item.qCom) || 0
  const v = Number(item.vUnCom) || 0
  return Math.round(q * v * 100) / 100
})

const vICMS = computed(() => {
  const p = Number(item.pICMS) || 0
  return Math.round(vProd.value * p) / 100
})

function formatCurrency(val) {
  try { return formatAmount(val) } catch { return val?.toFixed(2) ?? '0,00' }
}

watch(item, () => {
  emit('update:modelValue', {
    ...item,
    vProd: vProd.value,
    vICMS: vICMS.value
  })
}, { deep: true })

watch(() => props.modelValue, (nv) => {
  if (nv) Object.assign(item, nv)
}, { deep: true })
</script>
