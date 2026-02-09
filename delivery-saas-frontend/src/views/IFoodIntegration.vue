<script setup>
import { ref, onMounted, computed, onUnmounted } from 'vue';
import Swal from 'sweetalert2';
import api from '../api';

const form = ref({ storeId: null, merchantId: '' });
const integ = ref(null);
const statusMsg = ref('');
const statusType = ref('info'); // 'info' | 'success' | 'danger'

const hasTokens = computed(() => {
  if (!integ.value) return false;
  if (typeof integ.value.hasTokens !== 'undefined') return Boolean(integ.value.hasTokens);
  const t = integ.value.accessToken ?? integ.value.access_token ?? null;
  if (t && String(t).trim().length > 0) return true;
  if (integ.value.tokenExpiresAt) return true;
  return false;
});

const integrationActive = computed(() => Boolean(integ.value && integ.value.enabled && hasTokens.value));

const link = ref({ linkCode: '', partnerUrl: '', codeVerifier: '' });
const authCode = ref('');
const linking = ref(false);
const confirming = ref(false);

let refreshTimer = null;

function clearRefreshTimer() {
  if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null; }
}

function scheduleRefreshFromInteg() {
  clearRefreshTimer();
  try {
    if (!integ.value || !integ.value.tokenExpiresAt) return;
    const expires = new Date(integ.value.tokenExpiresAt).getTime();
    if (isNaN(expires)) return;
    let delay = expires - Date.now() - 60 * 1000;
    if (delay < 10000) delay = 10000;
    refreshTimer = setTimeout(async () => {
      try {
        await api.post('/integrations/ifood/token/refresh');
        await load();
      } catch (e) { console.error('Scheduled refresh failed', e); }
    }, delay);
  } catch (e) { console.error('scheduleRefreshFromInteg error', e); }
}

const portalUrl = computed(() => {
  if (!link.value.linkCode) return '';
  return `https://portal.ifood.com.br/apps/code?c=${encodeURIComponent(link.value.linkCode)}`;
});

// ── Data loading ──

async function load() {
  const { data } = await api.get('/integrations/ifood');
  if (Array.isArray(data)) {
    const list = data || [];
    if (list.length === 0) { integ.value = null; }
    else {
      const enabledWithToken = list.find(i => i.enabled && (i.accessToken || i.tokenExpiresAt));
      if (enabledWithToken) integ.value = enabledWithToken;
      else { list.sort((a,b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()); integ.value = list[0]; }
    }
  } else {
    integ.value = data || null;
  }
  if (integ.value) {
    form.value.storeId = (integ.value.storeId && String(integ.value.storeId)) || null;
    form.value.merchantId = integ.value.merchantUuid || integ.value.merchantId || '';
    scheduleRefreshFromInteg();
  }
}

const stores = ref([]);
async function loadStores() {
  try { const { data } = await api.get('/stores'); stores.value = data || []; }
  catch (e) { console.warn('Failed to load stores', e); }
}

const storeLocked = computed(() => {
  try { return Boolean(integ.value && (integ.value.storeId || (integ.value.enabled && hasTokens.value))); }
  catch(e){ return false }
});

const linkedStoreName = computed(() => {
  try {
    if (!integ.value || !integ.value.storeId) return null;
    const s = stores.value.find(x => x.id === integ.value.storeId);
    return s ? s.name : integ.value.storeId;
  } catch (e) { return null }
});

// ── Current step for the wizard ──
const currentStep = computed(() => {
  if (integrationActive.value) return 4; // done
  if (link.value.linkCode) return 3;     // waiting for auth code
  if (form.value.storeId) return 2;      // store selected, ready to generate code
  return 1;                               // select store
});

// ── Actions ──

function showStatus(msg, type = 'info') {
  statusMsg.value = msg;
  statusType.value = type;
}

async function startLink() {
  if (linking.value) return;
  if (!form.value.storeId) { showStatus('Selecione a loja primeiro.', 'danger'); return; }
  linking.value = true;
  statusMsg.value = '';
  try {
    // Build merchant payload — detect UUID vs numeric
    const mid = String(form.value.merchantId || '').trim();
    const isUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(mid);
    const merchantPayload = mid ? (isUuid ? { merchantUuid: mid } : { merchantId: mid }) : {};

    if (!integ.value || integ.value.storeId !== form.value.storeId) {
      await api.post('/integrations/IFOOD', { storeId: form.value.storeId, enabled: true, ...merchantPayload });
      await load();
    } else if (mid) {
      // Update existing integration with merchantId if changed
      await api.put(`/integrations/${integ.value.id}`, merchantPayload);
      await load();
    }
    const { data } = await api.post('/integrations/ifood/link/start');
    link.value.linkCode = data.linkCode || data.userCode || '';
    link.value.partnerUrl = data.partnerUrl || data.verificationUrlComplete || '';
    link.value.codeVerifier = data.codeVerifier || '';
    showStatus('Código gerado! Siga as instruções abaixo.', 'success');
  } catch (e) {
    console.error('startLink failed', e);
    const serverMsg = e?.response?.data?.error || e?.response?.data?.message || e?.message || '';
    if (serverMsg.toLowerCase().includes('clientid') || serverMsg.toLowerCase().includes('credenciais')) {
      showStatus('As credenciais do iFood ainda não foram configuradas no servidor. Entre em contato com o suporte técnico.', 'danger');
    } else {
      showStatus(serverMsg || 'Falha ao gerar código de autorização. Tente novamente.', 'danger');
    }
  } finally { linking.value = false; }
}

async function confirmLink() {
  if (confirming.value) return;
  confirming.value = true;
  statusMsg.value = '';
  try {
    const { data } = await api.post('/integrations/ifood/link/confirm', { authorizationCode: authCode.value });
    showStatus('Conectado com sucesso ao iFood!', 'success');
    await load();
  } catch (e) {
    console.error('confirmLink failed', e);
    showStatus(e?.response?.data?.message || e?.response?.data?.error || e?.message || 'Falha ao confirmar', 'danger');
  } finally { confirming.value = false; }
}

async function unlinkStore(){
  const res = await Swal.fire({
    title: 'Desconectar iFood',
    text: 'Tem certeza que deseja desconectar sua loja do iFood?',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'Sim, desconectar',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#dc3545',
  });
  if (!res || !res.isConfirmed) return;
  try {
    await api.post('/integrations/ifood/unlink');
    link.value = { linkCode: '', partnerUrl: '', codeVerifier: '' };
    authCode.value = '';
    showStatus('iFood desconectado.', 'info');
    await load();
  } catch(e) {
    console.error('unlinkStore failed', e);
    showStatus(e?.response?.data?.message || 'Falha ao desconectar', 'danger');
  }
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    const tmp = document.createElement('input');
    tmp.value = text;
    document.body.appendChild(tmp);
    tmp.select();
    document.execCommand('copy');
    tmp.remove();
  }
}

