<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue';
import { useRouter } from 'vue-router';
import api from '../../api';
import ListCard from '../../components/ListCard.vue';

const router = useRouter();
const list = ref([]);
const q = ref('')
const loading = ref(false);
const error = ref('');
const groups = ref([]);

async function fetch(){
  loading.value = true;
  try{
    const [{ data: rows }, { data: g }] = await Promise.all([ api.get('/ingredients'), api.get('/ingredient-groups') ]);
    list.value = rows || [];
    groups.value = g || [];
  }catch(e){ error.value = 'Falha ao carregar ingredientes' }
  finally{ loading.value = false }
}

function goToNew(){ router.push('/ingredients/new'); }
function goToEdit(i){ router.push(`/ingredients/${i.id}`); }

function onKeydown(ev){
  try{
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (ev.key === 'n' || ev.key === 'N') goToNew();
  }catch(e){}
}

onMounted(() => { fetch(); document.addEventListener('keydown', onKeydown); });

const displayed = computed(() => {
  if(!q.value) return list.value
  const term = q.value.toLowerCase()
  return (list.value || []).filter(i => (i.description||'').toLowerCase().includes(term) || (i.group && i.group.name && i.group.name.toLowerCase().includes(term)))
})

function onQuickSearch(val){ q.value = val }
function onQuickClear(){ q.value = '' }
onUnmounted(() => { try{ document.removeEventListener('keydown', onKeydown); }catch(e){} });
</script>

<template>
  <div class="p-4">
    <ListCard title="Ingredientes" icon="bi bi-box-seam" :subtitle="list.length ? `${list.length} itens` : ''" :quickSearch="true" quickSearchPlaceholder="Buscar por descrição, grupo" @quick-search="onQuickSearch" @quick-clear="onQuickClear">
      <template #actions>
        <div class="mb-3 d-flex justify-content-end align-items-center">
          <button class="btn btn-primary" @click="goToNew">Novo Ingrediente</button>
        </div>
      </template>

      <template #default>
        <div class="table-responsive">
          <table class="table table-hover mb-0">
            <thead><tr><th>Descrição</th><th>Unidade</th><th>Grupo</th><th>Controla</th><th>Estoque</th><th>Custo Médio</th><th></th></tr></thead>
            <tbody>
              <tr v-for="i in displayed" :key="i.id">
                <td>{{ i.description }}</td>
                <td>{{ i.unit }}</td>
                <td>{{ i.group ? i.group.name : '-' }}</td>
                <td>{{ i.controlsStock ? 'Sim' : 'Não' }}</td>
                <td>{{ i.currentStock !== null ? i.currentStock : '-' }}</td>
                <td>{{ i.avgCost !== null ? i.avgCost : '-' }}</td>
                <td><button class="btn btn-sm btn-outline-secondary" @click="goToEdit(i)">Editar</button></td>
              </tr>
              <tr v-if="!list.length"><td colspan="7" class="text-center text-muted py-4">Nenhum ingrediente cadastrado.</td></tr>
            </tbody>
          </table>
        </div>
      </template>
    </ListCard>
  </div>
</template>