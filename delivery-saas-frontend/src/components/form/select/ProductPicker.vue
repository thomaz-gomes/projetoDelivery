<template>
  <div class="product-picker" ref="root">
    <!-- Trigger button: looks like a Bootstrap form-select -->
    <button
      type="button"
      class="form-select product-picker__trigger"
      :class="{ 'product-picker__trigger--placeholder': !selectedProduct, 'is-invalid': invalid }"
      :disabled="disabled"
      :aria-expanded="open"
      @click="toggle"
    >
      <span class="product-picker__trigger-label">
        <template v-if="selectedProduct">
          {{ selectedProduct.name }}
          <span v-if="showPrice" class="product-picker__trigger-price">
            — R$ {{ formatPrice(selectedProduct.price) }}
          </span>
        </template>
        <template v-else>{{ placeholder }}</template>
      </span>
    </button>

    <!-- Dropdown panel -->
    <div v-if="open" class="product-picker__dropdown" role="listbox">
      <!-- Sticky search -->
      <div class="product-picker__search">
        <i class="bi bi-search product-picker__search-icon"></i>
        <input
          ref="searchInput"
          v-model="query"
          type="text"
          class="product-picker__search-input"
          :placeholder="searchPlaceholder"
          @keydown.esc.prevent="close"
        />
        <button
          v-if="query"
          type="button"
          class="product-picker__search-clear"
          title="Limpar busca"
          @click="query = ''"
        >
          <i class="bi bi-x-lg"></i>
        </button>
      </div>

      <!-- Grouped product list -->
      <div class="product-picker__list">
        <!-- Clear-selection row, only when something is selected and not filtering -->
        <button
          v-if="allowClear && modelValue && !query"
          type="button"
          class="product-picker__item product-picker__item--clear"
          @click="select(null)"
        >
          <i class="bi bi-x-circle"></i> {{ clearLabel }}
        </button>

        <template v-if="groupedFiltered.length > 0">
          <div
            v-for="grp in groupedFiltered"
            :key="grp.key"
            class="product-picker__group"
          >
            <div class="product-picker__group-header">{{ grp.label }}</div>
            <button
              v-for="p in grp.items"
              :key="p.id"
              type="button"
              class="product-picker__item"
              :class="{ 'product-picker__item--active': String(p.id) === String(modelValue) }"
              role="option"
              :aria-selected="String(p.id) === String(modelValue)"
              @click="select(p.id)"
            >
              <span class="product-picker__item-name">{{ p.name }}</span>
              <span v-if="showPrice" class="product-picker__item-price">
                R$ {{ formatPrice(p.price) }}
              </span>
            </button>
          </div>
        </template>

        <div v-else class="product-picker__empty">
          <i class="bi bi-inbox"></i>
          <span v-if="query">Nenhum produto encontrado para "{{ query }}"</span>
          <span v-else>Nenhum produto disponível</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';

const props = defineProps({
  modelValue: { type: [String, Number], default: null },
  products: { type: Array, default: () => [] },
  placeholder: { type: String, default: 'Selecione um produto' },
  searchPlaceholder: { type: String, default: 'Buscar produto…' },
  disabled: { type: Boolean, default: false },
  invalid: { type: Boolean, default: false },
  showPrice: { type: Boolean, default: true },
  allowClear: { type: Boolean, default: true },
  clearLabel: { type: String, default: 'Limpar seleção' },
  // How to resolve each product's category for grouping.
  // Default reads `category.name` (matches /menu/products response shape).
  categoryAccessor: {
    type: Function,
    default: (p) => p?.category?.name || null,
  },
  uncategorizedLabel: { type: String, default: 'Sem categoria' },
});

const emit = defineEmits(['update:modelValue']);

const open = ref(false);
const query = ref('');
const root = ref(null);
const searchInput = ref(null);

const selectedProduct = computed(() => {
  const id = props.modelValue;
  if (id == null || id === '') return null;
  return (props.products || []).find((p) => String(p.id) === String(id)) || null;
});

// Build category groups (insertion order preserved by Map). Each group keeps
// its products in the order received from the parent.
const grouped = computed(() => {
  const buckets = new Map();
  for (const p of props.products || []) {
    const catName = props.categoryAccessor(p) || props.uncategorizedLabel;
    const key = catName;
    if (!buckets.has(key)) buckets.set(key, { key, label: catName, items: [] });
    buckets.get(key).items.push(p);
  }
  return Array.from(buckets.values());
});