onMounted(load);
onMounted(loadStores);
onUnmounted(() => { clearRefreshTimer(); });
</script>

<template>
  <div>
    <!-- Header -->
    <div class="d-flex align-items-center justify-content-between mb-4">
      <div class="d-flex align-items-center gap-3">
        <img src="https://logodownload.org/wp-content/uploads/2017/05/ifood-logo-0.png" alt="iFood" style="height:36px" />
        <h4 class="mb-0">Integração iFood</h4>
      </div>
      <span v-if="integrationActive" class="badge bg-success fs-6 px-3 py-2">Conectado</span>
      <span v-else-if="integ" class="badge bg-secondary fs-6 px-3 py-2">Desconectado</span>
    </div>

    <div v-if="statusMsg" :class="['alert', `alert-${statusType}`]" role="alert">{{ statusMsg }}</div>

    <!-- ═══ CONNECTED STATE ═══ -->
    <div v-if="integrationActive" class="card border-success">
      <div class="card-body text-center py-4">
        <div class="mb-3">
          <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" fill="#198754" viewBox="0 0 16 16">
            <path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0m-3.97-3.03a.75.75 0 0 0-1.08.022L7.477 9.417 5.384 7.323a.75.75 0 0 0-1.06 1.06L6.97 11.03a.75.75 0 0 0 1.079-.02l3.992-4.99a.75.75 0 0 0-.01-1.05z"/>
          </svg>
        </div>
        <h5 class="text-success">iFood conectado</h5>
        <p class="text-muted mb-1">Loja: <strong>{{ linkedStoreName }}</strong></p>
        <p class="text-muted small mb-3">Os pedidos do iFood serão recebidos automaticamente.</p>
        <button class="btn btn-outline-danger btn-sm" @click="unlinkStore">Desconectar</button>
      </div>
    </div>

    <!-- ═══ SETUP WIZARD ═══ -->
    <div v-else>
      <div class="card">
        <div class="card-body">
          <p class="text-muted mb-4">Conecte sua loja ao iFood em 3 passos simples:</p>

          <!-- STEP 1 — Select store -->
          <div class="mb-4">
            <div class="d-flex align-items-center gap-2 mb-2">
              <span :class="['badge rounded-pill', currentStep > 1 ? 'bg-success' : 'bg-primary']" style="width:28px;height:28px;display:flex;align-items:center;justify-content:center">
                <span v-if="currentStep > 1">&#10003;</span>
                <span v-else>1</span>
              </span>
              <strong>Selecione sua loja</strong>
            </div>
            <div class="ms-4 ps-2">
              <div class="mb-2" style="max-width:400px">
                <label class="form-label mb-1">Loja</label>
                <SelectInput class="form-select" v-model="form.storeId" :disabled="storeLocked">
                  <option :value="null">-- Selecione uma loja --</option>
                  <option v-for="s in stores" :key="s.id" :value="s.id">{{ s.name }}</option>
                </SelectInput>
              </div>
              <div style="max-width:400px">
                <label class="form-label mb-1">ID da loja no iFood</label>
                <TextInput v-model="form.merchantId" placeholder="Ex: ab12cd34-ef56-..." inputClass="form-control" :disabled="integrationActive" />
                <div class="form-text">Encontre esse ID no Portal do Parceiro iFood, em Perfil da loja.</div>
              </div>
            </div>
          </div>

          <!-- STEP 2 — Generate link code -->
          <div class="mb-4">
            <div class="d-flex align-items-center gap-2 mb-2">
              <span :class="['badge rounded-pill', currentStep > 2 ? 'bg-success' : (currentStep >= 2 ? 'bg-primary' : 'bg-light text-muted border')]" style="width:28px;height:28px;display:flex;align-items:center;justify-content:center">
                <span v-if="currentStep > 2">&#10003;</span>
                <span v-else>2</span>
              </span>
              <strong :class="{ 'text-muted': currentStep < 2 }">Autorize no Portal iFood</strong>
            </div>
            <div v-if="currentStep >= 2" class="ms-4 ps-2">
              <div v-if="!link.linkCode">
                <button class="btn btn-primary" @click="startLink" :disabled="linking">
                  <span v-if="linking" class="spinner-border spinner-border-sm me-2" role="status"></span>
                  Gerar código de autorização
                </button>
              </div>
              <div v-else class="p-3 bg-light rounded">
                <p class="mb-2">Seu código de autorização:</p>
                <div class="d-flex align-items-center gap-3 mb-3">
                  <span class="fs-3 fw-bold font-monospace bg-white px-3 py-2 rounded border">{{ link.linkCode }}</span>
                  <button class="btn btn-outline-secondary btn-sm" @click="copyToClipboard(link.linkCode)">Copiar</button>
                </div>
                <div class="d-flex flex-column gap-2">
                  <div>
                    <a :href="portalUrl" target="_blank" class="btn btn-danger">
                      Abrir Portal iFood
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16" class="ms-1">
                        <path fill-rule="evenodd" d="M8.636 3.5a.5.5 0 0 0-.5-.5H1.5A1.5 1.5 0 0 0 0 4.5v10A1.5 1.5 0 0 0 1.5 16h10a1.5 1.5 0 0 0 1.5-1.5V7.864a.5.5 0 0 0-1 0V14.5a.5.5 0 0 1-.5.5h-10a.5.5 0 0 1-.5-.5v-10a.5.5 0 0 1 .5-.5h6.636a.5.5 0 0 0 .5-.5"/>
                        <path fill-rule="evenodd" d="M16 .5a.5.5 0 0 0-.5-.5h-5a.5.5 0 0 0 0 1h3.793L6.146 9.146a.5.5 0 1 0 .708.708L15 1.707V5.5a.5.5 0 0 0 1 0z"/>
                      </svg>
                    </a>
                  </div>
                  <p class="text-muted small mb-0">Cole o código no portal e autorize o acesso. Depois, copie o <strong>código de confirmação</strong> que o iFood vai mostrar.</p>
                </div>
              </div>
            </div>
          </div>

          <!-- STEP 3 — Paste authorization code -->
          <div>
            <div class="d-flex align-items-center gap-2 mb-2">
              <span :class="['badge rounded-pill', integrationActive ? 'bg-success' : (currentStep >= 3 ? 'bg-primary' : 'bg-light text-muted border')]" style="width:28px;height:28px;display:flex;align-items:center;justify-content:center">
                <span v-if="integrationActive">&#10003;</span>
                <span v-else>3</span>
              </span>
              <strong :class="{ 'text-muted': currentStep < 3 }">Cole o código de confirmação</strong>
            </div>
            <div v-if="currentStep >= 3" class="ms-4 ps-2">
              <div class="d-flex gap-2" style="max-width:500px">
                <TextInput v-model="authCode" placeholder="Cole o código do iFood aqui" inputClass="form-control" />
                <button class="btn btn-success" @click="confirmLink" :disabled="confirming || !authCode" style="white-space:nowrap">
                  <span v-if="confirming" class="spinner-border spinner-border-sm me-2" role="status"></span>
                  Conectar
                </button>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  </div>
</template>
