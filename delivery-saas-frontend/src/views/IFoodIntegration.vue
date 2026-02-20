<script setup>
import { ref, onMounted, computed, onUnmounted } from 'vue';
import Swal from 'sweetalert2';
import api from '../api';

// ── All integrations ──
const integrations = ref([]);
const stores = ref([]);

// ── Wizard state ──
const showWizard = ref(false);
const wizardMode = ref('new'); // 'new' | 'relink'
const wizardIntegId = ref(null); // integration id when relinking
const wizardForm = ref({ storeId: null, merchantId: '' });
const wizardLink = ref({ linkCode: '', partnerUrl: '' });
const wizardAuthCode = ref('');
const wizardLinking = ref(false);
const wizardConfirming = ref(false);
const statusMsg = ref('');
const statusType = ref('info');

let refreshTimers = [];

function clearRefreshTimers() {
  refreshTimers.forEach(t => clearTimeout(t));
  refreshTimers = [];
}

function scheduleRefreshForInteg(integ) {
  try {
    if (!integ.tokenExpiresAt) return;
    const expires = new Date(integ.tokenExpiresAt).getTime();
    if (isNaN(expires)) return;
    let delay = expires - Date.now() - 60 * 1000;
    if (delay < 10000) delay = 10000;
    const t = setTimeout(async () => {
      try {
        await api.post('/integrations/ifood/token/refresh');
        await load();
      } catch (e) { console.error('Scheduled refresh failed', e); }
    }, delay);
    refreshTimers.push(t);
  } catch (e) { console.error('scheduleRefreshForInteg error', e); }
}

function isActive(integ) {
  return Boolean(integ && integ.enabled && (integ.accessToken || integ.tokenExpiresAt));
}

function storeName(integ) {
  if (!integ.storeId) return '—';
  const s = stores.value.find(x => x.id === integ.storeId);
  return s ? s.name : integ.storeId;
}

// ── Data loading ──
async function load() {
  const { data } = await api.get('/integrations/ifood');
  const list = Array.isArray(data) ? data : (data ? [data] : []);
  integrations.value = list.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  clearRefreshTimers();
  list.forEach(integ => {
    if (isActive(integ)) scheduleRefreshForInteg(integ);
  });
}

async function loadStores() {
  try { const { data } = await api.get('/stores'); stores.value = data || []; }
  catch (e) { console.warn('Failed to load stores', e); }
}

// ── Wizard helpers ──
const portalUrl = computed(() => {
  if (!wizardLink.value.linkCode) return '';
  return `https://portal.ifood.com.br/apps/code?c=${encodeURIComponent(wizardLink.value.linkCode)}`;
});

const wizardStep = computed(() => {
  if (wizardLink.value.linkCode) return 3;
  if (wizardForm.value.storeId) return 2;
  return 1;
});

// Stores that don't yet have an integration (for "new" mode)
const availableStores = computed(() => {
  const usedStoreIds = new Set(integrations.value.map(i => i.storeId).filter(Boolean));
  if (wizardMode.value === 'relink') return stores.value; // allow any store when relinking
  return stores.value.filter(s => !usedStoreIds.has(s.id));
});

function showStatus(msg, type = 'info') {
  statusMsg.value = msg;
  statusType.value = type;
}

function openWizardNew() {
  wizardMode.value = 'new';
  wizardIntegId.value = null;
  wizardForm.value = { storeId: null, merchantId: '' };
  wizardLink.value = { linkCode: '', partnerUrl: '' };
  wizardAuthCode.value = '';
  statusMsg.value = '';
  showWizard.value = true;
}

function openWizardRelink(integ) {
  wizardMode.value = 'relink';
  wizardIntegId.value = integ.id;
  wizardForm.value = {
    storeId: integ.storeId || null,
    merchantId: integ.merchantUuid || integ.merchantId || '',
  };
  wizardLink.value = { linkCode: '', partnerUrl: '' };
  wizardAuthCode.value = '';
  statusMsg.value = '';
  showWizard.value = true;
}

function cancelWizard() {
  showWizard.value = false;
  wizardLink.value = { linkCode: '', partnerUrl: '' };
  wizardAuthCode.value = '';
  statusMsg.value = '';
}

async function startWizardLink() {
  if (wizardLinking.value) return;
  if (!wizardForm.value.storeId) { showStatus('Selecione a loja primeiro.', 'danger'); return; }
  wizardLinking.value = true;
  statusMsg.value = '';
  try {
    const mid = String(wizardForm.value.merchantId || '').trim();
    const isUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(mid);
    const merchantPayload = mid ? (isUuid ? { merchantUuid: mid } : { merchantId: mid }) : {};

    if (wizardMode.value === 'relink' && wizardIntegId.value) {
      // Update the target integration to make it "most recently updated"
      await api.put(`/integrations/${wizardIntegId.value}`, { enabled: true, ...merchantPayload });
    } else {
      // Create new integration record
      await api.post('/integrations/IFOOD', { storeId: wizardForm.value.storeId, enabled: true, ...merchantPayload });
    }
    await load();

    const { data } = await api.post('/integrations/ifood/link/start');
    wizardLink.value.linkCode = data.linkCode || data.userCode || '';
    wizardLink.value.partnerUrl = data.partnerUrl || data.verificationUrlComplete || '';
    showStatus('Código gerado! Siga as instruções abaixo.', 'success');
  } catch (e) {
    console.error('startWizardLink failed', e);
    const serverMsg = e?.response?.data?.error || e?.response?.data?.message || e?.message || '';
    if (serverMsg.toLowerCase().includes('clientid') || serverMsg.toLowerCase().includes('credenciais')) {
      showStatus('As credenciais do iFood ainda não foram configuradas no servidor. Entre em contato com o suporte técnico.', 'danger');
    } else {
      showStatus(serverMsg || 'Falha ao gerar código de autorização. Tente novamente.', 'danger');
    }
  } finally { wizardLinking.value = false; }
}

