<script setup>
import { ref, onMounted, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import api from '../../api';
import Swal from 'sweetalert2';
import 'sweetalert2/dist/sweetalert2.min.css';

const route = useRoute();
const router = useRouter();
const id = route.params.id;

const sheet = ref(null);
const loading = ref(false);
const error = ref('');
const itemQty = ref('');
const itemIng = ref(null);
const ingredients = ref([]);

const selectedIngredient = computed(() => {
  try{ return ingredients.value.find(i => String(i.id) === String(itemIng.value)) || null }catch(e){ return null }
});

function fmtMoney(v){ if (v === null || v === undefined || Number.isNaN(Number(v))) return '-'; return Number(v).toFixed(2); }

async function fetch(){ loading.value = true; try{ const [{ data: s }, { data: ings }] = await Promise.all([ api.get(`/technical-sheets/${id}`), api.get('/ingredients') ]); sheet.value = s; ingredients.value = ings || []; }catch(e){ error.value = 'Falha ao carregar' } finally{ loading.value = false } }

async function save(){
  try{
    await api.patch(`/technical-sheets/${id}`, { name: sheet.value.name, notes: sheet.value.notes });
    await Swal.fire({ icon: 'success', title: 'Salvo', text: 'Ficha técnica salva com sucesso' });
    router.push('/technical-sheets');
  }catch(e){
    Swal.fire({ icon: 'error', text: e?.response?.data?.message || 'Erro' });
  }
}

async function addItem(){ if(!sheet.value || !itemIng.value || !itemQty.value) return; try{ await api.post(`/technical-sheets/${sheet.value.id}/items`, { ingredientId: itemIng.value, quantity: Number(itemQty.value) }); await fetch(); itemQty.value=''; itemIng.value=null; }catch(e){ alert(e?.response?.data?.message || 'Erro ao adicionar item') } }

async function removeItem(itId){ if(!sheet.value) return; try{ await api.delete(`/technical-sheets/${sheet.value.id}/items/${itId}`); await fetch(); }catch(e){ alert('Erro ao remover item') } }

function goBack(){ router.push('/technical-sheets') }

onMounted(fetch);
</script>

<template>
  <div class="p-4">
    <div class="d-flex justify-content-between align-items-center mb-3">
      <h2 class="h4">Editar Ficha Técnica</h2>
      <div><button class="btn btn-outline-secondary" @click="goBack">Voltar</button></div>
    </div>

    <div v-if="sheet" class="card">
      <div class="card-body">
        <div class="row g-2 mb-3">
          <div class="col-md-6"><TextInput v-model="sheet.name" inputClass="form-control" placeholder="Nome da ficha" required /></div>
          <div class="col-md-6"><TextInput v-model="sheet.notes" inputClass="form-control" placeholder="Observações (opcional)" /></div>
        </div>
        <div class="mb-3 d-flex gap-2 align-items-start">
          <select v-model="itemIng" class="form-select"><option :value="null">-- Selecione ingrediente --</option><option v-for="i in ingredients" :key="i.id" :value="i.id">{{ i.description }} ({{ i.unit }})</option></select>
          <input v-model="itemQty" type="number" step="any" class="form-control" placeholder="Quantidade" />
          <button class="btn btn-primary" @click="addItem">Adicionar</button>
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
            <tr v-for="it in sheet.items" :key="it.id">
              <td>{{ it.ingredient.description }}</td>
              <td>{{ it.ingredient.unit || '-' }}</td>
              <td>{{ fmtMoney(it.ingredient.avgCost) }}</td>
              <td>{{ it.quantity }}</td>
              <td>{{ fmtMoney((it.ingredient.avgCost || 0) * (it.quantity || 0)) }}</td>
              <td><button class="btn btn-sm btn-outline-danger" @click="removeItem(it.id)">Remover</button></td>
            </tr>
          </tbody>
        </table>

        <div class="mt-3 d-flex gap-2"><button class="btn btn-primary" @click="save">Salvar</button><button class="btn btn-outline-secondary" @click="goBack">Cancelar</button></div>
      </div>
    </div>

    <div v-else class="card p-4 text-muted">Carregando...</div>
  </div>
</template>
