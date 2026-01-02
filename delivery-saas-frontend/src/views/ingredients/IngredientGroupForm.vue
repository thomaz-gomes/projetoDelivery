<template>
  <div class="p-4">
    <h2 class="h4 mb-3">{{ id ? 'Editar Grupo' : 'Novo Grupo' }}</h2>
    <div class="card">
      <div class="card-body">
        <form @submit.prevent="save" class="row g-2">
          <div class="col-md-6">
            <TextInput v-model="form.name" placeholder="Nome" inputClass="form-control" required />
          </div>
          <div class="col-md-3">
            <select v-model="form.parentId" class="form-select">
              <option :value="null">-- Grupo pai (opcional) --</option>
              <option v-for="g in groups" :key="g.id" :value="g.id">{{ g.name }}</option>
            </select>
          </div>
          <div class="col-md-2 d-flex align-items-center">
            <div class="form-check">
              <input class="form-check-input" type="checkbox" v-model="form.composesCmv" id="compcmv" />
              <label class="form-check-label" for="compcmv">Compõe CMV</label>
            </div>
          </div>

          <div class="col-12 mt-2">
            <div class="d-flex gap-2">
              <button class="btn btn-primary" :disabled="saving">Salvar</button>
              <button type="button" class="btn btn-outline-secondary" @click="cancel">Cancelar</button>
            </div>
            <div v-if="error" class="text-danger small mt-2">{{ error }}</div>
          </div>
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

const form = ref({ id: null, name: '', parentId: null, composesCmv: false });
const groups = ref([]);
const saving = ref(false);
const error = ref('');

async function fetchGroups(){
  try{ const { data } = await api.get('/ingredient-groups'); groups.value = data || []; }catch(e){}
}

async function fetchExisting(){
  if(!id) return;
  try{
    const { data } = await api.get(`/ingredient-groups/${id}`);
    if(data) form.value = { id: data.id, name: data.name, parentId: data.parentId || null, composesCmv: !!data.composesCmv };
  }catch(e){ error.value = 'Falha ao carregar grupo'; }
}

async function save(){
  saving.value = true; error.value = '';
  try{
    const payload = { name: form.value.name, parentId: form.value.parentId || null, composesCmv: !!form.value.composesCmv };
    if(id) await api.patch(`/ingredient-groups/${id}`, payload);
    else await api.post('/ingredient-groups', payload);
    router.push('/ingredient-groups');
  }catch(e){ error.value = e?.response?.data?.message || 'Erro ao salvar' }
  finally{ saving.value = false }
}

function cancel(){ router.push('/ingredient-groups'); }

onMounted(()=>{ fetchGroups(); fetchExisting(); });
</script>
