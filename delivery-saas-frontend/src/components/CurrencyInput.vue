<template>
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
    // Heuristic: some datasets store monetary values in integer cents (e.g. 1050 meaning 10.50).
    // If we receive a whole number that's quite large (>= 1000) and has no fractional part,
    // assume it's expressed in cents and convert to the human-readable unit value.
    if (Number.isFinite(n) && Number.isInteger(n) && Math.abs(n) >= 1000) {
      return formatAmount(n / 100);
    }
    return formatAmount(n);
  } catch(e){
    return String(n.toFixed ? n.toFixed(2) : n);
  }
}

// track focus so we don't override user typing while editing
const isFocused = ref(false);
// when using masked typing (digits only) keep the raw cents string
const rawDigits = ref('');

// expose reactive display value
const displayValue = computed(() => internal.value);

// initialize
watch(() => props.modelValue, (v) => {
  // If the input is focused, avoid overriding the user's in-progress typing.
  if (isFocused.value) return;
  // We'll always set formatted display when modelValue changes from outside
  internal.value = (v == null || v === '') ? '' : formatDisplayFromNumber(Number(v));
}, { immediate: true });

function onInput(e){
  const v = e.target.value || '';
  // If user typed an explicit decimal separator (',' or '.'), fall back to free-form parsing
  if (v.indexOf(',') !== -1 || v.indexOf('.') !== -1) {
    internal.value = v;
    // clear masked digits mode
    rawDigits.value = '';
    const n = toNumberFromString(v);
    emit('update:modelValue', n == null ? null : n);
    return;
  }

  // Masked mode: treat the input as a sequence of digits representing cents
  const digits = String(v).replace(/\D+/g, '');
  rawDigits.value = digits;
  if (!digits) {
    internal.value = '';
    emit('update:modelValue', null);
    return;
  }
  // parse cents -> units
  const cents = parseInt(digits, 10) || 0;
  const units = cents / 100;
  // display formatted units (pt-BR)
  internal.value = formatDisplayFromNumber(units);
  emit('update:modelValue', units);
}

function onKeyDown(e){
  // handle numeric/backspace/delete keys in masked mode
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key;
  if (/^[0-9]$/.test(k)) {
    e.preventDefault();
    // append digit to rawDigits
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
    // allow normal backspace when not in masked mode
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
    // exit masked mode so user can type decimal separator
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
  // show raw editable form using comma as decimal separator
  let n = toNumberFromString(internal.value) ?? toNumberFromString(props.modelValue);
  // if props.modelValue is a numeric cents integer (e.g. 1050), normalize it to units
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
    // show with comma as decimal separator, not thousand separators
    // keep up to two decimal places when possible so user can continue typing
    const asNumber = Math.round(n * 100) / 100;
    // ensure decimals use comma
    internal.value = String(asNumber).replace('.', ',');
    // initialize masked digits to allow continuing typing without typing comma
    // e.g. show 10,50 -> rawDigits = '1050'
    try{
      const inferredDigits = String(Math.round(asNumber * 100));
      rawDigits.value = inferredDigits;
    }catch(e){ rawDigits.value = '' }
  }
}
</script>

<style scoped>
</style>
