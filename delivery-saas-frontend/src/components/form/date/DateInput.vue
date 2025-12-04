<template>
  <input
    type="text"
    ref="inputEl"
    :class="inputClass"
    :value="displayValue"
    @input="onInput"
    @blur="onBlur"
    :disabled="disabled"
    :required="required"
    :id="id"
    :title="title"
    v-bind="$attrs"
    placeholder="dd/mm/YYYY"
  />
</template>

<script setup>
import { defineProps, defineEmits, ref, watch, onMounted, onUnmounted } from 'vue'

const props = defineProps({
  modelValue: { type: [String, null], default: '' }, // normalized value: YYYY-MM-DD preferred
  inputClass: { type: String, default: 'form-control' },
  disabled: { type: Boolean, default: false },
  required: { type: Boolean, default: false },
  id: { type: String, default: null },
  title: { type: String, default: null },
})

const emit = defineEmits(['update:modelValue'])

const inputEl = ref(null)
const displayValue = ref('')
const uiMode = ref('text') // 'flatpickr' | 'native' | 'text'
let fpInstance = null

function pad(n){ return String(n).padStart(2,'0') }

function toDisplay(iso){
  if(!iso) return ''
  if(/^(\d{2})\/(\d{2})\/(\d{4})$/.test(iso)) return iso
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/) || iso.match(/^(\d{4})(\d{2})(\d{2})/)
  if(m){
    const y = m[1], mm = m[2], d = m[3]
    return `${pad(Number(d))}/${pad(Number(mm))}/${y}`
  }
  const dt = new Date(iso)
  if(!isNaN(dt.getTime())){
    return `${pad(dt.getDate())}/${pad(dt.getMonth()+1)}/${dt.getFullYear()}`
  }
  return ''
}

function toModel(ddmmyyyy){
  if(!ddmmyyyy) return ''
  if(/^(\d{4})-(\d{2})-(\d{2})/.test(ddmmyyyy)) return ddmmyyyy
  const m = ddmmyyyy.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if(m){
    const d = pad(Number(m[1])), mm = pad(Number(m[2])), y = m[3]
    return `${y}-${mm}-${d}`
  }
  const dt = new Date(ddmmyyyy)
  if(!isNaN(dt.getTime())){
    return `${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())}`
  }
  return ddmmyyyy
}

watch(()=>props.modelValue, (v) => {
  if(uiMode.value === 'native'){
    displayValue.value = v || ''
  } else {
    displayValue.value = toDisplay(v)
  }
  // if flatpickr is active, sync its date
  try{
    if(fpInstance && v) fpInstance.setDate(v, true)
  }catch(e){}
}, { immediate: true })

function onInput(e){
  displayValue.value = e.target.value
  if(uiMode.value === 'native'){
    // native date inputs use YYYY-MM-DD
    emit('update:modelValue', e.target.value)
    return
  }
  const model = toModel(displayValue.value)
  emit('update:modelValue', model)
}

function onBlur(){
  displayValue.value = toDisplay(displayValue.value)
}

onMounted(async () => {
  // Try to initialize flatpickr for calendar UI. If not available, keep text behavior.
  try{
    const [{ default: flatpickr }] = await Promise.all([
      import('flatpickr'),
      import('flatpickr/dist/flatpickr.min.css')
    ])
    if(!inputEl.value) return
    fpInstance = flatpickr(inputEl.value, {
      altInput: true,
      altFormat: 'd/m/Y',
      dateFormat: 'Y-m-d',
      defaultDate: props.modelValue || null,
      allowInput: true,
      onChange: (selectedDates, dateStr) => {
        // dateStr is in dateFormat (Y-m-d)
        emit('update:modelValue', dateStr || '')
      }
    })
    uiMode.value = 'flatpickr'
    return
  }catch(err){
    // flatpickr not installed or failed to load — try native date input
    console.warn('flatpickr not available, DateInput will try native date input as fallback.')
    try{
      if(!inputEl.value) return
      inputEl.value.type = 'date'
      uiMode.value = 'native'
      // native expects YYYY-MM-DD value
      displayValue.value = props.modelValue || ''
      // ensure native change events update model
      const handler = (e) => { emit('update:modelValue', e.target.value) }
      inputEl.value.addEventListener('change', handler)
      // store handler on element for cleanup
      inputEl.value.__dateInputHandler = handler
      return
    }catch(e){
      console.warn('native date input not available, falling back to text input')
    }
  }
})

onUnmounted(()=>{
  try{ if(fpInstance) fpInstance.destroy(); }catch(e){}
  try{ if(inputEl.value && inputEl.value.__dateInputHandler) inputEl.value.removeEventListener('change', inputEl.value.__dateInputHandler) }catch(e){}
})
</script>

<style scoped>
/* minimal styling; parent controls layout */
</style>
