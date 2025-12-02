<template>
  <input
    :id="id"
    :class="['form-control', inputClass]"
    :placeholder="placeholder"
    :required="required"
    :min="min"
    :max="max"
    @input="onInput"
    @blur="onBlur"
    @focus="onFocus"
    :value="displayValue"
    inputmode="decimal"
  />
</template>

<script setup>
import { ref, watch, computed } from 'vue';
import { formatAmount } from '../utils/formatters.js';

const props = defineProps({
  modelValue: { type: [Number, String], default: null },
  placeholder: { type: String, default: '0,00' },
  id: { type: String, default: null },
  required: { type: Boolean, default: false },
  min: [Number, String],
  max: [Number, String],
  inputClass: { type: String, default: '' }
});
const emit = defineEmits(['update:modelValue']);

const internal = ref('');

function toNumberFromString(s){
  if (s == null) return null;
  let v = String(s).trim();
  if (!v) return null;
  // remove letters/spaces
  v = v.replace(/[^0-9.,\-]/g, '');
  // handle negative
  const isNeg = v.indexOf('-') !== -1;
  v = v.replace(/-/g, '');
  // If both '.' and ',' present, assume '.' thousands and ',' decimal
  if (v.indexOf('.') !== -1 && v.indexOf(',') !== -1) {
    v = v.replace(/\./g, '').replace(',', '.');
  } else if (v.indexOf(',') !== -1) {
    v = v.replace(',', '.');
  }
  // remove any other non-numeric except dot
  v = v.replace(/[^0-9.]/g, '');
  if (!v) return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : (isNeg ? -n : n);
}

function formatDisplayFromNumber(n){
  if (n == null) return '';
  try {
    return formatAmount(n);
  } catch(e){
    return String(n.toFixed ? n.toFixed(2) : n);
  }
}

// expose reactive display value
const displayValue = computed(() => internal.value);

// initialize
watch(() => props.modelValue, (v) => {
  // if input is focused, don't override user typing
  // We'll always set formatted display when modelValue changes from outside
  internal.value = (v == null || v === '') ? '' : formatDisplayFromNumber(Number(v));
}, { immediate: true });

function onInput(e){
  const v = e.target.value || '';
  // keep the raw input as-is so user sees what they type
  internal.value = v;
  const n = toNumberFromString(v);
  emit('update:modelValue', n == null ? null : n);
}

function onBlur(){
  const n = toNumberFromString(internal.value);
  internal.value = n == null ? '' : formatDisplayFromNumber(n);
}

function onFocus(){
  // show raw editable form using comma as decimal separator
  const n = toNumberFromString(internal.value) ?? toNumberFromString(props.modelValue);
  if (n == null) {
    internal.value = '';
  } else {
    // show with comma as decimal separator, not thousand separators
    internal.value = String(n).replace('.', ',');
  }
}
</script>

<style scoped>
</style>
