<script setup>
import { ref, onMounted } from 'vue';
import api from '../api';

const form = ref({ clientId: '', clientSecret: '', merchantId: '' });
const integ = ref(null);
const statusMsg = ref('');
const link = ref({ linkCode: '', partnerUrl: '', codeVerifier: '' });
const authCode = ref('');

async function load() {
  const { data } = await api.get('/integrations/ifood');
  integ.value = data || null;
  if (integ.value) {
    form.value.clientId = integ.value.clientId || '';
    form.value.clientSecret = integ.value.clientSecret || '';
    form.value.merchantId = integ.value.merchantId || '';
  }
}

async function save() {
  await api.post('/integrations/IFOOD', {
    clientId: form.value.clientId,
    clientSecret: form.value.clientSecret,
    merchantId: form.value.merchantId,
    enabled: true,
  });
  await load();
  statusMsg.value = 'Credenciais salvas.';
}

async function startLink() {
  const { data } = await api.post('/integrations/ifood/link/start');
  link.value.linkCode = data.linkCode;
  link.value.partnerUrl = data.partnerUrl;
  link.value.codeVerifier = data.codeVerifier;
  statusMsg.value = 'Código de vínculo gerado.';
}

async function confirmLink() {
  await api.post('/integrations/ifood/link/confirm', { authorizationCode: authCode.value });
  statusMsg.value = 'Vínculo confirmado. Tokens armazenados.';
  await load();
}

async function refreshToken() {
  await api.post('/integrations/ifood/token/refresh');
  statusMsg.value = 'Token renovado.';
  await load();
}

async function testPoll() {
  const { data } = await api.post('/integrations/ifood/poll');
  alert(`Poll OK. Eventos: ${data.count}`);
}

onMounted(load);
</script>

<template>
  <div class="container py-3">
    <h3>Integração iFood (Autorização pelo lojista)</h3>

    <div v-if="statusMsg" class="alert alert-info my-2">{{ statusMsg }}</div>

    <div class="card mb-3">
      <div class="card-header">Credenciais (por empresa)</div>
      <div class="card-body row g-3">
        <div class="col-md-4">
          <label class="form-label">Client ID</label>
          <input class="form-control" v-model="form.clientId" />
        </div>
        <div class="col-md-4">
          <label class="form-label">Client Secret</label>
          <input class="form-control" v-model="form.clientSecret" />
        </div>
        <div class="col-md-4">
          <label class="form-label">Merchant ID (opcional)</label>
          <input class="form-control" v-model="form.merchantId" />
        </div>
        <div class="col-12">
          <button class="btn btn-primary" @click="save">Salvar</button>
        </div>
      </div>
    </div>

    <div class="card mb-3">
      <div class="card-header">Vincular loja (Passo a passo)</div>
      <div class="card-body">
        <ol>
          <li>Clique em <b>Gerar código de vínculo</b>.</li>
          <li>Peça ao lojista para acessar o <b>Portal do Parceiro</b> e inserir o código.</li>
          <li>Após aprovar, o portal exibirá um <b>código de autorização</b>.</li>
          <li>Informe o código abaixo e confirme.</li>
        </ol>

        <div class="mb-3">
          <button class="btn btn-outline-primary" @click="startLink">Gerar código de vínculo</button>
        </div>

        <div v-if="link.linkCode" class="alert alert-secondary">
          <div><b>Código de vínculo:</b> <code>{{ link.linkCode }}</code></div>
          <div><b>Portal:</b> <a :href="link.partnerUrl" target="_blank">{{ link.partnerUrl }}</a></div>
        </div>

        <div class="row g-2 align-items-end">
          <div class="col-md-6">
            <label class="form-label">Código de autorização (do lojista)</label>
            <input class="form-control" v-model="authCode" placeholder="Cole o código aqui" />
          </div>
          <div class="col-md-3">
            <button class="btn btn-success" @click="confirmLink">Confirmar vínculo</button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="integ" class="card">
      <div class="card-header">Status atual</div>
      <div class="card-body">
        <p><b>Ativo:</b> {{ integ.enabled ? 'Sim' : 'Não' }}</p>
        <p><b>Token expira em:</b> {{ integ.tokenExpiresAt || '-' }}</p>
        <div class="btn-group">
          <button class="btn btn-outline-secondary" @click="refreshToken">Renovar token</button>
          <button class="btn btn-outline-primary" @click="testPoll">Executar Poll (teste)</button>
        </div>
      </div>
    </div>
  </div>
</template>
