<template>
  <div :class="['list-card container py-4', variant ? 'list-card--' + variant : '']">
    <div class="card">
      <div class="card-body">
        <div class="d-flex align-items-center justify-content-between mb-3">
          <div>
            <h4 class="mb-0">
              <i v-if="icon" :class="icon + ' me-2'"></i>
              {{ title }}
            </h4>
            <div v-if="subtitle" class="small text-muted">{{ subtitle }}</div>
          </div>
          <div>
            <slot name="actions"></slot>
          </div>
        </div>

        <div v-if="quickSearch" class="mb-3">
          <div class="d-flex gap-2 align-items-center">
            <input
              type="search"
              class="form-control"
              :placeholder="quickSearchPlaceholder"
              v-model="searchQuery"
              @input="onSearchInput"
            />
            <button v-if="searchQuery" class="btn btn-outline-secondary" @click="clearSearch">Limpar</button>
          </div>
        </div>

        <div v-if="$slots.filters" class="mb-3">
          <slot name="filters"></slot>
        </div>

        <slot></slot>

        <div v-if="$slots.footer" class="mt-3">
          <slot name="footer"></slot>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onBeforeUnmount } from 'vue'

const props = defineProps({
  title: { type: String, default: '' },
  subtitle: { type: String, default: '' },
  icon: { type: String, default: '' },
  variant: { type: String, default: '' },
  quickSearch: { type: Boolean, default: false },
  quickSearchPlaceholder: { type: String, default: 'Buscar por...' }
})

const emit = defineEmits(['quick-search', 'quick-clear'])

const searchQuery = ref('')
let debounceTimer = null

function onSearchInput() {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    emit('quick-search', searchQuery.value)
  }, 300)
}

function clearSearch() {
  searchQuery.value = ''
  clearTimeout(debounceTimer)
  emit('quick-clear')
  emit('quick-search', '')
}

onBeforeUnmount(() => clearTimeout(debounceTimer))
</script>

<style scoped>
.list-card { padding-top: 16px }
.list-card--card-style .card { background: #fff; border: 1px solid #eceff3; border-radius: 14px; }
.list-card--card-style .card-body { padding: 18px 20px; border-radius: 14px; }
@media (max-width:576px){
  .list-card--card-style .card-body { padding: 16px; }
}

/* Compact variant: smaller header and reduced spacing for dense lists */
.list-card--compact .card-body { padding: 10px 12px; }
.list-card--compact h4 { font-size: 1rem; margin-bottom: 4px; }
.list-card--compact .small { font-size: 0.75rem; }

/* No-padding variant: card body has no inner padding (useful for embedded lists) */
.list-card--no-padding .card-body { padding: 0; }
</style>