async function confirmWizardLink() {
  if (wizardConfirming.value) return;
  wizardConfirming.value = true;
  statusMsg.value = '';
  try {
    await api.post('/integrations/ifood/link/confirm', { authorizationCode: wizardAuthCode.value });
    showStatus('Conectado com sucesso ao iFood!', 'success');
    await load();
    cancelWizard();
  } catch (e) {
    console.error('confirmWizardLink failed', e);
    showStatus(e?.response?.data?.message || e?.response?.data?.error || e?.message || 'Falha ao confirmar', 'danger');
  } finally { wizardConfirming.value = false; }
}

async function unlinkInteg(integ) {
  const res = await Swal.fire({
    title: 'Desconectar iFood',
    text: `Tem certeza que deseja desconectar a loja "${storeName(integ)}" do iFood?`,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'Sim, desconectar',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#dc3545',
  });
  if (!res || !res.isConfirmed) return;
  try {
    // Make this integration the most recently updated so unlink targets it
    await api.put(`/integrations/${integ.id}`, { enabled: true });
    await api.post('/integrations/ifood/unlink');
    showStatus('iFood desconectado.', 'info');
    await load();
  } catch (e) {
    console.error('unlinkInteg failed', e);
    showStatus(e?.response?.data?.message || 'Falha ao desconectar', 'danger');
  }
}

