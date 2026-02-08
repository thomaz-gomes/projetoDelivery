<template>
  <div class="p-4">
    <h2 class="h4 mb-3">{{ id ? 'Editar Lançamento' : 'Novo Lançamento' }}</h2>
    <div class="card mb-3">
      <div class="card-body">
        <form @submit.prevent="save" class="row g-2">
          <div class="col-md-3">
            <select v-model="form.type" class="form-select">
              <option value="IN">Entrada</option>
              <option value="OUT">Saída</option>
            </select>
          </div>
          <div class="col-md-4"><TextInput v-model="form.reason" inputClass="form-control" placeholder="Motivo (opcional)" /></div>
          <div class="col-md-5 text-end"><button class="btn btn-primary" :disabled="saving">Salvar</button></div>
        </form>
      </div>
    </div>

    <ListCard title="Itens" icon="bi bi-list-ul" :subtitle="form.items.length ? `${form.items.length} itens` : ''">
      <template #actions>
        <div class="d-flex gap-2 mb-2">
          <select v-model="item.ingredientId" class="form-select"><option :value="null">-- Selecione ingrediente --</option><option v-for="ing in ingredients" :key="ing.id" :value="ing.id">{{ ing.description }} ({{ ing.unit }})</option></select>
          <input v-model="item.quantity" type="number" step="any" class="form-control" placeholder="Quantidade" />
          <input v-model="item.unitCost" type="number" step="0.01" class="form-control" placeholder="Custo unit. (opcional)" />
          <button class="btn btn-secondary" @click="addItem">Adicionar</button>
        </div>
      </template>

      <template #default>
        <div class="table-responsive">
          <table class="table table-sm">
            <thead><tr><th>Ingrediente</th><th>Qtd</th><th>Custo Unit.</th><th>Ações</th></tr></thead>
            <tbody>
              <tr v-for="(it, idx) in form.items" :key="idx">
                <td>{{ it.ingredientDesc || it.ingredientId }}</td>
                <td>{{ it.quantity }}</td>
                <td>{{ it.unitCost !== null ? Number(it.unitCost).toFixed(2) : '-' }}</td>
                <td><button class="btn btn-sm btn-outline-danger" @click="removeItem(idx)">Remover</button></td>
              </tr>
              <tr v-if="!form.items.length"><td colspan="4" class="text-center text-muted py-4">Nenhum item adicionado.</td></tr>
            </tbody>
          </table>
        </div>
      </template>
    </ListCard>

  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import api from '../api';
import ListCard from '../components/ListCard.vue';

const route = useRoute();
const router = useRouter();
const id = route.params.id || null;

const form = ref({ id: null, type: 'IN', reason: '', items: [] });
const ingredients = ref([]);
const item = ref({ ingredientId: null, quantity: '', unitCost: '' });
const saving = ref(false);

async function fetchIngredients(){ try{ const { data } = await api.get('/ingredients'); ingredients.value = data || []; }catch(e){} }

function addItem(){ if(!item.value.ingredientId || !item.value.quantity) return; const ing = ingredients.value.find(i => String(i.id) === String(item.value.ingredientId)); form.value.items.push({ ingredientId: item.value.ingredientId, ingredientDesc: ing ? ing.description : null, quantity: Number(item.value.quantity), unitCost: item.value.unitCost === '' ? null : Number(item.value.unitCost) }); item.value = { ingredientId: null, quantity: '', unitCost: '' }; }
function removeItem(idx){ form.value.items.splice(idx,1); }

async function save(){ saving.value = true; try{
    // Try to infer companyId from the first item's ingredient (safer than sending null)
    let companyId = null;
    if (form.value.items && form.value.items.length) {
      const firstIngId = form.value.items[0].ingredientId;
      const ing = ingredients.value.find(i => String(i.id) === String(firstIngId));
      if (ing && ing.companyId) companyId = ing.companyId;
    }
    const payload = { companyId: companyId, type: form.value.type, reason: form.value.reason, items: form.value.items.map(i => ({ ingredientId: i.ingredientId, quantity: i.quantity, unitCost: i.unitCost })) };
    await api.post('/stock-movements', payload);
    router.push('/stock-movements');
  }catch(e){ alert(e?.response?.data?.message || 'Erro ao salvar') } finally{ saving.value = false } }

onMounted(()=>{ fetchIngredients(); });
</script>
