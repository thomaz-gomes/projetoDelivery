<script setup>
import { ref, onMounted, computed, onUnmounted } from 'vue';
import Swal from 'sweetalert2';
import api from '../api';
import { ref as _ref } from 'vue';

const form = ref({ storeId: null, merchantId: '' });
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
const debugInfo = ref(null);
const isDevMode = (import.meta && import.meta.env && import.meta.env.MODE !== 'production');
const fullToken = ref(null);
const showingFullToken = ref(false);

async function loadDebug() {
  try {
    const { data } = await api.get('/integrations/ifood/debug');
    debugInfo.value = data;
  } catch (e) {
    console.error('loadDebug failed', e);
    debugInfo.value = { error: e?.response?.data || e?.message || String(e) };
  }
}

async function load() {
  const { data } = await api.get('/integrations/ifood');
  // API returns an array of integrations for the company.
  // Pick the most recently updated enabled integration if present, otherwise the most recently updated one.
  if (Array.isArray(data)) {
    const list = data || [];
    if (list.length === 0) {
      integ.value = null;
    } else {
      // prefer enabled & has tokens
      const enabledWithToken = list.find(i => i.enabled && (i.accessToken || i.tokenExpiresAt));
      if (enabledWithToken) {
        integ.value = enabledWithToken;
      } else {
        // sort by updatedAt desc and pick first
        list.sort((a,b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
        integ.value = list[0];
      }
    }
  } else {
    integ.value = data || null;
  }
    if (integ.value) {
      // server-side creds are not editable here; only bind storeId
      form.value.storeId = (integ.value.storeId && String(integ.value.storeId)) || null;
      form.value.merchantId = integ.value.merchantUuid || integ.value.merchantId || '';
    // schedule token refresh when integration info loaded
    scheduleRefreshFromInteg();
  }
}

async function loadFullToken() {
  try {
    if (!integ.value || !integ.value.id) return;
    const { data } = await api.get(`/integrations/by-id/${integ.value.id}`);
    fullToken.value = data?.accessToken || null;
    showingFullToken.value = true;
  } catch (e) {
    console.error('loadFullToken failed', e);
    fullToken.value = null;
    showingFullToken.value = false;
  }
}
function hideFullToken() {
  fullToken.value = null;
  showingFullToken.value = false;
}

async function save() {
  if (!form.value.storeId) {
    statusMsg.value = 'Selecione a loja para vincular a integração.';
    return;
  }
  // Credentials (clientId/clientSecret/merchantId) are provided via server environment
  // and must not be edited from the UI. We only persist binding to a store and enable the integration.
  // allow admin to provide merchantId/merchantUuid manually (from iFood panel)
  const isUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(String(form.value.merchantId || '').trim());
  const payload = {
    enabled: true,
    storeId: form.value.storeId,
  };
  if (form.value.merchantId && String(form.value.merchantId).trim().length > 0) {
    if (isUuid) payload.merchantUuid = String(form.value.merchantId).trim(); else payload.merchantId = String(form.value.merchantId).trim();
  }
  if (integ.value && integ.value.id) {
    console.log('[IFoodIntegration] PUT payload', payload);
    await api.put(`/integrations/${integ.value.id}`, payload);
  } else {
    console.log('[IFoodIntegration] POST payload', payload);
    await api.post('/integrations/IFOOD', payload);
  }
  await load();
  statusMsg.value = 'Credenciais salvas.';
}

// load available stores for this company so user can bind integration to a store
const stores = ref([]);
async function loadStores() {
  try {
    const { data } = await api.get('/stores');
    stores.value = data || [];
  } catch (e) { console.warn('Failed to load stores', e); }
}

// when the integration already has a storeId set on the server, lock the selector
// also lock when the integration is active (authorized) to prevent edits
const storeLocked = computed(() => {
  try { return Boolean(integ.value && (integ.value.storeId || (integ.value.enabled && hasTokens.value))); } catch(e){ return false }
});

const linking = ref(false);
const confirming = ref(false);
async function startLink() {
  if (linking.value) return;
  // Require a store selection before starting authorization
  if (!form.value.storeId) {
    statusMsg.value = 'Selecione a loja antes de iniciar a autorização.';
    return;
  }

  linking.value = true;
  statusMsg.value = '';
  try {
    // Ensure there's an integration row for this store. If not, create it.
    if (!integ.value || integ.value.storeId !== form.value.storeId) {
      await api.post('/integrations/IFOOD', {
        storeId: form.value.storeId,
        enabled: true,
      });
      // reload integration list and pick the relevant one
      await load();
    }

    const { data } = await api.post('/integrations/ifood/link/start');
    // API returns { userCode | linkCode, codeVerifier, verificationUrlComplete | partnerUrl }
    link.value.linkCode = data.linkCode || data.userCode || '';
    link.value.partnerUrl = data.partnerUrl || data.verificationUrlComplete || '';
    link.value.codeVerifier = data.codeVerifier || '';
    statusMsg.value = 'Código de vínculo gerado (visível apenas para administradores em modo debug).';
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
onMounted(loadStores);
// load server-side env debug info (if authorized)
try { onMounted(loadDebug); } catch (e) { /* ignore */ }

async function unlinkStore(){
  const res = await Swal.fire({
    title: 'Desvincular loja',
    text: 'Tem certeza que deseja desvincular a loja desta integração? Isso removerá a associação e permitirá escolher outra loja.',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'Sim, desvincular',
    cancelButtonText: 'Cancelar',
  });
  if (!res || !res.isConfirmed) return;
  try{
    await api.post('/integrations/ifood/unlink');
    statusMsg.value = 'Loja desvinculada com sucesso.';
    await load();
  }catch(e){
    console.error('unlinkStore failed', e);
    statusMsg.value = e?.response?.data?.message || 'Falha ao desvincular loja';
  }
}

const linkedStoreName = computed(() => {
  try {
    if (!integ.value || !integ.value.storeId) return null;
    const s = stores.value.find(x => x.id === integ.value.storeId);
    return s ? s.name : integ.value.storeId;
  } catch (e) { return null }
});
</script>

<template>
  <div class="container py-3">
    <h3 class="d-flex align-items-center">Integração iFood (Autorização pelo lojista)
      <span v-if="integrationStateLabel" :class="['badge', integrationActive ? 'bg-success ms-3' : (integ && integ.enabled ? 'bg-warning text-dark ms-3' : 'bg-secondary ms-3') ]">{{ integrationStateLabel }}</span>
    </h3>

    <div v-if="statusMsg" class="alert alert-info my-2">{{ statusMsg }}</div>

    <div class="card mb-3">
      <div class="card-header">Configuração iFood</div>
      <div class="card-body">
        <p class="small text-muted">As credenciais (Client ID, Client Secret e Merchant ID) são gerenciadas pela configuração do servidor (arquivo <code>.env</code>) e não podem ser editadas por aqui. Esta tela apenas vincula a integração a uma loja e inicia o fluxo de autorização.</p>

        <div class="row g-3 align-items-end">
          <div class="col-md-6">
            <label class="form-label">Vincular a Loja (obrigatório)</label>
            <SelectInput class="form-select" v-model="form.storeId" :disabled="storeLocked" required>
              <option :value="null">-- Selecione uma loja --</option>
              <option v-for="s in stores" :key="s.id" :value="s.id">{{ s.name }} {{ s.cnpj ? ' - ' + s.cnpj : '' }}</option>
            </SelectInput>
          </div>
          <div class="col-md-6">
            <label class="form-label">ID da loja (iFood)</label>
            <input class="form-control" v-model="form.merchantId" :disabled="integrationActive" placeholder="Cole o ID da loja (UUID ou numérico)" />
          </div>
          <div class="col-md-6">
            <div class="d-flex gap-2">
              <button class="btn btn-primary" @click="save" :disabled="storeLocked">Salvar</button>
              <button class="btn btn-outline-secondary" @click="load">Recarregar</button>
              <button v-if="storeLocked" class="btn btn-outline-danger" @click="unlinkStore">Desvincular</button>
            </div>
            <div v-if="storeLocked" class="small text-muted mt-2">Loja vinculada e bloqueada para edição. Para alterar, remova a vinculação no backend.</div>
          </div>
        </div>

        <hr />
        <div class="small text-muted">Status das credenciais no servidor:</div>
        <ul class="small">
          <li>
            <div class="d-flex align-items-baseline">
              <div class="me-2">Client ID:</div>
              <div><strong>{{ integ?.clientId || (debugInfo && debugInfo.env && debugInfo.env.IFOOD_CLIENT_ID) || 'não configurado' }}</strong></div>
            </div>
          </li>
          <li>
            <div class="d-flex align-items-baseline">
              <div class="me-2">Client Secret:</div>
              <div>
                <strong class="text-monospace">{{
                  (integ?.clientSecret && integ.clientSecret.slice && integ.clientSecret.length > 0) ? (integ.clientSecret.slice(0,6) + '···' + integ.clientSecret.slice(-4)) : (debugInfo && debugInfo.env && debugInfo.env.IFOOD_CLIENT_SECRET) || 'não configurado'
                }}</strong>
              </div>
            </div>
          </li>
          <li>
            <div class="d-flex align-items-baseline">
              <div class="me-2">Merchant ID:</div>
              <div><strong>{{ integ?.merchantId || (debugInfo && debugInfo.env && debugInfo.env.IFOOD_MERCHANT_ID) || 'não configurado' }}</strong></div>
            </div>
          </li>
          <li>
            <div class="d-flex align-items-baseline">
              <div class="me-2">Merchant UUID:</div>
              <div><strong>{{ integ?.merchantUuid || 'não configurado' }}</strong></div>
            </div>
          </li>
        </ul>
        <div v-if="isDevMode" class="mt-2">
          <button class="btn btn-sm btn-outline-secondary" @click="loadDebug">Carregar debug (dev)</button>
          <small class="text-muted ms-2">(somente em ambiente de desenvolvimento; protegido por autorização)</small>
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
            <TextInput v-model="authCode" placeholder="Cole o código aqui" inputClass="form-control" />
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
        <p><b>Loja vinculada:</b> {{ linkedStoreName || '-' }}</p>
        <p><b>Ativo:</b> {{ integ.enabled ? 'Sim' : 'Não' }}</p>
        <p><b>Token expira em:</b> {{ integ.tokenExpiresAt || '-' }}</p>
        <p><b>Tem token:</b> {{ integ.accessToken ? 'Sim' : 'Não' }}</p>
        <p v-if="integ.accessToken">
          <b>Token (preview):</b>
          <span class="text-monospace">{{ integ.accessToken.slice(0,6) }}···</span>
          <small class="text-muted">({{ integ.accessToken.length }} chars)</small>
          <span v-if="isDevMode" class="ms-3">
            <button class="btn btn-sm btn-outline-secondary" @click="loadFullToken" v-if="!showingFullToken">Mostrar token completo (dev)</button>
            <button class="btn btn-sm btn-outline-secondary" @click="hideFullToken" v-else>Ocultar token</button>
          </span>
        </p>
        <p v-else class="text-muted small">Nenhum accessToken presente no objeto retornado pelo servidor.</p>
        <div v-if="showingFullToken && fullToken" class="mt-2">
          <div class="small text-muted">Access Token (dev):</div>
          <pre class="bg-light p-2 text-monospace" style="overflow:auto;word-break:break-all">{{ fullToken }}</pre>
        </div>
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
        <div v-if="debugInfo" class="mt-3">
          <div class="small text-muted">ENV / debug (servidor):</div>
          <pre class="bg-dark text-light p-2" style="max-height:220px;overflow:auto">{{ JSON.stringify(debugInfo, null, 2) }}</pre>
        </div>
        <div class="btn-group">
          <button class="btn btn-outline-secondary" @click="refreshToken">Renovar token</button>
          <button class="btn btn-outline-primary" @click="testPoll">Executar Poll (teste)</button>
        </div>
      </div>
    </div>
  </div>
</template>
