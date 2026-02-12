<script setup>
import { ref, computed, onMounted } from 'vue';
import api from '../api';

const stores = ref([]);
const form = ref({ name: '', cnpj: '', timezone: '', address: '', logoUrl: '' });
const editing = ref(null);
const loading = ref(false);

// The primary store is the first one created (oldest, returned first by API) — it cannot be deleted
const primaryStoreId = computed(() => stores.value.length ? stores.value[0].id : null)

async function load() {
  loading.value = true;
  try {
    const { data } = await api.get('/stores');
    stores.value = data || [];
  } catch (e) {
    console.error('Failed to load stores', e);
  } finally { loading.value = false; }
}

function edit(s) {
  editing.value = s.id;
  form.value = { name: s.name || '', cnpj: s.cnpj || '', timezone: s.timezone || '', address: s.address || '', logoUrl: s.logoUrl || '' };
}

function clearForm() {
  editing.value = null;
  form.value = { name: '', cnpj: '', timezone: '', address: '', logoUrl: '' };
}

async function save() {
  try {
    if (editing.value) {
      await api.put(`/stores/${editing.value}`, form.value);
    } else {
      await api.post('/stores', form.value);
    }
    await load();
    clearForm();
  } catch (e) {
    console.error('Failed to save store', e);
    alert('Erro ao salvar loja: ' + (e?.response?.data?.message || e.message));
  }
}

async function remove(id) {
  if (!confirm('Remover esta loja?')) return;
  try {
    await api.delete(`/stores/${id}`);
    await load();
  } catch (e) { console.error('Failed to delete store', e); alert('Erro ao remover'); }
}

onMounted(load);
</script>

<template>
  <div class="container py-3">
    <h3>Loja / Multi-store</h3>
    <div class="row">
        <div class="col-12 mb-3 d-flex justify-content-between align-items-center">
          <div>
            <button class="btn btn-primary me-2" @click="$router.push('/settings/stores/new')">Nova Loja</button>
            <button class="btn btn-outline-secondary" @click="load">Recarregar</button>
          </div>
        </div>

        <div class="col-12">
          <div class="card">
            <div class="card-header">Lojas existentes</div>
            <div class="card-body">
              <table class="table table-sm">
                <thead>
                  <tr><th>Nome</th><th>CNPJ</th><th>Timezone</th><th></th></tr>
                </thead>
                <tbody>
                  <tr v-for="s in stores" :key="s.id">
                    <td>{{ s.name }}</td>
                    <td>{{ s.cnpj || '-' }}</td>
                    <td>{{ s.timezone || '-' }}</td>
                    <td class="text-end">
                      <button class="btn btn-sm btn-outline-primary me-1" @click="$router.push(`/settings/stores/${s.id}`)">Editar</button>
                      <button class="btn btn-sm btn-outline-danger" @click="remove(s.id)" :disabled="s.id === primaryStoreId" :title="s.id === primaryStoreId ? 'A loja principal não pode ser removida' : ''">Remover</button>
                    </td>
                  </tr>
                  <tr v-if="stores.length === 0"><td colspan="4" class="text-muted">Nenhuma loja cadastrada</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
  </div>
</template>

<style scoped>
.card { box-shadow: 0 0 0 0 rgba(0,0,0,0); }
</style>
