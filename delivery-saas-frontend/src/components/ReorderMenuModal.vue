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

        <!-- Tabs -->
        <ul class="nav nav-tabs px-3 pt-2">
          <li class="nav-item">
            <a class="nav-link" :class="{ active: activeTab === 'menu' }" href="#" @click.prevent="activeTab = 'menu'">
              <i class="bi bi-folder me-1"></i>Categorias e Produtos
            </a>
          </li>
          <li class="nav-item">
            <a class="nav-link" :class="{ active: activeTab === 'options' }" href="#" @click.prevent="activeTab = 'options'; loadOptionGroups()">
              <i class="bi bi-list-check me-1"></i>Opções
            </a>
          </li>
        </ul>

        <div class="modal-body p-0">
          <!-- Tab: Categorias e Produtos -->
          <div v-show="activeTab === 'menu'" class="row g-0">
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

          <!-- Tab: Opções -->
          <div v-show="activeTab === 'options'" class="row g-0">
            <!-- Grupos de Opções -->
            <div class="col-md-5 border-end reorder-col">
              <div class="reorder-col-header">
                <i class="bi bi-collection me-1"></i>Grupos de opções
                <span class="badge bg-secondary ms-1">{{ localOptionGroups.length }}</span>
              </div>
              <div class="reorder-col-hint">Arraste para reordenar</div>
              <div v-if="loadingOptions" class="text-center py-3">
                <div class="spinner-border spinner-border-sm text-primary"></div>
              </div>
              <ul v-else ref="optionGroupsEl" class="reorder-list list-unstyled mb-0">
                <li
                  v-for="g in localOptionGroups"
                  :key="g.id"
                  :data-id="g.id"
                  class="reorder-item"
                  :class="{ 'reorder-item-active': g.id === selectedGroupId }"
                  @click="selectGroup(g.id)"
                >
                  <i class="bi bi-grip-vertical text-muted me-2 drag-handle"></i>
                  <span class="flex-grow-1">{{ g.name }}</span>
                  <span class="badge bg-light text-dark border ms-2">
                    {{ (g.options || []).length }}
                  </span>
                </li>
                <li v-if="!localOptionGroups.length" class="text-muted small p-3">
                  Nenhum grupo de opções.
                </li>
              </ul>
            </div>

            <!-- Opções do grupo -->
            <div class="col-md-7 reorder-col">
              <div class="reorder-col-header">
                <i class="bi bi-list-ul me-1"></i>
                {{ selectedGroup ? `Opções — ${selectedGroup.name}` : 'Opções' }}
                <span v-if="selectedGroup" class="badge bg-secondary ms-1">
                  {{ filteredOptions.length }}
                </span>
              </div>
              <div class="reorder-col-hint">
                {{ selectedGroup
                    ? 'Arraste para reordenar dentro do grupo'
                    : 'Selecione um grupo à esquerda' }}
              </div>
              <ul ref="optionsEl" class="reorder-list list-unstyled mb-0">
                <li
                  v-for="o in filteredOptions"
                  :key="o.id"
                  :data-id="o.id"
                  class="reorder-item"
                >
                  <i class="bi bi-grip-vertical text-muted me-2 drag-handle"></i>
                  <span class="flex-grow-1">{{ o.name }}</span>
                  <span v-if="o.price > 0" class="text-muted small ms-2">
                    +{{ formatCurrency(o.price) }}
                  </span>
                  <span v-if="!o.isAvailable" class="badge bg-warning text-dark ms-2">Inativo</span>
                </li>
                <li v-if="selectedGroup && !filteredOptions.length"
                    class="text-muted small p-3">
                  Nenhuma opção neste grupo.
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
  categories: { type: Array, required: true },
  products: { type: Array, required: true },
});
const emit = defineEmits(['close', 'saved']);

const activeTab = ref('menu');

// ── Menu tab state ──
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

// ── Options tab state ──
const localOptionGroups = ref([]);
const localOptions = ref([]);
const loadingOptions = ref(false);
const optionsLoaded = ref(false);
const initialGroupOrder = ref([]);
const initialOptionOrder = ref([]);
const selectedGroupId = ref(null);

const optionGroupsEl = ref(null);
const optionsEl = ref(null);
let optionGroupsSortable = null;
let optionsSortable = null;

const selectedGroup = computed(() =>
  localOptionGroups.value.find(g => g.id === selectedGroupId.value) || null
);

const filteredOptions = computed(() => {
  if (!selectedGroupId.value) return [];
  return localOptions.value.filter(o => o.groupId === selectedGroupId.value);
});

