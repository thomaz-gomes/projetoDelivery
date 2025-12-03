<template>
  <select
    :id="id"
    :class="['form-select', inputClass]"
    :disabled="disabled"
    :multiple="multiple"
    :required="required"
    v-model="internalValue"
  >
    <slot>
      <option v-if="placeholder && !multiple" value="">{{ placeholder }}</option>
      <option v-for="(opt, idx) in options" :key="idx" :value="getValue(opt)">{{ getLabel(opt) }}</option>
    </slot>
  </select>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  modelValue: { type: [String, Number, Array], default: null },
  options: { type: Array, default: () => [] },
  optionValueKey: { type: String, default: 'value' },
  optionLabelKey: { type: String, default: 'label' },
  id: { type: String, default: null },
  inputClass: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
  multiple: { type: Boolean, default: false },
  placeholder: { type: String, default: '' },
  required: { type: Boolean, default: false },
});

const emit = defineEmits(['update:modelValue','input']);

const internalValue = computed({
  get() { return props.modelValue },
  set(v) { emit('update:modelValue', v); emit('input', v); }
});

function getValue(opt){
  if(opt == null) return opt
  if(typeof opt === 'object') return opt[props.optionValueKey]
  return opt
}

function getLabel(opt){
  if(opt == null) return ''
  if(typeof opt === 'object') return (opt[props.optionLabelKey] ?? opt.label ?? opt.name ?? String(opt))
  return String(opt)
}
</script>

<style scoped>
.form-select { min-width: 0; }
</style>
