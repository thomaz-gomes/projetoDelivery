<template>
  <div>
    <label v-if="label" :for="id" :class="labelClass"><strong>{{ label }}</strong></label>
    <input
      :id="id"
      :class="['form-control', inputClass]"
      :placeholder="placeholder"
      :required="required"
      :min="min"
      :max="max"
      @input="onInput"
      @keydown="onKeyDown"
      @paste="onPaste"
      @blur="onBlur"
      @focus="onFocus"
      :value="displayValue"
      inputmode="decimal"
    />
  </div>
</template>

<script setup>
import { ref, watch, computed } from 'vue';
import { formatAmount } from '../../../utils/formatters.js';

const props = defineProps({
  modelValue: { type: [Number, String], default: null },
  placeholder: { type: String, default: '0,00' },
  id: { type: String, default: null },
  required: { type: Boolean, default: false },
  min: [Number, String],
  max: [Number, String],
  inputClass: { type: String, default: '' },
  // optional label support
  label: { type: String, default: null },
  labelClass: { type: String, default: '' }
});
const emit = defineEmits(['update:modelValue']);

const internal = ref('');

function toNumberFromString(s){
  if (s == null) return null;
  let v = String(s).trim();
  if (!v) return null;
  v = v.replace(/[^0-9.,\-]/g, '');
  const isNeg = v.indexOf('-') !== -1;
  v = v.replace(/-/g, '');
  if (v.indexOf('.') !== -1 && v.indexOf(',') !== -1) {
    v = v.replace(/\./g, '').replace(',', '.');
  } else if (v.indexOf(',') !== -1) {
    v = v.replace(',', '.');
  }
  v = v.replace(/[^0-9.]/g, '');
  if (!v) return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : (isNeg ? -n : n);
}

function formatDisplayFromNumber(n){
  if (n == null) return '';
  try {
    if (Number.isFinite(n) && Number.isInteger(n) && Math.abs(n) >= 1000) {
      return formatAmount(n / 100);
    }
    return formatAmount(n);
  } catch(e){
    return String(n.toFixed ? n.toFixed(2) : n);
  }
}

const isFocused = ref(false);
const rawDigits = ref('');
const displayValue = computed(() => internal.value);

watch(() => props.modelValue, (v) => {
  if (isFocused.value) return;
  internal.value = (v == null || v === '') ? '' : formatDisplayFromNumber(Number(v));
}, { immediate: true });

function onInput(e){
  const v = e.target.value || '';
  if (v.indexOf(',') !== -1 || v.indexOf('.') !== -1) {
    internal.value = v;
    rawDigits.value = '';
    const n = toNumberFromString(v);
    emit('update:modelValue', n == null ? null : n);
    return;
  }

  const digits = String(v).replace(/\D+/g, '');
  rawDigits.value = digits;
  if (!digits) {
    internal.value = '';
    emit('update:modelValue', null);
    return;
  }
  const cents = parseInt(digits, 10) || 0;
  const units = cents / 100;
  internal.value = formatDisplayFromNumber(units);
  emit('update:modelValue', units);
}

function onKeyDown(e){
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key;
  if (/^[0-9]$/.test(k)) {
    e.preventDefault();
    rawDigits.value = String((rawDigits.value || '') + k).replace(/^0+(?=\d)/, '');
    const cents = parseInt(rawDigits.value || '0', 10) || 0;
    const units = cents / 100;
    internal.value = formatDisplayFromNumber(units);
    emit('update:modelValue', units);
    return;
  }
  if (k === 'Backspace') {
    e.preventDefault();
    if (rawDigits.value) {
      rawDigits.value = rawDigits.value.slice(0, -1);
      if (!rawDigits.value) {
        internal.value = '';
        emit('update:modelValue', null);
      } else {
        const cents = parseInt(rawDigits.value || '0', 10) || 0;
        const units = cents / 100;
        internal.value = formatDisplayFromNumber(units);
        emit('update:modelValue', units);
      }
      return;
    }
    return;
  }
  if (k === 'Delete') {
    e.preventDefault();
    rawDigits.value = '';
    internal.value = '';
    emit('update:modelValue', null);
    return;
  }
  if (k === ',' || k === '.') {
    rawDigits.value = '';
    return;
  }
}

function onPaste(e){
  const txt = (e.clipboardData || window.clipboardData).getData('text') || '';
  if (/^[0-9]+$/.test(txt.trim())) {
    e.preventDefault();
    rawDigits.value = String(txt.trim()).replace(/^0+(?=\d)/, '');
    const cents = parseInt(rawDigits.value || '0', 10) || 0;
    const units = cents / 100;
    internal.value = formatDisplayFromNumber(units);
    emit('update:modelValue', units);
  }
}

function onBlur(){
  isFocused.value = false;
  const n = toNumberFromString(internal.value);
  internal.value = n == null ? '' : formatDisplayFromNumber(n);
}

function onFocus(){
  isFocused.value = true;
  let n = toNumberFromString(internal.value) ?? toNumberFromString(props.modelValue);
  if (n == null && typeof props.modelValue === 'number') {
    const pv = props.modelValue
    if (Number.isFinite(pv) && Number.isInteger(pv) && Math.abs(pv) >= 1000) {
      n = pv / 100
    } else {
      n = pv
    }
  }
  if (n == null) {
    internal.value = '';
    rawDigits.value = '';
  } else {
    const asNumber = Math.round(n * 100) / 100;
    internal.value = String(asNumber).replace('.', ',');
    try{
      const inferredDigits = String(Math.round(asNumber * 100));
      rawDigits.value = inferredDigits;
    }catch(e){ rawDigits.value = '' }
  }
}
</script>

<style scoped>
</style>
