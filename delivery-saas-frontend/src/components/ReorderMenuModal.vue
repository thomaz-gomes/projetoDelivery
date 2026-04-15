<template>
  <div class="modal d-block reorder-modal" tabindex="-1" role="dialog"
       @click.self="$emit('close')" style="background:rgba(0,0,0,0.5)">
    <div class="modal-dialog modal-xl modal-dialog-scrollable" role="document">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title">
            <i class="bi bi-arrows-move me-2"></i>Reordenar cardápio
          </h5>
          <button type="button" class="btn-close" @click="$emit('close')" :disabled="saving"></button>
        </div>

        <div class="modal-body p-0">
          <div class="row g-0">
            <!-- Categorias -->
            <div class="col-md-5 border-end reorder-col">
              <div class="reorder-col-header">
                <i class="bi bi-folder me-1"></i>Categorias
                <span class="badge bg-secondary ms-1">{{ localCategories.length }}</span>
              </div>
              <div class="reorder-col-hint">Arraste para reordenar</div>
              <ul ref="categoriesEl" class="reorder-list list-unstyled mb-0">
                <li
                  v-for="cat in localCategories"
                  :key="cat.id"
                  :data-id="cat.id"
                  class="reorder-item"
                  :class="{ 'reorder-item-active': cat.id === selectedCategoryId }"
                  @click="selectCategory(cat.id)"
                >
                  <i class="bi bi-grip-vertical text-muted me-2 drag-handle"></i>
                  <span class="flex-grow-1">{{ cat.name }}</span>
                  <span class="badge bg-light text-dark border ms-2">
                    {{ productCountsByCategory[cat.id] || 0 }}
                  </span>
                </li>
                <li v-if="!localCategories.length" class="text-muted small p-3">
                  Nenhuma categoria neste cardápio.
                </li>
              </ul>
            </div>

            <!-- Produtos -->
            <div class="col-md-7 reorder-col">
              <div class="reorder-col-header">
                <i class="bi bi-box-seam me-1"></i>
                {{ selectedCategory ? `Produtos — ${selectedCategory.name}` : 'Produtos' }}
                <span v-if="selectedCategory" class="badge bg-secondary ms-1">
                  {{ filteredProducts.length }}
                </span>
              </div>
              <div class="reorder-col-hint">
                {{ selectedCategory
                    ? 'Arraste para reordenar dentro da categoria'
                    : 'Selecione uma categoria à esquerda' }}
              </div>
              <ul ref="productsEl" class="reorder-list list-unstyled mb-0">
                <li
                  v-for="p in filteredProducts"
                  :key="p.id"
                  :data-id="p.id"
                  class="reorder-item"
                >
                  <i class="bi bi-grip-vertical text-muted me-2 drag-handle"></i>
                  <span class="flex-grow-1">{{ p.name }}</span>
                  <span v-if="!p.isActive" class="badge bg-warning text-dark ms-2">Inativo</span>
                </li>
                <li v-if="selectedCategory && !filteredProducts.length"
                    class="text-muted small p-3">
                  Nenhum produto nesta categoria.
                </li>
              </ul>
            </div>
          </div>
        </div>

        <div class="modal-footer">
          <span v-if="dirty" class="text-muted small me-auto">
            <i class="bi bi-dot"></i>Alterações não salvas
          </span>
          <button class="btn btn-outline-secondary" @click="$emit('close')" :disabled="saving">
            Cancelar
          </button>
          <button class="btn btn-primary" :disabled="saving || !dirty" @click="save">
            <span v-if="saving" class="spinner-border spinner-border-sm me-1"></span>
            Salvar ordem
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue';
import Sortable from 'sortablejs';
import api from '../api';

const props = defineProps({
  categories: { type: Array, required: true }, // [{id, name, position}]
  products: { type: Array, required: true },   // [{id, name, position, categoryId, isActive}]
});
const emit = defineEmits(['close', 'saved']);

// Work on deep copies so we can compare with the original state to detect "dirty"
const localCategories = ref(
  [...props.categories]
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map(c => ({ ...c }))
);
const localProducts = ref(
  [...props.products]
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map(p => ({ ...p }))
);

const initialCategoryOrder = props.categories
  .slice().sort((a, b) => (a.position ?? 0) - (b.position ?? 0)).map(c => c.id);
const initialProductOrder = props.products
  .slice().sort((a, b) => (a.position ?? 0) - (b.position ?? 0)).map(p => `${p.categoryId || 'none'}|${p.id}`);

const selectedCategoryId = ref(localCategories.value[0]?.id || null);
const saving = ref(false);

const categoriesEl = ref(null);
const productsEl = ref(null);
let categoriesSortable = null;
let productsSortable = null;

const selectedCategory = computed(() =>
  localCategories.value.find(c => c.id === selectedCategoryId.value) || null
);

const filteredProducts = computed(() => {
  if (!selectedCategoryId.value) return [];
  return localProducts.value.filter(p => p.categoryId === selectedCategoryId.value);
});

