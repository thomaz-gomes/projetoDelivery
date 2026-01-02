<script setup>
import { ref, onMounted } from 'vue';
import { formatCurrency } from '../utils/formatters.js';
import { bindLoading } from '../state/globalLoading.js';
import api from '../api';

const riders = ref([]);
const loading = ref(false);
bindLoading(loading);
const error = ref('');
const success = ref('');

const form = ref({ riderId: '', amount: '', type: 'CREDIT', note: '' });
const submitting = ref(false);
const selectedBalance = ref(null);

async function fetchRiders() {
  loading.value = true;
  try {
    const { data } = await api.get('/riders');
    riders.value = Array.isArray(data) ? data : [];
  } catch (e) {
    console.error('Failed to load riders', e);
    error.value = 'Falha ao carregar entregadores';
  } finally {
    loading.value = false;
  }
}

async function fetchBalance(riderId) {
  if (!riderId) return (selectedBalance.value = null);
  try {
    const { data } = await api.get(`/riders/${riderId}/account`);
    selectedBalance.value = Number(data.balance || 0);
  } catch (e) {
    console.error('Failed to fetch balance', e);
    selectedBalance.value = null;
  }
}

async function submitAdjustment() {
  error.value = '';
  success.value = '';
  if (!form.value.riderId) return (error.value = 'Selecione um entregador');
  if (!form.value.amount || Number(form.value.amount) === 0) return (error.value = 'Informe um valor válido');

  submitting.value = true;
  try {
    const payload = { amount: form.value.amount, type: form.value.type, note: form.value.note };
    const { data } = await api.post(`/riders/${form.value.riderId}/account/adjust`, payload);
    success.value = 'Ajuste aplicado com sucesso';
    // refresh balance
    await fetchBalance(form.value.riderId);
    // clear form
    form.value.amount = '';
    form.value.note = '';
    setTimeout(() => (success.value = ''), 4000);
  } catch (e) {
    console.error('Adjust failed', e);
    error.value = e?.response?.data?.message || 'Falha ao aplicar ajuste';
  } finally {
    submitting.value = false;
  }
}

onMounted(async () => {
  await fetchRiders();
});
</script>

<template>
  <div class="p-4">
    <div class="d-flex justify-content-between align-items-center mb-3">
      <h2 class="h4 m-0">Créditos / Débitos - Entregadores</h2>
    </div>

    <div v-if="error" class="alert alert-danger">{{ error }}</div>
    <div v-if="success" class="alert alert-success">{{ success }}</div>

    <div class="card mb-3">
      <div class="card-body">
        <div class="row g-2 align-items-end">
          <div class="col-md-4">
            <label class="form-label small">Entregador</label>
            <SelectInput  class="form-select"  v-model="form.riderId"  @change="fetchBalance(form.riderId)">
              <option value="">Selecione</option>
              <option v-for="r in riders" :key="r.id" :value="r.id">{{ r.name }} {{ r.whatsapp ? (' - ' + r.whatsapp) : '' }}</option>
            </SelectInput>
          </div>
          <div class="col-md-2">
            <label class="form-label small">Saldo atual</label>
            <div class="form-control-plaintext">{{ selectedBalance !== null ? formatCurrency(selectedBalance) : '—' }}</div>
          </div>
          <div class="col-md-2">
            <CurrencyInput label="Valor" labelClass="form-label small" v-model="form.amount" inputClass="form-control" placeholder="0,00" />
          </div>
          <div class="col-md-2">
            <label class="form-label small">Tipo</label>
            <SelectInput  class="form-select"  v-model="form.type" >
              <option value="CREDIT">Crédito</option>
              <option value="DEBIT">Débito</option>
            </SelectInput>
          </div>
          <div class="col-md-2 d-grid">
            <button class="btn btn-success" :disabled="submitting" @click="submitAdjustment">{{ submitting ? 'Enviando...' : 'Aplicar' }}</button>
          </div>
        </div>

        <div class="row mt-3">
          <div class="col-12">
            <label class="form-label small">Observação</label>
            <TextInput v-model="form.note" placeholder="Motivo do ajuste (opcional)" inputClass="form-control" />
          </div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-body">
        <h5>Entregadores</h5>
        <div v-if="loading">Carregando...</div>
        <div v-else>
          <div class="table-responsive">
            <table class="table table-sm mb-0">
              <thead class="table-light">
                <tr>
                  <th>Nome</th>
                  <th>WhatsApp</th>
                  <th style="width:160px">Saldo</th>
                  <th style="width:150px">Ações</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="r in riders" :key="r.id">
                  <td>{{ r.name }}</td>
                  <td>{{ r.whatsapp || '—' }}</td>
                  <td>
                    <small class="text-muted">Veja saldo</small>
                  </td>
                  <td>
                    <div class="d-flex gap-2">
                      <router-link :to="`/riders/${r.id}/account`" class="btn btn-sm btn-outline-primary">Ver conta</router-link>
                      <button class="btn btn-sm btn-primary" @click="form.riderId = r.id; fetchBalance(r.id)">Ajustar</button>
                    </div>
                  </td>
                </tr>
                <tr v-if="riders.length === 0">
                  <td colspan="4" class="text-center text-muted py-4">Nenhum entregador cadastrado.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
