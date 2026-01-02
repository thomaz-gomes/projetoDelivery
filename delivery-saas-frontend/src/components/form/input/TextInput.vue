<template>
  <div>
    <label v-if="label" :for="id" :class="labelClass"><strong>{{ label }}</strong></label>
    <input
      :id="id"
      :class="['form-control', inputClass]"
      :type="type"
      :placeholder="placeholder"
      :required="required"
      :maxlength="maxlength"
      :min="min"
      :max="max"
      :pattern="pattern"
      :autocomplete="autocomplete"
      :inputmode="inputmode"
      :value="internalValue"
      @input="onInput"
    />
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'

const props = defineProps({
  modelValue: { type: [String, Number], default: '' },
  placeholder: { type: String, default: '' },
  id: { type: String, default: null },
  required: { type: Boolean, default: false },
  maxlength: [Number, String],
  min: [Number, String],
  max: [Number, String],
  pattern: { type: String, default: null },
  autocomplete: { type: String, default: 'off' },
  inputClass: { type: String, default: '' },
  type: { type: String, default: 'text' },
  inputmode: { type: String, default: undefined },
  // optional label support
  label: { type: String, default: null },
  labelClass: { type: String, default: '' }
})
const emit = defineEmits(['update:modelValue', 'input'])

const internalValue = ref(String(props.modelValue ?? ''))

watch(() => props.modelValue, v => {
  internalValue.value = v == null ? '' : String(v)
})

function onInput(e){
  const v = e.target.value
  internalValue.value = v
  // keep number types as number when the prop was number
  if (typeof props.modelValue === 'number') {
    const n = Number(v === '' ? null : v)
    emit('update:modelValue', isNaN(n) ? null : n)
    emit('input', isNaN(n) ? null : n)
  } else {
    emit('update:modelValue', v)
    emit('input', v)
  }
}
</script>

<style scoped>
</style>