const productCountsByCategory = computed(() => {
  const map = {};
  for (const p of localProducts.value) {
    if (!p.categoryId) continue;
    map[p.categoryId] = (map[p.categoryId] || 0) + 1;
  }
  return map;
});

const dirty = computed(() => {
  const currentCatOrder = localCategories.value.map(c => c.id);
  if (currentCatOrder.join() !== initialCategoryOrder.join()) return true;
  const currentProdOrder = localProducts.value.map(p => `${p.categoryId || 'none'}|${p.id}`);
  if (currentProdOrder.join() !== initialProductOrder.join()) return true;
  return false;
});

function selectCategory(id) {
  selectedCategoryId.value = id;
}

function initCategoriesSortable() {
  if (!categoriesEl.value) return;
  categoriesSortable?.destroy();
  categoriesSortable = Sortable.create(categoriesEl.value, {
    animation: 150,
    handle: '.drag-handle',
    onEnd: () => {
      const ids = Array.from(categoriesEl.value.children)
        .filter(el => el.dataset.id)
        .map(el => el.dataset.id);
      const byId = new Map(localCategories.value.map(c => [c.id, c]));
      localCategories.value = ids.map((id, idx) => ({ ...byId.get(id), position: idx }));
    },
  });
}

function initProductsSortable() {
  if (!productsEl.value) return;
  productsSortable?.destroy();
  productsSortable = Sortable.create(productsEl.value, {
    animation: 150,
    handle: '.drag-handle',
    onEnd: () => {
      const ids = Array.from(productsEl.value.children)
        .filter(el => el.dataset.id)
        .map(el => el.dataset.id);
      // rebuild full list: reorder the slice for current category, keep others intact
      const otherProducts = localProducts.value.filter(p => p.categoryId !== selectedCategoryId.value);
      const byId = new Map(localProducts.value.map(p => [p.id, p]));
      const reorderedForCat = ids.map((id, idx) => {
        const prod = byId.get(id);
        return prod ? { ...prod, position: idx } : null;
      }).filter(Boolean);
      localProducts.value = [...otherProducts, ...reorderedForCat];
    },
  });
}

onMounted(() => {
  nextTick(() => {
    initCategoriesSortable();
    initProductsSortable();
  });
});

// Re-init products sortable when the selected category changes (DOM list swaps).
watch(selectedCategoryId, async () => {
  await nextTick();
  initProductsSortable();
});

onBeforeUnmount(() => {
  categoriesSortable?.destroy();
  productsSortable?.destroy();
});

async function save() {
  saving.value = true;
  try {
    const payload = {
      categories: localCategories.value.map((c, idx) => ({ id: c.id, position: idx })),
      products: localProducts.value.map(p => ({
        id: p.id,
        position: p.position,
        categoryId: p.categoryId,
      })),
    };
    // Recompute position per category cleanly (0-based) for products
    const groupedByCat = {};
    for (const p of localProducts.value) {
      const key = p.categoryId || 'none';
      groupedByCat[key] = groupedByCat[key] || [];
      groupedByCat[key].push(p);
    }
    payload.products = [];
    for (const key of Object.keys(groupedByCat)) {
      groupedByCat[key].forEach((p, idx) => {
        payload.products.push({ id: p.id, position: idx, categoryId: key === 'none' ? null : key });
      });
    }
    await api.post('/menu/reorder', payload);
    emit('saved');
    emit('close');
  } catch (e) {
    alert(e?.response?.data?.message || 'Erro ao salvar ordem');
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
.reorder-col {
  display: flex;
  flex-direction: column;
  min-height: 60vh;
  max-height: 70vh;
}
.reorder-col-header {
  padding: 0.75rem 1rem;
  font-weight: 600;
  border-bottom: 1px solid var(--border-color, #e6e6e6);
  background: var(--bg-zebra, #fafafa);
}
.reorder-col-hint {
  padding: 0.5rem 1rem;
  font-size: 0.75rem;
  color: var(--text-muted, #adb5bd);
}
.reorder-list {
  overflow-y: auto;
  flex: 1;
  padding: 0.25rem 0.5rem 1rem;
}
.reorder-item {
  display: flex;
  align-items: center;
  padding: 0.6rem 0.75rem;
  border: 1px solid var(--border-color, #e6e6e6);
  border-radius: 0.5rem;
  margin-bottom: 0.35rem;
  background: #fff;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.reorder-item:hover {
  background: var(--bg-hover, #f0f0f0);
}
.reorder-item-active {
  border-color: var(--primary, #105784);
  background: rgba(16, 87, 132, 0.06);
}
.drag-handle {
  cursor: grab;
  padding: 0 2px;
}
.drag-handle:active {
  cursor: grabbing;
}
.sortable-ghost {
  opacity: 0.35;
  background: var(--bg-hover, #f0f0f0);
}
.sortable-drag {
  opacity: 0.9;
}
</style>