const groupedFiltered = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return grouped.value;
  return grouped.value
    .map((g) => ({
      ...g,
      items: g.items.filter((p) =>
        String(p.name || '').toLowerCase().includes(q)
      ),
    }))
    .filter((g) => g.items.length > 0);
});

function formatPrice(v) {
  const n = Number(v || 0);
  if (!Number.isFinite(n)) return '0,00';
  return n.toFixed(2).replace('.', ',');
}

function toggle() {
  if (props.disabled) return;
  open.value ? close() : openDropdown();
}

function openDropdown() {
  open.value = true;
  query.value = '';
  nextTick(() => searchInput.value?.focus());
  document.addEventListener('mousedown', onOutsideClick);
}

function close() {
  open.value = false;
  document.removeEventListener('mousedown', onOutsideClick);
}

function onOutsideClick(e) {
  if (!root.value) return;
  if (!root.value.contains(e.target)) close();
}

function select(id) {
  emit('update:modelValue', id);
  close();
}

watch(
  () => props.disabled,
  (v) => {
    if (v && open.value) close();
  }
);

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onOutsideClick);
});
</script>

<style scoped>
.product-picker {
  position: relative;
  width: 100%;
}

/* Trigger styled like Bootstrap form-select but with a left-aligned label */
.product-picker__trigger {
  text-align: left;
  cursor: pointer;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  /* form-select already provides the chevron-down via background-image */
}
.product-picker__trigger:disabled {
  cursor: not-allowed;
  opacity: 0.65;
}
.product-picker__trigger--placeholder {
  color: var(--text-muted, #adb5bd);
}
.product-picker__trigger-label {
  display: inline-block;
  max-width: calc(100% - 1.5rem);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.product-picker__trigger-price {
  color: var(--text-secondary, #6c757d);
  font-weight: 500;
}

/* Dropdown panel */
.product-picker__dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  z-index: 1050;
  background: #fff;
  border: 1px solid var(--border-color, #e6e6e6);
  border-radius: var(--border-radius-sm, 0.625rem);
  box-shadow: var(--shadow-dropdown, 0 0.5rem 1.5rem rgba(0, 0, 0, 0.1));
  overflow: hidden;
  display: flex;
  flex-direction: column;
  max-height: 360px;
}

/* Sticky search */
.product-picker__search {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-color-soft, rgba(0, 0, 0, 0.06));
  background: #fff;
  flex-shrink: 0;
}
.product-picker__search-icon {
  color: var(--text-muted, #adb5bd);
  font-size: 0.9rem;
  flex-shrink: 0;
}
.product-picker__search-input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  font-size: 0.9rem;
  color: var(--text-primary, #212529);
  min-width: 0;
}
.product-picker__search-input::placeholder {
  color: var(--text-muted, #adb5bd);
}
.product-picker__search-clear {
  border: none;
  background: transparent;
  color: var(--text-muted, #adb5bd);
  padding: 0;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  font-size: 0.75rem;
  flex-shrink: 0;
}
.product-picker__search-clear:hover {
  color: var(--text-secondary, #6c757d);
}

/* Scrollable list */
.product-picker__list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}

.product-picker__group-header {
  padding: 8px 14px 4px;
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted, #adb5bd);
}

.product-picker__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  padding: 8px 14px;
  background: transparent;
  border: none;
  text-align: left;
  font-size: 0.88rem;
  color: var(--text-primary, #212529);
  cursor: pointer;
  transition: background 0.1s;
}
.product-picker__item:hover {
  background: var(--bg-hover, #f0f0f0);
}
.product-picker__item--active {
  background: rgba(137, 209, 54, 0.12);
  font-weight: 600;
}
.product-picker__item--active:hover {
  background: rgba(137, 209, 54, 0.18);
}
.product-picker__item-name {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.product-picker__item-price {
  flex-shrink: 0;
  color: var(--success-dark, #6dae1e);
  font-weight: 600;
  font-size: 0.82rem;
}
.product-picker__item--clear {
  color: var(--danger, #dc3545);
  border-bottom: 1px solid var(--border-color-soft, rgba(0, 0, 0, 0.06));
  margin-bottom: 4px;
}
.product-picker__item--clear i {
  margin-right: 6px;
}

.product-picker__empty {
  padding: 24px 14px;
  text-align: center;
  color: var(--text-muted, #adb5bd);
  font-size: 0.85rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}
.product-picker__empty i {
  font-size: 1.6rem;
  opacity: 0.6;
}
</style>
