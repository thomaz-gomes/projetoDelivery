<template>
  <div class="p-4">
    <h2 class="h4 mb-3">{{ id ? 'Editar Ingrediente' : 'Novo Ingrediente' }}</h2>
    <div class="card">
      <div class="card-body">
        <form @submit.prevent="save" class="row g-2">
          <div class="col-md-4"><TextInput v-model="form.description" inputClass="form-control" placeholder="Descrição" required /></div>
          <div class="col-md-2"><select v-model="form.unit" class="form-select"> <option v-for="u in UNITS" :key="u">{{u}}</option></select></div>
          <div class="col-md-3"><select v-model="form.groupId" class="form-select"><option :value="null">-- Grupo (opcional) --</option><option v-for="g in groups" :key="g.id" :value="g.id">{{g.name}}</option></select></div>
          <div class="col-md-3 d-flex align-items-center"><div class="form-check"><input class="form-check-input" type="checkbox" v-model="form.controlsStock" id="ctrlstock" /><label class="form-check-label" for="ctrlstock">Controla estoque</label></div></div>

          <div class="col-md-2"><input v-model="form.minStock" type="number" step="any" class="form-control" placeholder="Estoque mínimo" :disabled="!form.controlsStock" /></div>
          <div class="col-md-2"><input v-model="form.currentStock" type="number" step="any" class="form-control" placeholder="Estoque atual" :disabled="!form.controlsStock" /></div>
          <div class="col-md-2"><input v-model="form.avgCost" type="number" step="0.01" class="form-control" placeholder="Custo médio" /></div>
          <div class="col-md-2 d-flex align-items-center"><div class="form-check"><input class="form-check-input" type="checkbox" v-model="form.composesCmv" id="composes" /><label class="form-check-label" for="composes">Compõe CMV</label></div></div>

          <div class="col-12 mt-2"><div class="d-flex gap-2"><button class="btn btn-primary" :disabled="saving">Salvar</button><button type="button" class="btn btn-outline-secondary" @click="cancel">Cancelar</button></div>
          <div v-if="error" class="text-danger small mt-2">{{ error }}</div></div>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import api from '../../api';

const route = useRoute();
const router = useRouter();
const id = route.params.id || null;

const form = ref({ id: null, description: '', unit: 'UN', groupId: null, controlsStock: true, composesCmv: false, minStock: '', currentStock: '', avgCost: '' });
const groups = ref([]);
const saving = ref(false);
const error = ref('');
const UNITS = ['UN','GR','KG','ML','L'];

async function fetch(){
  try{
    const [{ data: rows }, { data: g }] = await Promise.all([ api.get('/ingredients' + (id ? `/${id}` : '') ), api.get('/ingredient-groups') ]);
    groups.value = g || [];
    if(id){
      // if we fetched ingredients endpoint with id, rows will be the ingredient object
      const ing = rows && rows.id ? rows : (Array.isArray(rows) ? rows.find(r => String(r.id) === String(id)) : null);
      if(ing) form.value = { id: ing.id, description: ing.description, unit: ing.unit, groupId: ing.groupId || null, controlsStock: !!ing.controlsStock, composesCmv: !!ing.composesCmv, minStock: ing.minStock || '', currentStock: ing.currentStock || '', avgCost: ing.avgCost || '' };
    }
  }catch(e){ error.value = 'Falha ao carregar dados' }
}

async function save(){
  saving.value = true; error.value = '';
  try{
    const payload = { description: form.value.description, unit: form.value.unit, groupId: form.value.groupId || null, controlsStock: !!form.value.controlsStock, composesCmv: !!form.value.composesCmv, minStock: form.value.minStock === '' ? null : Number(form.value.minStock), currentStock: form.value.currentStock === '' ? null : Number(form.value.currentStock), avgCost: form.value.avgCost === '' ? null : Number(form.value.avgCost) };
    if(id) await api.patch(`/ingredients/${id}`, payload);
    else await api.post('/ingredients', payload);
    router.push('/ingredients');
  }catch(e){ error.value = e?.response?.data?.message || 'Erro ao salvar' }
  finally{ saving.value = false }
}

function cancel(){ router.push('/ingredients'); }

onMounted(fetch);
</script>
