<template>
  <div class="container py-2 py-md-4">
    <h2 class="h4 mb-3">{{ id ? 'Editar Ingrediente' : 'Novo Ingrediente' }}</h2>
    <div class="card">
      <div class="card-body">
        <form @submit.prevent="save">

          <!-- Identificação -->
          <fieldset class="mb-4">
            <legend class="h6 text-muted border-bottom pb-1 mb-3">Identificação</legend>
            <div class="row g-3">
              <div class="col-12 col-lg-5">
                <TextInput
                  v-model="form.description"
                  label="Descrição"
                  placeholder="Ex: Feijão cru"
                  required
                />
              </div>
              <div class="col-6 col-lg-3">
                <label class="form-label"><strong>Unidade</strong></label>
                <SelectInput v-model="form.unit" :options="unitOptions" />
              </div>
              <div class="col-6 col-lg-4">
                <label class="form-label"><strong>Grupo</strong></label>
                <SelectInput
                  v-model="form.groupId"
                  :options="groupOptions"
                  placeholder="-- Sem grupo --"
                />
              </div>
            </div>
          </fieldset>

          <!-- Tipo -->
          <fieldset class="mb-4">
            <legend class="h6 text-muted border-bottom pb-1 mb-3">Tipo</legend>
            <div class="form-check form-switch">
              <input
                class="form-check-input"
                type="checkbox"
                id="isCompositeSwitch"
                v-model="form.isComposite"
              />
              <label class="form-check-label fw-semibold" for="isCompositeSwitch">
                Insumo composto (montado a partir de outros ingredientes)
              </label>
            </div>
            <small class="text-muted">
              Marque quando o ingrediente é produzido a partir de uma receita.
              O custo médio será calculado automaticamente.
            </small>
          </fieldset>

          <!-- Estoque -->
          <fieldset class="mb-4">
            <legend class="h6 text-muted border-bottom pb-1 mb-3">Estoque</legend>
            <div class="row g-3 align-items-end">
              <div class="col-12 col-lg-3">
                <div class="form-check mt-lg-4">
                  <input
                    class="form-check-input"
                    type="checkbox"
                    id="ctrlstock"
                    v-model="form.controlsStock"
                  />
                  <label class="form-check-label" for="ctrlstock">Controla estoque</label>
                </div>
              </div>
              <div class="col-6 col-lg-3">
                <TextInput
                  v-model="form.minStock"
                  label="Estoque mínimo"
                  type="number"
                  :disabled="!form.controlsStock"
                />
              </div>
              <div class="col-6 col-lg-3">
                <TextInput
                  v-model="form.currentStock"
                  label="Estoque atual"
                  type="number"
                  :disabled="!form.controlsStock"
                />
              </div>
              <div class="col-6 col-lg-3">
                <TextInput
                  v-model="form.avgCost"
                  label="Custo médio"
                  type="number"
                  :disabled="form.isComposite"
                />
                <small v-if="form.isComposite" class="text-muted">Derivado da composição</small>
              </div>
              <div class="col-12">
                <div class="form-check">
                  <input
                    class="form-check-input"
                    type="checkbox"
                    id="composes"
                    v-model="form.composesCmv"
                  />
                  <label class="form-check-label" for="composes">Compõe CMV</label>
                </div>
              </div>
            </div>
          </fieldset>

          <!-- Composição (apenas para insumos compostos) -->
          <fieldset v-if="form.isComposite" class="mb-4">
            <legend class="h6 text-muted border-bottom pb-1 mb-3">Composição</legend>

            <div class="row g-3 mb-3">
              <div class="col-6 col-lg-3">
                <TextInput
                  v-model="form.yieldQuantity"
                  label="Rendimento"
                  type="number"
                  required
                />
              </div>
              <div class="col-6 col-lg-3">
                <label class="form-label"><strong>Unidade do rendimento</strong></label>
                <SelectInput v-model="form.yieldUnit" :options="unitOptions" />
              </div>
            </div>

            <div class="table-responsive">
              <table class="table table-sm table-hover align-middle">
                <thead>
                  <tr>
                    <th style="min-width:220px">Ingrediente</th>
                    <th style="width:130px">Quantidade</th>
                    <th style="width:110px">Unidade</th>
                    <th style="width:130px" class="text-end">Custo atual</th>
                    <th style="width:50px"></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(item, idx) in form.compositionItems" :key="idx">
                    <td>
                      <SelectInput
                        v-model="item.ingredientId"
                        :options="availableIngredientOptions"
                        placeholder="-- Selecione --"
                      />
                    </td>
                    <td>
                      <TextInput v-model="item.quantity" type="number" />
                    </td>
                    <td>
                      <SelectInput v-model="item.unit" :options="unitOptions" />
                    </td>
                    <td class="text-end text-muted small">{{ itemCostDisplay(item) }}</td>
                    <td class="text-center">
                      <button
                        type="button"
                        class="btn btn-sm btn-outline-danger py-0 px-1"
                        @click="removeCompositionItem(idx)"
                        title="Remover"
                      >
                        <i class="bi bi-x-lg" style="font-size:11px"></i>
                      </button>
                    </td>
                  </tr>
                  <tr v-if="!form.compositionItems.length">
                    <td colspan="5" class="text-center text-muted small py-3">
                      Adicione os ingredientes que compõem esta receita
                    </td>
                  </tr>
                </tbody>
                <tfoot>
                  <tr>
                    <td colspan="5">
                      <button
                        type="button"
                        class="btn btn-sm btn-outline-primary"
                        @click="addCompositionItem"
                      >
                        <i class="bi bi-plus-lg me-1"></i>Adicionar ingrediente
                      </button>
                    </td>
                  </tr>
                  <tr v-if="form.compositionItems.length">
                    <td colspan="3" class="text-end fw-semibold small">Custo total dos insumos:</td>
                    <td class="text-end fw-semibold small">{{ formatCost(totalCompositionCost) }}</td>
                    <td></td>
                  </tr>
                  <tr v-if="form.compositionItems.length && Number(form.yieldQuantity) > 0">
                    <td colspan="3" class="text-end fw-semibold">
                      Custo por {{ form.yieldUnit || '—' }} do composto:
                    </td>
                    <td class="text-end fw-semibold text-primary">
                      {{ formatCost(derivedAvgCost) }}
                    </td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </fieldset>

          <!-- Ações -->
          <div class="d-flex gap-2">
            <button class="btn btn-primary" :disabled="saving">
              <span v-if="saving" class="spinner-border spinner-border-sm me-1"></span>
              Salvar
            </button>
            <button type="button" class="btn btn-outline-secondary" @click="cancel">
              Cancelar
            </button>
          </div>

          <div v-if="error" class="text-danger small mt-3">{{ error }}</div>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import api from '../../api';

