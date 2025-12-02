<script setup>
import { ref, onMounted } from 'vue';
import { useAuthStore } from '../stores/auth';
import api from '../api';
import { formatCurrency } from '../utils/formatters.js';

const list = ref([]);
const loading = ref(false);

const form = ref({ id: null, name: '', aliases: '', deliveryFee: '0,00', riderFee: '0,00' });
const saving = ref(false);
const error = ref('');
const testText = ref('');
const testing = ref(false);
const matchResult = ref(null);
const auth = useAuthStore();

async function fetchList() {
  loading.value = true;
  try {
    const { data } = await api.get('/neighborhoods');
    list.value = data;
  } catch (e) {
    console.error(e);
    error.value = 'Falha ao carregar bairros';
  } finally {
    loading.value = false;
  }
}

function edit(n) {
  form.value = { id: n.id, name: n.name, aliases: Array.isArray(n.aliases) ? n.aliases.join(', ') : (n.aliases || '').toString(), deliveryFee: (n.deliveryFee || 0).toString(), riderFee: (n.riderFee || 0).toString() };
}

function resetForm() {
  form.value = { id: null, name: '', aliases: '', deliveryFee: '0,00', riderFee: '0,00' };
}

async function save() {
  saving.value = true;
  error.value = '';
  try {
    const payload = {
      name: form.value.name,
      aliases: form.value.aliases ? form.value.aliases.split(',').map(s => s.trim()).filter(Boolean) : [],
      deliveryFee: parseFloat(form.value.deliveryFee || 0),
      riderFee: parseFloat(form.value.riderFee || 0),
    };

    if (form.value.id) {
      await api.patch(`/neighborhoods/${form.value.id}`, payload);
    } else {
      await api.post('/neighborhoods', payload);
    }

    await fetchList();
    resetForm();
  } catch (e) {
    console.error(e);
    error.value = e?.response?.data?.message || 'Erro ao salvar bairro';
  } finally {
    saving.value = false;
  }
}

onMounted(fetchList);

async function testMatch() {
  if (!testText.value) return (matchResult.value = null);
  testing.value = true;
  matchResult.value = null;
  try {
    const { data } = await api.post('/neighborhoods/match', { text: testText.value });
    matchResult.value = data?.match ?? null;
  } catch (e) {
    console.error('Match test failed', e);
    matchResult.value = null;
  } finally {
    testing.value = false;
  }
}
</script>

<template>
  <div class="p-4">
    <div class="d-flex align-items-center justify-content-between mb-3">
      <h2 class="h4 m-0">Bairros</h2>
    </div>

    <div class="card mb-3">
      <div class="card-body">
        <form @submit.prevent="save" class="row g-2">
          <div class="col-md-4">
            <input v-model="form.name" class="form-control" placeholder="Nome do bairro" required />
          </div>
          <div class="col-md-4">
            <input v-model="form.aliases" class="form-control" placeholder="Apelidos (vírgula separado)" />
          </div>
          <div class="col-md-2">
            <CurrencyInput v-model="form.deliveryFee" inputClass="form-control" placeholder="Taxa entrega" />
          </div>
          <div class="col-md-2">
            <CurrencyInput v-model="form.riderFee" inputClass="form-control" placeholder="Taxa motoboy" />
          </div>
          <div class="col-12 mt-2">
            <div class="d-flex gap-2">
              <button class="btn btn-primary" :disabled="saving">Salvar</button>
              <button type="button" class="btn btn-outline-secondary" @click="resetForm">Limpar</button>
            </div>
            <div v-if="error" class="text-danger small mt-2">{{ error }}</div>
          </div>
        </form>
      </div>
    </div>

    <!-- Admin: quick test for neighborhood matching -->
    <div v-if="auth.user?.role === 'ADMIN'" class="card mb-3">
      <div class="card-body">
        <h6>Testar detecção de bairro</h6>
        <div class="mb-2 small text-muted">Cole um texto de endereço (pedido ou payload) e verifique qual bairro é encontrado pelo sistema.</div>
        <div class="mb-2">
          <textarea v-model="testText" class="form-control" rows="3" placeholder="Ex: Rua das Flores, Centro, São Paulo"></textarea>
        </div>
        <div class="d-flex gap-2">
          <button class="btn btn-primary btn-sm" @click="testMatch" :disabled="testing">{{ testing ? 'Testando...' : 'Testar' }}</button>
          <button type="button" class="btn btn-outline-secondary btn-sm" @click="() => { testText = ''; matchResult = null }">Limpar</button>
        </div>
        <div class="mt-2">
          <div v-if="matchResult !== null">Resultado: <strong>{{ matchResult || 'Nenhum match' }}</strong></div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="table-responsive">
        <table class="table table-hover table-bordered align-middle mb-0">
          <thead class="table-light">
            <tr>
              <th>Nome</th>
              <th>Apelidos</th>
              <th>Taxa entrega</th>
              <th>Taxa motoboy</th>
              <th style="width:1%">Ações</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="n in list" :key="n.id">
              <td>{{ n.name }}</td>
              <td>{{ Array.isArray(n.aliases) ? n.aliases.join(', ') : (n.aliases || '') }}</td>
              <td>{{ formatCurrency(n.deliveryFee) }}</td>
              <td>{{ formatCurrency(n.riderFee) }}</td>
              <td><button class="btn btn-sm btn-outline-secondary" @click="edit(n)">Editar</button></td>
            </tr>
            <tr v-if="list.length === 0">
              <td colspan="5" class="text-center text-muted py-4">Nenhum bairro cadastrado.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

