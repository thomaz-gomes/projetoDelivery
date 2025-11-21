<script setup>
import { ref, onMounted } from 'vue';
import api from '../api';
import PrinterConfig from '../components/PrinterConfig.vue';
import printService from '../services/printService.js';

const stores = ref([]);
const loading = ref(false);
const message = ref('');
const showPrinterConfig = ref(false);

// Editing helpers
const editingId = ref(null);
const editForm = ref({ name: '', cnpj: '', timezone: '', isActive: true });

function startEdit(s) {
  editingId.value = s.id;
  editForm.value = { name: s.name || '', cnpj: s.cnpj || '', timezone: s.timezone || '', isActive: s.isActive ?? true };
}

function cancelEdit() {
  editingId.value = null;
}

async function saveEdit() {
  try {
    const id = editingId.value;
    if (!id) return;
    await api.put(`/stores/${id}`, { name: editForm.value.name, cnpj: editForm.value.cnpj, timezone: editForm.value.timezone, isActive: editForm.value.isActive });
    message.value = 'Loja atualizada.';
    editingId.value = null;
    await loadStores();
  } catch (e) {
    console.error('saveEdit failed', e);
    message.value = e?.response?.data?.message || e?.message || 'Erro ao salvar loja';
  }
}

async function deleteStore(id) {
  try {
    const ok = confirm('Confirmar exclusão da loja? Esta ação não pode ser desfeita.');
    if (!ok) return;
    await api.delete(`/stores/${id}`);
    message.value = 'Loja excluída.';
    await loadStores();
  } catch (e) {
    console.error('deleteStore failed', e);
    message.value = e?.response?.data?.message || e?.message || 'Erro ao excluir loja';
  }
}

async function toggleActive(s) {
  try {
    const updated = !s.isActive;
    await api.put(`/stores/${s.id}`, { isActive: updated });
    message.value = `Loja ${updated ? 'aberta' : 'fechada'}.`;
    await loadStores();
  } catch (e) {
    console.error('toggleActive failed', e);
    message.value = e?.response?.data?.message || e?.message || 'Erro ao alternar status';
  }
}

async function loadStores() {
  loading.value = true;
  try {
    const { data } = await api.get('/stores');
    stores.value = data || [];
  } catch (e) {
    console.error('Failed to load stores', e);
    message.value = e?.response?.data?.message || e?.message || 'Erro ao carregar lojas';
  } finally {
    loading.value = false;
  }
}

async function createTestStore() {
  try {
    const payload = { name: 'Loja Teste', cnpj: '33662260000199', timezone: 'America/Sao_Paulo' };
    const { data } = await api.post('/stores', payload);
    message.value = `Loja criada: ${data.id}`;
    await loadStores();
  } catch (e) {
    console.error('createTestStore failed', e);
    message.value = e?.response?.data?.message || e?.message || 'Erro ao criar loja';
  }
}

async function createTestIntegration(storeId) {
  try {
    const payload = { provider: 'IFOOD', merchantId: '3366226', clientId: '', clientSecret: '', enabled: true, storeId };
    const { data } = await api.post('/integrations', payload);
    message.value = `Integração criada: ${data.id}`;
  } catch (e) {
    console.error('createTestIntegration failed', e);
    message.value = e?.response?.data?.message || e?.message || 'Erro ao criar integração';
  }
}

async function generateTestOrder() {
  try {
    const { data } = await api.get('/webhooks/generate-test');
    message.value = `Pedido de teste criado: ${data?.order?.id || data?.order?.externalId || 'ok'}`;
  } catch (e) {
    console.error('generateTestOrder failed', e);
    message.value = e?.response?.data?.message || e?.message || 'Erro ao gerar pedido de teste';
  }
}

async function runIFoodPoll() {
  try {
    const { data } = await api.post('/integrations/ifood/poll');
    message.value = `Poll executado. Eventos: ${data?.count ?? 0}`;
  } catch (e) {
    console.error('runIFoodPoll failed', e);
    message.value = e?.response?.data?.message || e?.message || 'Erro ao executar poll';
  }
}

async function testPrint() {
  // create a tiny sample payload similar to an order
  const sample = { id: 'TEST-PRINT-' + Date.now(), items: [{ name: 'Item Teste', quantity: 1, price: 10 }], total: 10, customerName: 'Cliente Teste' };
  try {
    await printService.enqueuePrint(sample);
    message.value = 'Comando de impressão enfileirado (mock)';
  } catch (e) {
    console.error('testPrint failed', e);
    message.value = e?.message || 'Erro ao enfileirar impressão';
  }
}

onMounted(loadStores);
</script>

<template>
  <div class="container py-3">
    <h3>Ferramentas de Teste (Dev)</h3>
    <div class="mb-3">
      <button class="btn btn-outline-primary me-2" @click="loadStores">Recarregar Lojas</button>
      <button class="btn btn-primary me-2" @click="createTestStore">Criar Loja de Teste</button>
      <button class="btn btn-secondary me-2" @click="generateTestOrder">Gerar Pedido de Teste (webhook)</button>
      <button class="btn btn-outline-info me-2" @click="runIFoodPoll">Executar Poll iFood</button>
      <button class="btn btn-outline-success me-2" @click="showPrinterConfig = true">Abrir Configuração de Impressora</button>
      <button class="btn btn-outline-dark" @click="testPrint">Teste de Impressão (enfileirar)</button>
    </div>

    <div v-if="message" class="alert alert-info">{{ message }}</div>

    <div class="card">
      <div class="card-header">Lojas</div>
      <div class="card-body">
        <div v-if="loading">Carregando...</div>
        <div v-else>
          <table class="table table-sm">
            <thead>
              <tr><th>Nome</th><th>CNPJ</th><th>Actions</th></tr>
            </thead>
            <tbody>
              <tr v-for="s in stores" :key="s.id">
                <td>
                  <div v-if="editingId === s.id">
                    <input class="form-control form-control-sm mb-1" v-model="editForm.name" />
                    <input class="form-control form-control-sm" v-model="editForm.timezone" placeholder="timezone" />
                  </div>
                  <div v-else>{{ s.name }}</div>
                </td>
                <td>
                  <div v-if="editingId === s.id">
                    <input class="form-control form-control-sm" v-model="editForm.cnpj" />
                  </div>
                  <div v-else>{{ s.cnpj || '-' }}</div>
                </td>
                <td>
                  <div v-if="editingId === s.id" class="btn-group">
                    <button class="btn btn-sm btn-success" @click="saveEdit">Salvar</button>
                    <button class="btn btn-sm btn-secondary" @click="cancelEdit">Cancelar</button>
                  </div>
                  <div v-else class="btn-group">
                    <button class="btn btn-sm btn-outline-primary me-2" @click="createTestIntegration(s.id)">Criar Integração iFood</button>
                    <button class="btn btn-sm btn-outline-warning me-2" @click="startEdit(s)">{{ s.isActive ? 'Fechar' : 'Abrir' }}</button>
                    <button class="btn btn-sm btn-outline-secondary me-2" @click="toggleActive(s)">{{ s.isActive ? 'Fechar Loja' : 'Abrir Loja' }}</button>
                    <button class="btn btn-sm btn-danger" @click="deleteStore(s.id)">Excluir</button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
          <div v-if="stores.length === 0" class="text-muted">Nenhuma loja encontrada.</div>
        </div>
      </div>
    </div>

    <PrinterConfig v-if="showPrinterConfig" @close="showPrinterConfig = false" />
  </div>
</template>
