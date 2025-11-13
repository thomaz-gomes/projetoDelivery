<script setup>
import { ref, onMounted, computed, onUnmounted } from 'vue';
import api from '../api';

const form = ref({ clientId: '', clientSecret: '', merchantId: '' });
const integ = ref(null);
const statusMsg = ref('');
// computed status for visual feedback
// more defensive token detection: some responses may contain accessToken, access_token or hasTokens
const hasTokens = computed(() => {
  if (!integ.value) return false;
  // explicit boolean field from some endpoints
  if (typeof integ.value.hasTokens !== 'undefined') return Boolean(integ.value.hasTokens);
  // try common token fields
  const t = integ.value.accessToken ?? integ.value.access_token ?? null;
  if (t && String(t).trim().length > 0) return true;
  // fallback: tokenExpiresAt indicates presence
  if (integ.value.tokenExpiresAt) return true;
  return false;
});

const integrationActive = computed(() => Boolean(integ.value && integ.value.enabled && hasTokens.value));
const integrationStateLabel = computed(() => {
  if (!integ.value) return 'Não configurado';
  if (integ.value.enabled && hasTokens.value) return 'Ativo';
  if (integ.value.enabled && !hasTokens.value) return 'Sem tokens';
  return 'Inativo';
});
const link = ref({ linkCode: '', partnerUrl: '', codeVerifier: '' });
const copyStatus = ref('');
const portalCopyStatus = ref('');

const portalUrl = computed(() => {
  if (!link.value.linkCode) return '';
  return `https://portal.ifood.com.br/apps/code?c=${encodeURIComponent(link.value.linkCode)}`;
});

let refreshTimer = null;

function clearRefreshTimer() {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
}

function scheduleRefreshFromInteg() {
  clearRefreshTimer();
  try {
    if (!integ.value || !integ.value.tokenExpiresAt) return;
    const expires = new Date(integ.value.tokenExpiresAt).getTime();
    if (isNaN(expires)) return;
    // schedule refresh 60 seconds before expiry (minimum 10s)
    const now = Date.now();
    let delay = expires - now - 60 * 1000;
    if (delay < 10000) delay = 10000; // at least 10s
    refreshTimer = setTimeout(async () => {
      try {
        await refreshToken();
        // reload integration and reschedule
        await load();
      } catch (e) {
        console.error('Scheduled refresh failed', e);
      }
    }, delay);
  } catch (e) {
    console.error('scheduleRefreshFromInteg error', e);
  }
}

async function copyLinkCode() {
  if (!link.value.linkCode) return;
  try {
    await navigator.clipboard.writeText(link.value.linkCode);
    copyStatus.value = 'Código copiado!';
    setTimeout(() => (copyStatus.value = ''), 2500);
  } catch (e) {
    // fallback: create temporary input
    try {
      const tmp = document.createElement('input');
      tmp.value = link.value.linkCode;
      document.body.appendChild(tmp);
      tmp.select();
      document.execCommand('copy');
      tmp.remove();
      copyStatus.value = 'Código copiado!';
      setTimeout(() => (copyStatus.value = ''), 2500);
    } catch (err) {
      console.error('Copy failed', err);
      copyStatus.value = 'Falha ao copiar';
      setTimeout(() => (copyStatus.value = ''), 2500);
    }
  }
}
async function copyPortalUrl() {
  if (!portalUrl.value) return;
  try {
    await navigator.clipboard.writeText(portalUrl.value);
    portalCopyStatus.value = 'URL copiada!';
    setTimeout(() => (portalCopyStatus.value = ''), 2500);
  } catch (e) {
    try {
      const tmp = document.createElement('input');
      tmp.value = portalUrl.value;
      document.body.appendChild(tmp);
      tmp.select();
      document.execCommand('copy');
      tmp.remove();
      portalCopyStatus.value = 'URL copiada!';
      setTimeout(() => (portalCopyStatus.value = ''), 2500);
    } catch (err) {
      console.error('Copy portal URL failed', err);
      portalCopyStatus.value = 'Falha ao copiar URL';
      setTimeout(() => (portalCopyStatus.value = ''), 2500);
    }
  }
}
const authCode = ref('');

