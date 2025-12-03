<script setup>
import { ref, onMounted } from 'vue';
import api from '../api';

const path = ref('');
const status = ref('');

async function load() {
  try {
    const { data } = await api.get('/file-sources');
    path.value = data?.path || '';
  } catch (e) {
    status.value = 'Falha ao carregar configuração';
  }
}

async function save() {
  try {
    await api.post('/file-sources', { path: path.value });
    status.value = 'Caminho salvo. O serviço irá monitorar a pasta configurada.';
  } catch (e) {
    status.value = e?.response?.data?.message || 'Falha ao salvar';
  }
}

onMounted(load);
</script>

<template>
  <div class="container py-3">
    <h3>Fonte de pedidos por pasta local</h3>
    <p class="text-muted">Configure uma pasta no servidor (o backend deve estar rodando na mesma máquina) que será monitorada para arquivos <code>.saiposprt</code>.</p>
    <div v-if="status" class="alert alert-info">{{ status }}</div>

    <div class="card">
      <div class="card-body">
        <label class="form-label">Caminho completo da pasta</label>
        <TextInput v-model="path" placeholder="Ex: C:\\\\Users\\\\meuuser\\\\ifood_incoming" inputClass="form-control" />
        <div class="mt-3">
          <button class="btn btn-primary" @click="save">Salvar e iniciar monitoramento</button>
        </div>
      </div>
    </div>
  </div>
</template>
