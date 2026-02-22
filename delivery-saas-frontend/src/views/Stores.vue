<script setup>
import { ref, computed, onMounted } from 'vue';
import api from '../api';
import ListCard from '@/components/ListCard.vue'

const stores = ref([]);
const loading = ref(false);
const search = ref('')

// The primary store is the first one created (oldest, returned first by API)  it cannot be deleted
const primaryStoreId = computed(() => stores.value.length ? stores.value[0].id : null)

const totalCount = computed(() => stores.value.length)
const activeCount = computed(() => (stores.value || []).filter(s => (s.isActive === undefined ? true : !!s.isActive)).length)

const filtered = computed(() => {
  const q = (search.value || '').toLowerCase().trim()
  if (!q) return stores.value
  return stores.value.filter(s => (s.name || '').toLowerCase().includes(q))
})

async function load() {
  loading.value = true;
  try {
    const { data } = await api.get('/stores');
    stores.value = data || [];
  } catch (e) {
    console.error('Failed to load stores', e);
  } finally { loading.value = false; }
}

async function remove(id) {
  if (!confirm('Remover esta loja?')) return;
  try {
    await api.delete(`/stores/${id}`);
    await load();
  } catch (e) { console.error('Failed to delete store', e); alert('Erro ao remover'); }
}

function resetFilters() { search.value = ''; load() }

onMounted(load);
</script>

<template>
  <div>
    <ListCard title="Lojas" icon="bi bi-shop-window" :subtitle="stores.length ? `${stores.length} itens` : ''">
      <template #actions>
        <div class="d-flex align-items-center" style="gap:8px">
          <div class="d-flex" style="gap:8px">
            <button class="btn btn-primary" @click="$router.push('/settings/stores/new')">
              <i class="bi bi-plus-lg me-1"></i> Nova Loja
            </button>
            <button class="btn btn-outline-secondary" @click="load">Recarregar</button>
          </div>
          <div class="ms-2 d-flex align-items-center" style="gap:8px">
            <span class="small text-muted">Total:</span>
            <span class="badge bg-secondary">{{ totalCount }}</span>
            <span class="small text-muted ms-2">Ativos:</span>
            <span class="badge bg-success">{{ activeCount }}</span>
          </div>
        </div>
      </template>

      <template #filters>
        <div class="row g-2">
          <div class="col-md-6">
            <input v-model="search" type="text" class="form-control" placeholder="Buscar loja por nome" />
          </div>
          <div class="col-md-6 d-flex justify-content-end align-items-start">
            <button class="btn btn-outline-secondary" @click="resetFilters">Limpar</button>
          </div>
        </div>
      </template>

      <template #default>
        <div v-if="loading" class="text-center py-4">Carregando...</div>
        <div v-else>
          <div v-if="filtered.length === 0" class="alert alert-info">Nenhuma loja encontrada</div>
          <div v-else class="table-responsive">
            <table class="table table-striped align-middle">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>CNPJ</th>
                  <th>Timezone</th>
                  <th style="width:120px">Acoes</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="s in filtered" :key="s.id">
                  <td>{{ s.name }}</td>
                  <td>{{ s.cnpj || '-' }}</td>
                  <td>{{ s.timezone || '-' }}</td>
                  <td>
                    <div class="d-flex align-items-center">
                      <button class="btn btn-sm btn-light me-2" @click="$router.push(`/settings/stores/${s.id}`)" title="Editar">
                        <i class="bi bi-pencil-square"></i>
                      </button>
                      <button
                        class="btn btn-sm btn-outline-danger"
                        @click="remove(s.id)"
                        :disabled="s.id === primaryStoreId"
                        :title="s.id === primaryStoreId ? 'A loja principal nao pode ser removida' : 'Remover'"
                      >
                        <i class="bi bi-trash"></i>
                      </button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="d-flex align-items-center justify-content-between mt-3">
            <div><small>Mostrando {{ filtered.length }} de {{ stores.length }}</small></div>
            <div></div>
          </div>
        </div>
      </template>
    </ListCard>
  </div>
</template>

<style scoped>
.text-monospace { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, 'Roboto Mono', 'Courier New', monospace; }
</style>
