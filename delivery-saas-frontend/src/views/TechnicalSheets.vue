<script setup>
import { ref, onMounted, computed } from 'vue';
import api from '../api';

const list = ref([]);
const loading = ref(false);
const form = ref({ id: null, name: '', notes: '' });
const saving = ref(false);
const error = ref('');
const selected = ref(null);
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

function edit(s){ form.value = { id: s.id, name: s.name, notes: s.notes || '' }; loadSheet(s.id) }

async function loadSheet(id){
  try{ const { data } = await api.get(`/technical-sheets/${id}`); selected.value = data; }catch(e){ selected.value = null }
}

function reset(){ form.value = { id: null, name: '', notes: '' }; selected.value = null }

async function save(){ saving.value = true; error.value='';
  try{
    const payload = { name: form.value.name, notes: form.value.notes };
    if(form.value.id) await api.patch(`/technical-sheets/${form.value.id}`, payload);
    else await api.post('/technical-sheets', payload);
    await fetch(); reset();
  }catch(e){ error.value = e?.response?.data?.message || 'Erro' }
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
</script>

<template>
  <div class="p-4">
    <h2 class="h4 mb-3">Fichas Técnicas</h2>

    <div class="card mb-3">
      <div class="card-body">
        <form @submit.prevent="save" class="row g-2">
          <div class="col-md-6"><TextInput v-model="form.name" inputClass="form-control" placeholder="Nome da ficha" required /></div>
          <div class="col-md-6"><TextInput v-model="form.notes" inputClass="form-control" placeholder="Observações (opcional)" /></div>
          <div class="col-12 mt-2"><div class="d-flex gap-2"><button class="btn btn-primary" :disabled="saving">Salvar</button><button type="button" class="btn btn-outline-secondary" @click="reset">Limpar</button></div>
          <div v-if="error" class="text-danger small mt-2">{{ error }}</div></div>
        </form>
      </div>
    </div>

    <div class="row">
      <div class="col-md-5">
        <div class="card">
          <div class="list-group list-group-flush">
            <button v-for="s in list" :key="s.id" class="list-group-item list-group-item-action" @click="edit(s)">
              <div class="d-flex justify-content-between"><div>{{ s.name }}</div><small class="text-muted">{{ s.itemCount || 0 }} itens</small></div>
            </button>
          </div>
        </div>
      </div>
      <div class="col-md-7">
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
        <div v-else class="card p-4 text-muted">Selecione uma ficha para editar seus itens.</div>
      </div>
    </div>
  </div>
</template>