async function deleteInteg(integ) {
  const res = await Swal.fire({
    title: 'Remover integração',
    text: `Remover a integração da loja "${storeName(integ)}"? Esta ação não pode ser desfeita.`,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'Sim, remover',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#dc3545',
  });
  if (!res || !res.isConfirmed) return;
  try {
    await api.delete(`/integrations/${integ.id}`);
    showStatus('Integração removida.', 'info');
    await load();
  } catch (e) {
    console.error('deleteInteg failed', e);
    showStatus(e?.response?.data?.message || 'Falha ao remover', 'danger');
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

onMounted(async () => {
  await loadStores();
  await load();
});
onUnmounted(() => { clearRefreshTimers(); });
</script>

<template>
  <div>
    <!-- Header -->
    <div class="d-flex align-items-center justify-content-between mb-4">
      <div class="d-flex align-items-center gap-3">
        <img src="https://logodownload.org/wp-content/uploads/2017/05/ifood-logo-0.png" alt="iFood" style="height:36px" />
        <h4 class="mb-0">Integração iFood</h4>
      </div>
      <span v-if="integrations.some(i => isActive(i))" class="badge bg-success fs-6 px-3 py-2">
        {{ integrations.filter(i => isActive(i)).length }} loja(s) conectada(s)
      </span>
    </div>

    <div v-if="statusMsg" :class="['alert', `alert-${statusType}`]" role="alert">{{ statusMsg }}</div>

    <!-- ═══ LIST OF EXISTING INTEGRATIONS ═══ -->
    <div v-if="integrations.length > 0" class="mb-4">
      <h6 class="text-muted mb-3">Integrações configuradas</h6>
      <div class="d-flex flex-column gap-2">
        <div v-for="integ in integrations" :key="integ.id" class="card" :class="isActive(integ) ? 'border-success' : 'border-secondary'">
          <div class="card-body py-3">
            <div class="d-flex align-items-center justify-content-between flex-wrap gap-2">
              <div class="d-flex align-items-center gap-3">
                <div>
                  <div class="fw-semibold">{{ storeName(integ) }}</div>
                  <div class="text-muted small">
                    {{ integ.merchantUuid || integ.merchantId || 'Merchant ID não definido' }}
                  </div>
                </div>
                <span v-if="isActive(integ)" class="badge bg-success">Conectado</span>
                <span v-else class="badge bg-secondary">Desconectado</span>
              </div>
              <div class="d-flex gap-2">
                <button v-if="!isActive(integ)" class="btn btn-sm btn-outline-primary" @click="openWizardRelink(integ)">
                  <i class="bi bi-link-45deg"></i> Conectar
                </button>
                <button v-if="isActive(integ)" class="btn btn-sm btn-outline-warning" @click="openWizardRelink(integ)">
                  <i class="bi bi-arrow-repeat"></i> Reconectar
                </button>
                <button v-if="isActive(integ)" class="btn btn-sm btn-outline-danger" @click="unlinkInteg(integ)">
                  <i class="bi bi-x-circle"></i> Desconectar
                </button>
                <button class="btn btn-sm btn-outline-secondary" @click="deleteInteg(integ)" title="Remover integração">
                  <i class="bi bi-trash"></i>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-else class="alert alert-info">
      Nenhuma integração iFood configurada ainda.
    </div>

    <!-- ═══ ADD NEW INTEGRATION BUTTON ═══ -->
    <div class="mb-3">
      <button v-if="!showWizard" class="btn btn-outline-primary" @click="openWizardNew">
        <i class="bi bi-plus-circle"></i> Adicionar nova integração
      </button>
    </div>

    <!-- ═══ WIZARD ═══ -->
    <div v-if="showWizard" class="card mt-3">
      <div class="card-header d-flex align-items-center justify-content-between">
        <strong>{{ wizardMode === 'relink' ? 'Reconectar integração' : 'Nova integração iFood' }}</strong>
        <button type="button" class="btn-close" @click="cancelWizard" aria-label="Fechar"></button>
      </div>
      <div class="card-body">
        <p class="text-muted mb-4">Conecte sua loja ao iFood em 3 passos simples:</p>

        <!-- STEP 1 — Select store -->
        <div class="mb-4">
          <div class="d-flex align-items-center gap-2 mb-2">
            <span :class="['badge rounded-pill', wizardStep > 1 ? 'bg-success' : 'bg-primary']" style="width:28px;height:28px;display:flex;align-items:center;justify-content:center">
              <span v-if="wizardStep > 1">&#10003;</span>
              <span v-else>1</span>
            </span>
            <strong>Selecione sua loja</strong>
          </div>
          <div class="ms-4 ps-2">
            <div class="mb-2" style="max-width:400px">
              <label class="form-label mb-1">Loja</label>
              <SelectInput class="form-select" v-model="wizardForm.storeId" :disabled="wizardMode === 'relink'">
                <option :value="null">-- Selecione uma loja --</option>
                <option v-for="s in (wizardMode === 'relink' ? stores : availableStores)" :key="s.id" :value="s.id">{{ s.name }}</option>
              </SelectInput>
              <div v-if="wizardMode === 'new' && availableStores.length === 0" class="form-text text-warning">
                Todas as lojas já possuem uma integração iFood. Remova uma existente para adicionar outra.
              </div>
            </div>
            <div style="max-width:400px">
              <label class="form-label mb-1">ID da loja no iFood (opcional)</label>
              <TextInput v-model="wizardForm.merchantId" placeholder="Ex: ab12cd34-ef56-..." inputClass="form-control" />
              <div class="form-text">Encontre esse ID no Portal do Parceiro iFood, em Perfil da loja.</div>
            </div>
          </div>
        </div>

        <!-- STEP 2 — Generate link code -->
        <div class="mb-4">
          <div class="d-flex align-items-center gap-2 mb-2">
            <span :class="['badge rounded-pill', wizardStep > 2 ? 'bg-success' : (wizardStep >= 2 ? 'bg-primary' : 'bg-light text-muted border')]" style="width:28px;height:28px;display:flex;align-items:center;justify-content:center">
              <span v-if="wizardStep > 2">&#10003;</span>
              <span v-else>2</span>
            </span>
            <strong :class="{ 'text-muted': wizardStep < 2 }">Autorize no Portal iFood</strong>
          </div>
          <div v-if="wizardStep >= 2" class="ms-4 ps-2">
            <div v-if="!wizardLink.linkCode">
              <button class="btn btn-primary" @click="startWizardLink" :disabled="wizardLinking">
                <span v-if="wizardLinking" class="spinner-border spinner-border-sm me-2" role="status"></span>
                Gerar código de autorização
              </button>
            </div>
            <div v-else class="p-3 bg-light rounded">
              <p class="mb-2">Seu código de autorização:</p>
              <div class="d-flex align-items-center gap-3 mb-3">
                <span class="fs-3 fw-bold font-monospace bg-white px-3 py-2 rounded border">{{ wizardLink.linkCode }}</span>
                <button class="btn btn-outline-secondary btn-sm" @click="copyToClipboard(wizardLink.linkCode)">Copiar</button>
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
            <span :class="['badge rounded-pill', wizardStep >= 3 ? 'bg-primary' : 'bg-light text-muted border']" style="width:28px;height:28px;display:flex;align-items:center;justify-content:center">3</span>
            <strong :class="{ 'text-muted': wizardStep < 3 }">Cole o código de confirmação</strong>
          </div>
          <div v-if="wizardStep >= 3" class="ms-4 ps-2">
            <div class="d-flex gap-2" style="max-width:500px">
              <TextInput v-model="wizardAuthCode" placeholder="Cole o código do iFood aqui" inputClass="form-control" />
              <button class="btn btn-success" @click="confirmWizardLink" :disabled="wizardConfirming || !wizardAuthCode" style="white-space:nowrap">
                <span v-if="wizardConfirming" class="spinner-border spinner-border-sm me-2" role="status"></span>
                Conectar
              </button>
            </div>
          </div>
        </div>

      </div>
    </div>
  </div>
</template>