const route = useRoute();
const router = useRouter();
const id = route.params.id || null;

const UNITS = ['UN','GR','KG','ML','L'];
const unitOptions = UNITS.map(u => ({ value: u, label: u }));

const form = ref({
  id: null,
  description: '',
  unit: 'UN',
  groupId: null,
  controlsStock: true,
  composesCmv: false,
  minStock: '',
  currentStock: '',
  avgCost: '',
  isComposite: false,
  yieldQuantity: '',
  yieldUnit: 'GR',
  compositionItems: [],
});
const groups = ref([]);
const allIngredients = ref([]);
const saving = ref(false);
const error = ref('');

const groupOptions = computed(() => groups.value.map(g => ({ value: g.id, label: g.name })));
const availableIngredientOptions = computed(() => allIngredients.value
  .filter(i => !id || i.id !== id)
  .map(i => ({
    value: i.id,
    label: i.description + (i.isComposite ? ' (composto)' : ''),
  }))
);

async function fetchData() {
  try {
    const [ingRes, groupsRes, allRes] = await Promise.all([
      id ? api.get(`/ingredients/${id}`) : Promise.resolve({ data: null }),
      api.get('/ingredient-groups'),
      api.get('/ingredients'),
    ]);
    groups.value = groupsRes.data || [];
    allIngredients.value = allRes.data || [];
    if (id && ingRes.data) {
      const ing = ingRes.data;
      form.value = {
        id: ing.id,
        description: ing.description,
        unit: ing.unit,
        groupId: ing.groupId || null,
        controlsStock: !!ing.controlsStock,
        composesCmv: !!ing.composesCmv,
        minStock: ing.minStock ?? '',
        currentStock: ing.currentStock ?? '',
        avgCost: ing.avgCost ?? '',
        isComposite: !!ing.isComposite,
        yieldQuantity: ing.yieldQuantity ?? '',
        yieldUnit: ing.yieldUnit || 'GR',
        compositionItems: (ing.compositionItems || []).map(ci => ({
          ingredientId: ci.ingredientId,
          quantity: Number(ci.quantity),
          unit: ci.unit,
        })),
      };
    }
  } catch (e) {
    error.value = 'Falha ao carregar dados';
  }
}

