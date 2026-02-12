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

async function fetchList(){
  loading.value = true;
  try{
    const { data } = await api.get('/ingredient-groups');
    list.value = data || [];
  }catch(e){ error.value = 'Falha ao carregar grupos'; }
  finally{ loading.value = false }
}

function goToNew(){ router.push('/ingredient-groups/new'); }
function goToEdit(g){ router.push(`/ingredient-groups/${g.id}/edit`); }

function onKeydown(ev){
  try{
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (ev.key === 'n' || ev.key === 'N') goToNew();
  }catch(e){}
}

onMounted(() => { fetchList(); document.addEventListener('keydown', onKeydown); });

const displayed = computed(() => {
  if(!q.value) return list.value
  const term = q.value.toLowerCase()
  return (list.value || []).filter(g => (g.name||'').toLowerCase().includes(term) || String(g.parentId || '').toLowerCase().includes(term))
})

function onQuickSearch(val){ q.value = val }
function onQuickClear(){ q.value = '' }
onUnmounted(() => { try{ document.removeEventListener('keydown', onKeydown); }catch(e){} });
</script>

<template>
  <div class="p-4">

    <ListCard title="Grupos de Ingredientes" icon="bi bi-box" :subtitle="list.length ? `${list.length} itens` : ''" :quickSearch="true" quickSearchPlaceholder="Buscar por nome" @quick-search="onQuickSearch" @quick-clear="onQuickClear">
      <template #actions>
        <div class="mb-3 d-flex justify-content-end align-items-center">
          <button class="btn btn-primary" @click="goToNew">Novo Grupo</button>
        </div>
      </template>

      <template #default>
        <div class="table-responsive">
          <table class="table table-hover mb-0">
            <thead><tr><th>Nome</th><th>Grupo pai</th><th>Compõe CMV</th><th></th></tr></thead>
            <tbody>
              <tr v-for="g in displayed" :key="g.id">
                <td>{{ g.name }}</td>
                <td>{{ g.parentId || '-' }}</td>
                <td>{{ g.composesCmv ? 'Sim' : 'Não' }}</td>
                <td><button class="btn btn-sm btn-outline-secondary" @click="goToEdit(g)">Editar</button></td>
              </tr>
              <tr v-if="!list.length"><td colspan="4" class="text-center text-muted py-4">Nenhum grupo cadastrado.</td></tr>
            </tbody>
          </table>
        </div>
      </template>
    </ListCard>
  </div>
</template>