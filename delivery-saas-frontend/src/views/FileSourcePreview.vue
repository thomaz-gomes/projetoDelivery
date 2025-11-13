<script setup>
import { ref } from 'vue';
import api from '../api';
import { bindLoading } from '../state/globalLoading.js';

const file = ref(null);
const pasted = ref('');
const normalized = ref(null);
const loading = ref(false);
bindLoading(loading);
const error = ref('');

function onFileChange(e) {
  const f = e.target.files[0];
  file.value = f || null;
}

async function send() {
  error.value = '';
  normalized.value = null;
  loading.value = true;
  try {
    let content = pasted.value;
    let filename = 'pasted.saiposprt';
    if (file.value) {
      filename = file.value.name;
      content = await file.value.text();
    }
    const { data } = await api.post('/file-sources/preview', { content, filename });
    normalized.value = data.normalized;
  } catch (e) {
    error.value = e?.response?.data?.error || e?.response?.data?.message || e?.message || 'Falha';
  } finally {
    loading.value = false;
  }
}

function copyNormalized() {
  if (!normalized.value) return;
  const txt = JSON.stringify(normalized.value, null, 2);
  navigator.clipboard.writeText(txt);
}
</script>

<template>
  <div class="container py-3">
    <h3>Preview de arquivo (.saiposprt)</h3>
    <p class="text-muted">Cole o conteúdo do arquivo ou selecione o arquivo para testar a normalização.</p>

    <div class="card mb-3">
      <div class="card-body">
        <label class="form-label">Selecionar arquivo</label>
        <input type="file" class="form-control" accept=".saiposprt,.txt,.json" @change="onFileChange" />
        <div class="my-2 text-muted">ou cole abaixo:</div>
        <textarea class="form-control" v-model="pasted" rows="6" placeholder="Cole aqui o conteúdo do arquivo"></textarea>
        <div class="mt-3">
          <button class="btn btn-primary" :disabled="loading" @click="send">{{ loading ? 'Processando...' : 'Enviar e Normalizar' }}</button>
        </div>
        <div v-if="error" class="alert alert-danger mt-3">{{ error }}</div>
      </div>
    </div>

    <div v-if="normalized" class="card">
      <div class="card-body">
        <div class="d-flex justify-content-between align-items-center">
          <h5>Resultado normalizado</h5>
          <div>
            <button class="btn btn-sm btn-outline-secondary me-2" @click="copyNormalized">Copiar JSON</button>
          </div>
        </div>
        <pre style="max-height: 60vh; overflow: auto; background: #f8f9fa; padding: 12px; border-radius: 6px">{{ JSON.stringify(normalized, null, 2) }}</pre>
      </div>
    </div>
  </div>
</template>

<style scoped>
pre { font-size: 0.9rem; }
</style>