function addCompositionItem() {
  form.value.compositionItems.push({ ingredientId: null, quantity: '', unit: 'GR' });
}
function removeCompositionItem(idx) {
  form.value.compositionItems.splice(idx, 1);
}

function findIngredient(ingId) {
  return allIngredients.value.find(i => i.id === ingId);
}

function formatCost(value) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  return Number(value).toFixed(4);
}

function itemCostDisplay(item) {
  const ing = findIngredient(item.ingredientId);
  if (!ing || ing.avgCost == null || !item.quantity) return '—';
  const qty = Number(item.quantity);
  if (!Number.isFinite(qty)) return '—';
  return formatCost(Number(ing.avgCost) * qty);
}

const totalCompositionCost = computed(() => {
  return form.value.compositionItems.reduce((acc, item) => {
    const ing = findIngredient(item.ingredientId);
    const qty = Number(item.quantity);
    if (!ing || ing.avgCost == null || !Number.isFinite(qty)) return acc;
    return acc + Number(ing.avgCost) * qty;
  }, 0);
});

const derivedAvgCost = computed(() => {
  const y = Number(form.value.yieldQuantity);
  if (!y || y <= 0) return 0;
  return totalCompositionCost.value / y;
});

async function save() {
  saving.value = true;
  error.value = '';
  try {
    const payload = {
      description: form.value.description,
      unit: form.value.unit,
      groupId: form.value.groupId || null,
      controlsStock: !!form.value.controlsStock,
      composesCmv: !!form.value.composesCmv,
      minStock: form.value.minStock === '' ? null : Number(form.value.minStock),
      currentStock: form.value.currentStock === '' ? null : Number(form.value.currentStock),
      avgCost: form.value.avgCost === '' ? null : Number(form.value.avgCost),
      isComposite: !!form.value.isComposite,
      yieldQuantity: form.value.isComposite ? Number(form.value.yieldQuantity) : null,
      yieldUnit: form.value.isComposite ? form.value.yieldUnit : null,
      compositionItems: form.value.isComposite
        ? form.value.compositionItems
            .filter(i => i.ingredientId && Number(i.quantity) > 0)
            .map(i => ({
              ingredientId: i.ingredientId,
              quantity: Number(i.quantity),
              unit: i.unit,
            }))
        : [],
    };
    if (id) await api.patch(`/ingredients/${id}`, payload);
    else await api.post('/ingredients', payload);
    router.push('/ingredients');
  } catch (e) {
    error.value = e?.response?.data?.message || 'Erro ao salvar';
  } finally {
    saving.value = false;
  }
}

function cancel() {
  router.push('/ingredients');
}

onMounted(fetchData);
</script>