async function load() {
  const { data } = await api.get('/integrations/ifood');
  integ.value = data || null;
  if (integ.value) {
    form.value.clientId = integ.value.clientId || '';
    form.value.clientSecret = integ.value.clientSecret || '';
    form.value.merchantId = integ.value.merchantId || '';
    // schedule token refresh when integration info loaded
    scheduleRefreshFromInteg();
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

const linking = ref(false);
const confirming = ref(false);
async function startLink() {
  if (linking.value) return;
  linking.value = true;
  statusMsg.value = '';
  try {
    const { data } = await api.post('/integrations/ifood/link/start');
    // API returns { userCode | linkCode, codeVerifier, verificationUrlComplete | partnerUrl }
    link.value.linkCode = data.linkCode || data.userCode || '';
    link.value.partnerUrl = data.partnerUrl || data.verificationUrlComplete || '';
    link.value.codeVerifier = data.codeVerifier || '';
    statusMsg.value = 'Código de vínculo gerado.';
  } catch (e) {
    console.error('startLink failed', e);
    const msg = e?.response?.data?.message || e?.message || 'Falha ao gerar código de vínculo';
    statusMsg.value = msg;
  } finally {
    linking.value = false;
  }
}

async function confirmLink() {
  if (confirming.value) return;
  confirming.value = true;
  statusMsg.value = '';
  try {
    const { data } = await api.post('/integrations/ifood/link/confirm', { authorizationCode: authCode.value });
    statusMsg.value = data?.message || 'Vínculo confirmado. Tokens armazenados.';
    await load();
  } catch (e) {
    console.error('confirmLink failed', e);
    const msg = e?.response?.data?.message || e?.response?.data?.error || e?.message || 'Falha ao confirmar vínculo';
    statusMsg.value = msg;
  } finally {
    confirming.value = false;
  }
}

async function refreshToken() {
  await api.post('/integrations/ifood/token/refresh');
  statusMsg.value = 'Token renovado.';
  await load();
}

onUnmounted(() => {
  clearRefreshTimer();
});

async function testPoll() {
  const { data } = await api.post('/integrations/ifood/poll');
  alert(`Poll OK. Eventos: ${data.count}`);
}

onMounted(load);
</script>

<template>
  <div class="container py-3">
    <h3 class="d-flex align-items-center">Integração iFood (Autorização pelo lojista)
      <span v-if="integrationStateLabel" :class="['badge', integrationActive ? 'bg-success ms-3' : (integ && integ.enabled ? 'bg-warning text-dark ms-3' : 'bg-secondary ms-3') ]">{{ integrationStateLabel }}</span>
    </h3>

    <div v-if="statusMsg" class="alert alert-info my-2">{{ statusMsg }}</div>

    <div class="card mb-3">
      <div class="card-header">Credenciais (por empresa)</div>
      <div class="card-body row g-3">
        <div class="col-md-4">
          <label class="form-label">Client ID</label>
          <input class="form-control" v-model="form.clientId" :readonly="integrationActive" />
        </div>
        <div class="col-md-4">
          <label class="form-label">Client Secret</label>
          <input class="form-control" v-model="form.clientSecret" :readonly="integrationActive" />
        </div>
        <div class="col-md-4">
          <label class="form-label">Merchant ID (opcional)</label>
          <input class="form-control" v-model="form.merchantId" :readonly="integrationActive" />
        </div>
        <div class="col-12">
          <button class="btn btn-primary" @click="save" :disabled="integrationActive">Salvar</button>
        </div>
      </div>
    </div>

    <div v-if="!integrationActive" class="card mb-3">
      <div class="card-header">Vincular loja (Passo a passo)</div>
      <div class="card-body">
        <ol>
          <li>Clique em <b>Gerar código de vínculo</b>.</li>
          <li>Peça ao lojista para acessar o <b>Portal do Parceiro</b> e inserir o código.</li>
          <li>Após aprovar, o portal exibirá um <b>código de autorização</b>.</li>
          <li>Informe o código abaixo e confirme.</li>
        </ol>

        <div class="mb-3">
          <button class="btn btn-outline-primary" @click="startLink" :disabled="linking || linking === undefined">
            <span v-if="linking" class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
            Gerar código de vínculo
          </button>
        </div>

        <div v-if="link.linkCode" class="alert alert-secondary d-flex flex-column gap-2">
          <div class="d-flex align-items-center justify-content-between">
            <div>
              <div class="small text-muted">Código de vínculo</div>
              <div class="h4 mb-0"><code class="p-2 bg-white rounded">{{ link.linkCode }}</code></div>
            </div>
            <div class="text-end">
              <button class="btn btn-outline-secondary btn-sm me-2" @click="copyLinkCode">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="currentColor" class="me-1" aria-hidden="true">
                  <path d="M10 1.5H6a.5.5 0 0 0-.5.5V3H4.5A1.5 1.5 0 0 0 3 4.5v8A1.5 1.5 0 0 0 4.5 14h7A1.5 1.5 0 0 0 13 12.5v-8A1.5 1.5 0 0 0 11.5 3H10V2a.5.5 0 0 0-.5-.5zM6 2h4v1H6V2z"/>
                </svg>
                Copiar
              </button>
              <button class="btn btn-outline-secondary btn-sm me-2" @click="copyPortalUrl">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="currentColor" class="me-1" aria-hidden="true">
                  <path d="M10 1.5H6a.5.5 0 0 0-.5.5V3H4.5A1.5 1.5 0 0 0 3 4.5v8A1.5 1.5 0 0 0 4.5 14h7A1.5 1.5 0 0 0 13 12.5v-8A1.5 1.5 0 0 0 11.5 3H10V2a.5.5 0 0 0-.5-.5zM6 2h4v1H6V2z"/>
                </svg>
                Copiar URL
              </button>
              <a :href="portalUrl" target="_blank" class="btn btn-primary btn-sm">Abrir Portal iFood</a>
            </div>
          </div>

          <div class="small text-muted">Portal público (insira o código no Portal do Parceiro):</div>
          <div><a :href="portalUrl" target="_blank">{{ portalUrl }}</a></div>

          <div v-if="link.partnerUrl"><small><b>Partner URL:</b> <a :href="link.partnerUrl" target="_blank">{{ link.partnerUrl }}</a></small></div>
          <div v-if="link.codeVerifier"><small><b>Code verifier:</b> <code>{{ link.codeVerifier }}</code></small></div>

          <div class="d-flex gap-3">
            <div v-if="copyStatus" class="text-success small">{{ copyStatus }}</div>
            <div v-if="portalCopyStatus" class="text-success small">{{ portalCopyStatus }}</div>
          </div>
        </div>

  <div class="row g-2 align-items-end">
          <div class="col-md-6">
            <label class="form-label">Código de autorização (do lojista)</label>
            <input class="form-control" v-model="authCode" placeholder="Cole o código aqui" />
          </div>
          <div class="col-md-3">
            <button class="btn btn-success" @click="confirmLink" :disabled="confirming || !authCode">
              <span v-if="confirming" class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
              Confirmar vínculo
            </button>
          </div>
        </div>
      </div>
    </div>
    <!-- when integration active, show a small note instead of the linking UI -->
    <div v-else class="alert alert-success mb-3">
      Integração ativa. A vinculação foi concluída e a caixa de vincular loja foi ocultada.
    </div>

    <div v-if="integ" class="card">
      <div class="card-header">Status atual</div>
      <div class="card-body">
        <p><b>Ativo:</b> {{ integ.enabled ? 'Sim' : 'Não' }}</p>
        <p><b>Token expira em:</b> {{ integ.tokenExpiresAt || '-' }}</p>
        <p><b>Tem token:</b> {{ integ.accessToken ? 'Sim' : 'Não' }}</p>
        <p v-if="integ.accessToken"><b>Token (preview):</b> {{ integ.accessToken.slice(0,6) }}··· ({{ integ.accessToken.length }} chars)</p>
        <p v-else class="text-muted small">Nenhum accessToken presente no objeto retornado pelo servidor.</p>
        <div class="small text-muted mt-2">Raw (masked) integração para debug:</div>
        <pre class="bg-light p-2" style="max-height:160px;overflow:auto">{{
          JSON.stringify({
            id: integ.id,
            provider: integ.provider,
            enabled: integ.enabled,
            clientId: !!integ.clientId,
            merchantId: integ.merchantId || null,
            hasAccessToken: !!integ.accessToken,
            tokenExpiresAt: integ.tokenExpiresAt || null
          }, null, 2)
        }}</pre>
        <div class="btn-group">
          <button class="btn btn-outline-secondary" @click="refreshToken">Renovar token</button>
          <button class="btn btn-outline-primary" @click="testPoll">Executar Poll (teste)</button>
        </div>
      </div>
    </div>
  </div>
</template>