// ── Dirty state ──
const dirty = computed(() => {
  // Menu tab
  const currentCatOrder = localCategories.value.map(c => c.id);
  if (currentCatOrder.join() !== initialCategoryOrder.join()) return true;
  const currentProdOrder = localProducts.value.map(p => `${p.categoryId || 'none'}|${p.id}`);
  if (currentProdOrder.join() !== initialProductOrder.join()) return true;
  // Options tab
  if (optionsLoaded.value) {
    const currentGroupOrder = localOptionGroups.value.map(g => g.id);
    if (currentGroupOrder.join() !== initialGroupOrder.value.join()) return true;
    const currentOptOrder = localOptions.value.map(o => `${o.groupId}|${o.id}`);
    if (currentOptOrder.join() !== initialOptionOrder.value.join()) return true;
  }
  return false;
});

// ── Menu tab methods ──
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

// ── Options tab methods ──
function selectGroup(id) {
  selectedGroupId.value = id;
}

async function loadOptionGroups() {
  if (optionsLoaded.value) return;
  loadingOptions.value = true;
  try {
    const { data } = await api.get('/menu/options');
    const groups = (data || []).sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    localOptionGroups.value = groups.map(g => ({ ...g }));
    const allOpts = [];
    for (const g of groups) {
      for (const o of (g.options || [])) {
        allOpts.push({ ...o, groupId: g.id });
      }
    }
    localOptions.value = allOpts.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    initialGroupOrder.value = groups.map(g => g.id);
    initialOptionOrder.value = allOpts.map(o => `${o.groupId}|${o.id}`);
    selectedGroupId.value = groups[0]?.id || null;
    optionsLoaded.value = true;
    await nextTick();
    initOptionGroupsSortable();
    initOptionsSortable();
  } catch (e) {
    console.error('Erro ao carregar opções:', e);
  } finally {
    loadingOptions.value = false;
  }
}

function initOptionGroupsSortable() {
  if (!optionGroupsEl.value) return;
  optionGroupsSortable?.destroy();
  optionGroupsSortable = Sortable.create(optionGroupsEl.value, {
    animation: 150,
    handle: '.drag-handle',
    onEnd: () => {
      const ids = Array.from(optionGroupsEl.value.children)
        .filter(el => el.dataset.id)
        .map(el => el.dataset.id);
      const byId = new Map(localOptionGroups.value.map(g => [g.id, g]));
      localOptionGroups.value = ids.map((id, idx) => ({ ...byId.get(id), position: idx }));
    },
  });
}

function initOptionsSortable() {
  if (!optionsEl.value) return;
  optionsSortable?.destroy();
  optionsSortable = Sortable.create(optionsEl.value, {
    animation: 150,
    handle: '.drag-handle',
    onEnd: () => {
      const ids = Array.from(optionsEl.value.children)
        .filter(el => el.dataset.id)
        .map(el => el.dataset.id);
      const otherOptions = localOptions.value.filter(o => o.groupId !== selectedGroupId.value);
      const byId = new Map(localOptions.value.map(o => [o.id, o]));
      const reorderedForGroup = ids.map((id, idx) => {
        const opt = byId.get(id);
        return opt ? { ...opt, position: idx } : null;
      }).filter(Boolean);
      localOptions.value = [...otherOptions, ...reorderedForGroup];
    },
  });
}

function formatCurrency(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0);
}

// ── Lifecycle ──
onMounted(() => {
  nextTick(() => {
    initCategoriesSortable();
    initProductsSortable();
  });
});

watch(selectedCategoryId, async () => {
  await nextTick();
  initProductsSortable();
});

watch(selectedGroupId, async () => {
  await nextTick();
  initOptionsSortable();
});

onBeforeUnmount(() => {
  categoriesSortable?.destroy();
  productsSortable?.destroy();
  optionGroupsSortable?.destroy();
  optionsSortable?.destroy();
});

// ── Save ──
async function save() {
  saving.value = true;
  try {
    const payload = {
      categories: localCategories.value.map((c, idx) => ({ id: c.id, position: idx })),
      products: [],
    };
    // Recompute position per category cleanly (0-based)
    const groupedByCat = {};
    for (const p of localProducts.value) {
      const key = p.categoryId || 'none';
      groupedByCat[key] = groupedByCat[key] || [];
      groupedByCat[key].push(p);
    }
    for (const key of Object.keys(groupedByCat)) {
      groupedByCat[key].forEach((p, idx) => {
        payload.products.push({ id: p.id, position: idx, categoryId: key === 'none' ? null : key });
      });
    }
    // Options
    if (optionsLoaded.value) {
      payload.optionGroups = localOptionGroups.value.map((g, idx) => ({ id: g.id, position: idx }));
      payload.options = [];
      const groupedByGroup = {};
      for (const o of localOptions.value) {
        groupedByGroup[o.groupId] = groupedByGroup[o.groupId] || [];
        groupedByGroup[o.groupId].push(o);
      }
      for (const key of Object.keys(groupedByGroup)) {
        groupedByGroup[key].forEach((o, idx) => {
          payload.options.push({ id: o.id, position: idx });
        });
      }
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
