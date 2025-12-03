<template>
  <textarea
    :id="id"
    :class="['form-control', inputClass]"
    :placeholder="placeholder"
    :rows="rows"
    :maxlength="maxlength"
    :required="required"
    @input="onInput"
  >{{ internalValue }}</textarea>
</template>

<script setup>
import { ref, watch } from 'vue'

const props = defineProps({
  modelValue: { type: [String], default: '' },
  placeholder: { type: String, default: '' },
  id: { type: String, default: null },
  required: { type: Boolean, default: false },
  maxlength: [Number, String],
  rows: { type: [Number, String], default: 4 },
  inputClass: { type: String, default: '' }
})
const emit = defineEmits(['update:modelValue'])

const internalValue = ref(props.modelValue || '')

watch(() => props.modelValue, v => internalValue.value = v || '')

function onInput(e){
  internalValue.value = e.target.value
  emit('update:modelValue', internalValue.value)
}
</script>

<style scoped>
</style>
