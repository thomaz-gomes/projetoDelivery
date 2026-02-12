<script setup>
import { ref, onMounted, computed } from 'vue';
import { useRouter } from 'vue-router';
import api from '../../api';
import ListCard from '../../components/ListCard.vue';
import TechnicalSheetForm from '../../components/TechnicalSheetForm.vue';

const list = ref([]);
const q = ref('')
const loading = ref(false);
const form = ref({ id: null, name: '', notes: '' });
const saving = ref(false);
const error = ref('');
const selected = ref(null);
const showModal = ref(false);
const router = useRouter();
const ingredients = ref([]);
const itemQty = ref('');
const itemIng = ref(null);

const selectedIngredient = computed(() => {
  try{
    return ingredients.value.find(i => String(i.id) === String(itemIng.value)) || null;
  }catch(e){ return null }
});

function fmtMoney(v){
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '-';
  return Number(v).toFixed(2);
}

async function fetch(){
  loading.value = true;
  try{
    const [{ data: sheets }, { data: ings }] = await Promise.all([ api.get('/technical-sheets'), api.get('/ingredients') ]);
    list.value = sheets || [];
    ingredients.value = ings || [];
  }catch(e){ error.value = 'Falha ao carregar' }
  finally{ loading.value = false }
}

function edit(s){ router.push(`/technical-sheets/${s.id}/edit`) }

function openCreate(){ reset(); showModal.value = true }

async function loadSheet(id){
  try{ const { data } = await api.get(`/technical-sheets/${id}`); selected.value = data; }catch(e){ selected.value = null }
}

function reset(){ form.value = { id: null, name: '', notes: '' }; selected.value = null; showModal.value = false }

async function save(){ saving.value = true; error.value='';
  try{
    const payload = { name: form.value.name, notes: form.value.notes };
    if(form.value.id) await api.patch(`/technical-sheets/${form.value.id}`, payload);
    else await api.post('/technical-sheets', payload);
    await fetch(); reset();
  }catch(e){
    // show detailed server error when available to aid debugging
    const serverBody = e?.response?.data;
    error.value = serverBody?.message || (serverBody ? JSON.stringify(serverBody) : (e.message || String(e)));
    console.error('TechnicalSheets.save error', e, serverBody);
  }
  finally{ saving.value = false }
}

async function addItem(){
  if(!selected.value || !itemIng.value || !itemQty.value) return;
  try{
    await api.post(`/technical-sheets/${selected.value.id}/items`, { ingredientId: itemIng.value, quantity: Number(itemQty.value) });
    await loadSheet(selected.value.id);
    itemQty.value = '';
    itemIng.value = null;
  }catch(e){ alert(e?.response?.data?.message || 'Erro ao adicionar item') }
}

async function removeItem(id){
  if(!selected.value) return;
  try{ await api.delete(`/technical-sheets/${selected.value.id}/items/${id}`); await loadSheet(selected.value.id); }catch(e){ alert('Erro ao remover item') }
}

onMounted(fetch);

const displayed = computed(() => {
  if(!q.value) return list.value
  const term = q.value.toLowerCase()
  return (list.value || []).filter(s => (s.name || '').toLowerCase().includes(term))
})

function onQuickSearch(val){ q.value = val }
function onQuickClear(){ q.value = '' }
</script>

<template>
  <div class="p-4">

    <ListCard title="Fichas Técnicas" icon="bi bi-file-earmark-text" :subtitle="list.length ? `${list.length} itens` : ''" :quickSearch="true" quickSearchPlaceholder="Buscar por nome" @quick-search="onQuickSearch" @quick-clear="onQuickClear">
      <template #actions>
        <button class="btn btn-primary" @click="openCreate">Nova Ficha</button>
      </template>

      <template #default>
        <div class="table-responsive">
          <table class="table table-hover table-sm mb-0">
            <thead>
              <tr>
                <th>Nome</th>
                <th class="text-end">Itens</th>
                <th class="text-end">Ações</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in displayed" :key="s.id">
                <td>{{ s.name }}</td>
                <td class="text-end">{{ s.itemCount || 0 }}</td>
                <td class="text-end">
                  <button class="btn btn-sm btn-outline-secondary" @click="edit(s)">Editar</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </ListCard>

    <div v-if="showModal">
      <div class="modal-backdrop fade show"></div>
      <div class="modal d-block" tabindex="-1">
        <div class="modal-dialog">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title">Nova Ficha Técnica</h5>
              <button type="button" class="btn-close" aria-label="Close" @click="showModal = false"></button>
            </div>
            <div class="modal-body">
              <TechnicalSheetForm :initial="form" @saved="() => { showModal = false; fetch(); }" @cancel="() => { showModal = false }" />
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-if="selected" class="card">
      <div class="card-body">
        <h5>{{ selected.name }}</h5>
        <p class="small text-muted">{{ selected.notes }}</p>
        <hr />
        <h6>Itens</h6>
        <div class="mb-2">
          <div class="d-flex gap-2">
            <select v-model="itemIng" class="form-select"><option :value="null">-- Selecione ingrediente --</option><option v-for="i in ingredients" :key="i.id" :value="i.id">{{ i.description }} ({{ i.unit }})</option></select>
            <input v-model="itemQty" type="number" step="any" class="form-control" placeholder="Quantidade" />
            <button class="btn btn-primary" @click="addItem">Adicionar</button>
          </div>
          <div class="mt-2 small text-muted">
            <span v-if="selectedIngredient">Unidade: <strong>{{ selectedIngredient.unit }}</strong></span>
            <span v-if="selectedIngredient" class="ms-3">Custo unit.: <strong>{{ fmtMoney(selectedIngredient.avgCost) }}</strong></span>
          </div>
        </div>
        <table class="table table-sm">
          <thead>
            <tr>
              <th>Ingrediente</th>
              <th>Unidade</th>
              <th>Custo Unit.</th>
              <th>Qtd</th>
              <th>Custo Total</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="it in selected.items" :key="it.id">
              <td>{{ it.ingredient.description }}</td>
              <td>{{ it.ingredient.unit || '-' }}</td>
              <td>{{ fmtMoney(it.ingredient.avgCost) }}</td>
              <td>{{ it.quantity }}</td>
              <td>{{ fmtMoney((it.ingredient.avgCost || 0) * (it.quantity || 0)) }}</td>
              <td><button class="btn btn-sm btn-outline-danger" @click="removeItem(it.id)">Remover</button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

  </div>
</template>