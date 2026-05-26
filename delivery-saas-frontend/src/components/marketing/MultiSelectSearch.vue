<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'

const props = defineProps({
  modelValue: { type: Array, default: () => [] },
  options: { type: Array, default: () => [] }, // [{ value, label }]
  placeholder: { type: String, default: 'Buscar e selecionar...' },
  loading: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue'])

const search = ref('')
const open = ref(false)
const containerRef = ref(null)

const selectedOptions = computed(() => {
  // Preserve user-input order: iterate modelValue, not options.
  return props.modelValue
    .map(v => props.options.find(o => o.value === v) || { value: v, label: String(v) })
})

const filteredOptions = computed(() => {
  const q = search.value.trim().toLowerCase()
  const selected = new Set(props.modelValue)
  return props.options
    .filter(o => !selected.has(o.value))
    .filter(o => !q || String(o.label || '').toLowerCase().includes(q))
    .slice(0, 50)
})

function add(opt) {
  if (props.modelValue.includes(opt.value)) return
  emit('update:modelValue', [...props.modelValue, opt.value])
  search.value = ''
}

function remove(value) {
  emit('update:modelValue', props.modelValue.filter(v => v !== value))
}

function onDocumentClick(e) {
  if (!containerRef.value) return
  if (!containerRef.value.contains(e.target)) open.value = false
}

onMounted(() => document.addEventListener('mousedown', onDocumentClick))
onBeforeUnmount(() => document.removeEventListener('mousedown', onDocumentClick))
</script>

<template>
  <div ref="containerRef" class="multi-select-search position-relative">
    <div
      class="form-control d-flex flex-wrap gap-1 align-items-center"
      style="min-height:38px;padding:4px 8px;cursor:text"
      @click="open = true"
    >
      <span
        v-for="opt in selectedOptions"
        :key="opt.value"
        class="badge bg-primary d-inline-flex align-items-center gap-1"
        style="font-weight:500"
      >
        {{ opt.label }}
        <i
          class="bi bi-x"
          style="cursor:pointer;font-size:1rem;line-height:1"
          @click.stop="remove(opt.value)"
        ></i>
      </span>
      <input
        v-model="search"
        :placeholder="selectedOptions.length === 0 ? placeholder : ''"
        class="border-0 flex-grow-1 p-0"
        style="outline:none;min-width:120px;font-size:0.875rem;background:transparent"
        @focus="open = true"
      />
    </div>

    <div
      v-if="open && !loading"
      class="dropdown-menu show w-100 mt-1 shadow-sm"
      style="max-height:240px;overflow-y:auto"
    >
      <button
        v-for="opt in filteredOptions"
        :key="opt.value"
        type="button"
        class="dropdown-item small"
        @mousedown.prevent="add(opt)"
      >
        {{ opt.label }}
      </button>
      <span
        v-if="filteredOptions.length === 0"
        class="dropdown-item-text small text-muted"
      >
        {{ search ? 'Nenhum resultado' : 'Sem opções disponíveis' }}
      </span>
    </div>

    <div
      v-if="open && loading"
      class="dropdown-menu show w-100 mt-1"
    >
      <span class="dropdown-item-text small text-muted">
        <span class="spinner-border spinner-border-sm me-2"></span>Carregando...
      </span>
    </div>
  </div>
</template>
