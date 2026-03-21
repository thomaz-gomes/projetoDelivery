<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import Swal from 'sweetalert2';
import api from '../api';

const route = useRoute();

// ── State ──
const integrations = ref([]);
const stores = ref([]);
const menus = ref([]);
const loading = ref(true);

// ── Status ──
const statusMsg = ref('');
const statusType = ref('info');

// ── Tabs ──
const activeTab = ref('connections');

// ── New integration form ──
const showNewForm = ref(false);
const newForm = ref({ storeId: null, clientId: '', clientSecret: '' });
const connecting = ref(false);

// ── Payment mappings ──
const paymentIntegId = ref(null);
const paymentMappings = ref([]);
const paymentSaving = ref(false);

// ── Menu sync ──
const selectedMenuId = ref(null);
const menuIntegId = ref(null);
const syncing = ref(false);
const syncResult = ref(null);

// ── Store control ──
const storeActionLoading = ref('');

function showStatus(msg, type = 'info') {
  statusMsg.value = msg;
  statusType.value = type;
}

function isActive(integ) {
  return Boolean(integ && integ.enabled && integ.accessToken);
}

function storeName(integ) {
  if (!integ || !integ.storeId) return '—';
  const s = stores.value.find(x => x.id === integ.storeId);
  return s ? s.name : integ.storeId;
}

// Stores not yet used by an AIQFOME integration
const availableStores = computed(() => {
  const usedIds = new Set(integrations.value.map(i => i.storeId).filter(Boolean));
  return stores.value.filter(s => !usedIds.has(s.id));
});

// ── Data loading ──
async function load() {
  try {
    const { data } = await api.get('/integrations/AIQFOME');
    const list = Array.isArray(data) ? data : (data ? [data] : []);
    integrations.value = list.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  } catch (e) {
    console.error('Failed to load aiqfome integrations', e);
    integrations.value = [];
  }
}

async function loadStores() {
  try { const { data } = await api.get('/stores'); stores.value = data || []; }
  catch (e) { console.warn('Failed to load stores', e); }
}

async function loadMenus() {
  try {
    const { data } = await api.get('/menus');
    menus.value = Array.isArray(data) ? data : (data?.menus || []);
  } catch (e) { console.warn('Failed to load menus', e); }
}

// ── New integration ──
function openNewForm() {
  newForm.value = { storeId: null, clientId: '', clientSecret: '' };
  statusMsg.value = '';
  showNewForm.value = true;
}

function cancelNewForm() {
  showNewForm.value = false;
  statusMsg.value = '';
}

async function startConnection() {
  if (connecting.value) return;
  if (!newForm.value.clientId.trim() || !newForm.value.clientSecret.trim()) {
    showStatus('Preencha o Client ID e Client Secret.', 'danger'); return;
  }
  if (!newForm.value.storeId) {
    showStatus('Selecione a loja.', 'danger'); return;
  }
  connecting.value = true;
  statusMsg.value = '';
  try {
    const { data } = await api.post('/integrations/aiqfome/link/start', {
      clientId: newForm.value.clientId.trim(),
      clientSecret: newForm.value.clientSecret.trim(),
      storeId: newForm.value.storeId,
    });
    if (data.authorizationUrl) {
      window.location.href = data.authorizationUrl;
    } else {
      showStatus('Resposta inesperada do servidor.', 'danger');
    }
  } catch (e) {
    showStatus(e?.response?.data?.message || e?.response?.data?.error || 'Falha ao iniciar conexão.', 'danger');
  } finally { connecting.value = false; }
}

// ── Reconnect existing integration ──
async function reconnect(integ) {
  const clientId = integ.clientId || '';
  const clientSecret = integ.clientSecret || '';
  if (!clientId) {
    showStatus('Client ID não encontrado nesta integração. Remova e crie uma nova.', 'danger');
    return;
  }
  connecting.value = true;
  statusMsg.value = '';
  try {
    const { data } = await api.post('/integrations/aiqfome/link/start', {
      clientId, clientSecret, storeId: integ.storeId,
    });
    if (data.authorizationUrl) {
      window.location.href = data.authorizationUrl;
    }
  } catch (e) {
    showStatus(e?.response?.data?.message || 'Falha ao reconectar.', 'danger');
  } finally { connecting.value = false; }
}

// ── Disconnect ──
async function disconnect(integ) {
  const res = await Swal.fire({
    title: 'Desconectar aiqfome',
    text: `Desconectar a loja "${storeName(integ)}" do aiqfome?`,
    icon: 'warning', showCancelButton: true,
    confirmButtonText: 'Sim, desconectar', cancelButtonText: 'Cancelar',
    confirmButtonColor: '#dc3545',
  });
  if (!res?.isConfirmed) return;
  try {
    await api.post('/integrations/aiqfome/unlink', { integrationId: integ.id });
    showStatus('aiqfome desconectado.', 'info');
    await load();
  } catch (e) {
    showStatus(e?.response?.data?.message || 'Falha ao desconectar.', 'danger');
  }
}

// ── Delete integration ──
async function deleteInteg(integ) {
  const res = await Swal.fire({
    title: 'Remover integração',
    text: `Remover a integração da loja "${storeName(integ)}"? Esta ação não pode ser desfeita.`,
    icon: 'warning', showCancelButton: true,
    confirmButtonText: 'Sim, remover', cancelButtonText: 'Cancelar',
    confirmButtonColor: '#dc3545',
  });
  if (!res?.isConfirmed) return;
  try {
    await api.delete(`/integrations/${integ.id}`);
    showStatus('Integração removida.', 'info');
    await load();
  } catch (e) {
    showStatus(e?.response?.data?.message || 'Falha ao remover.', 'danger');
  }
}

// ── Toggle auto-accept ──
async function toggleAutoAccept(integ) {
  const newVal = !integ.autoAccept;
  try {
    await api.put(`/integrations/${integ.id}`, { autoAccept: newVal });
    integ.autoAccept = newVal;
  } catch (e) {
    Swal.fire({ icon: 'error', text: e?.response?.data?.message || 'Erro ao atualizar aceite automático' });
  }
}

// ── Payment mappings ──
async function openPaymentsTab() {
  activeTab.value = 'payments';
  const active = integrations.value.find(i => isActive(i)) || integrations.value[0];
  if (active) await loadPaymentMappings(active.id);
}

async function loadPaymentMappings(integId) {
  if (!integId) return;
  paymentIntegId.value = integId;
  try {
    const { data } = await api.get(`/integrations/aiqfome/${integId}/payment-mappings`);
    paymentMappings.value = data || [];
  } catch (e) {
    paymentMappings.value = [];
    showStatus('Erro ao carregar mapeamentos.', 'danger');
  }
}

async function savePaymentMappings() {
  if (!paymentIntegId.value) return;
  paymentSaving.value = true;
  try {
    await api.put(`/integrations/aiqfome/${paymentIntegId.value}/payment-mappings`, {
      mappings: paymentMappings.value.map(m => ({ aiqfomeCode: m.aiqfomeCode, systemName: m.systemName })),
    });
    showStatus('Mapeamentos salvos!', 'success');
  } catch (e) {
    showStatus(e?.response?.data?.message || 'Erro ao salvar mapeamentos.', 'danger');
  } finally { paymentSaving.value = false; }
}

// ── Menu sync ──
async function openMenuTab() {
  activeTab.value = 'menu';
  const active = integrations.value.find(i => isActive(i)) || integrations.value[0];
  if (active) menuIntegId.value = active.id;
}

async function syncMenu() {
  if (!menuIntegId.value || !selectedMenuId.value) {
    showStatus('Selecione a integração e o cardápio.', 'danger'); return;
  }
  syncing.value = true;
  syncResult.value = null;
  try {
    const { data } = await api.post('/integrations/aiqfome/menu/sync', {
      integrationId: menuIntegId.value, menuId: selectedMenuId.value,
    });
    syncResult.value = data;
    showStatus('Cardápio sincronizado!', 'success');
  } catch (e) {
    syncResult.value = { error: e?.response?.data?.message || 'Erro ao sincronizar.' };
    showStatus(e?.response?.data?.message || 'Erro ao sincronizar cardápio.', 'danger');
  } finally { syncing.value = false; }
}

// ── Store control ──
async function storeAction(integ, action) {
  storeActionLoading.value = `${integ.id}-${action}`;
  try {
    await api.post(`/integrations/aiqfome/store/${action}`, { integrationId: integ.id });
    const labels = { open: 'Loja aberta', close: 'Loja fechada', standby: 'Loja em standby' };
    showStatus(`${storeName(integ)}: ${labels[action]}!`, 'success');
  } catch (e) {
    showStatus(e?.response?.data?.message || 'Erro ao executar ação.', 'danger');
  } finally { storeActionLoading.value = ''; }
}

// ── Init ──
onMounted(async () => {
  loading.value = true;
  await Promise.all([loadStores(), loadMenus()]);
  await load();
  if (route.query.connected === 'true') showStatus('Conectado ao aiqfome com sucesso!', 'success');
  else if (route.query.error) showStatus(`Erro na conexão: ${route.query.error}`, 'danger');
  loading.value = false;
});
</script>

<template>
  <div>
    <!-- Header -->
    <div class="d-flex align-items-center justify-content-between mb-4">
      <div class="d-flex align-items-center gap-3">
        <img src="https://aiqfome.com/favicon.ico" alt="aiqfome" style="height:36px" />
        <h4 class="mb-0">Integração aiqfome</h4>
      </div>
      <span v-if="integrations.some(i => isActive(i))" class="badge bg-success fs-6 px-3 py-2">
        {{ integrations.filter(i => isActive(i)).length }} loja(s) conectada(s)
      </span>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="text-center py-5">
      <div class="spinner-border text-primary" role="status">
        <span class="visually-hidden">Carregando...</span>
      </div>
    </div>

    <template v-else>
      <!-- Status -->
      <div v-if="statusMsg" :class="['alert', `alert-${statusType}`]" role="alert">{{ statusMsg }}</div>

      <!-- Tabs -->
      <ul class="nav nav-tabs mb-4">
        <li class="nav-item">
          <a class="nav-link" :class="{ active: activeTab === 'connections' }" href="#" @click.prevent="activeTab = 'connections'">
            <i class="bi bi-link-45deg me-1"></i>Conexões
          </a>
        </li>
        <li class="nav-item">
          <a class="nav-link" :class="{ active: activeTab === 'payments' }" href="#" @click.prevent="openPaymentsTab">
            <i class="bi bi-credit-card me-1"></i>Pagamentos
          </a>
        </li>
        <li class="nav-item">
          <a class="nav-link" :class="{ active: activeTab === 'menu' }" href="#" @click.prevent="openMenuTab">
            <i class="bi bi-list-ul me-1"></i>Cardápio
          </a>
        </li>
      </ul>

      <!-- ═══ TAB: CONNECTIONS ═══ -->
      <div v-if="activeTab === 'connections'">

        <!-- List of integrations -->
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
                        Store ID: {{ integ.merchantId || 'não definido' }}
                      </div>
                    </div>
                    <span v-if="isActive(integ)" class="badge bg-success">Conectado</span>
                    <span v-else class="badge bg-secondary">Desconectado</span>
                  </div>
                  <!-- Auto-accept toggle -->
                  <div v-if="isActive(integ)" class="d-flex align-items-center gap-2">
                    <div class="form-check form-switch mb-0">
                      <input class="form-check-input" type="checkbox" role="switch"
                        :id="'autoAccept-' + integ.id"
                        :checked="integ.autoAccept"
                        @change="toggleAutoAccept(integ)" />
                      <label class="form-check-label small" :for="'autoAccept-' + integ.id">
                        Aceite automático
                      </label>
                    </div>
                  </div>
                  <div class="d-flex gap-2">
                    <button v-if="!isActive(integ)" class="btn btn-sm btn-outline-primary" @click="reconnect(integ)">
                      <i class="bi bi-link-45deg"></i> Conectar
                    </button>
                    <button v-if="isActive(integ)" class="btn btn-sm btn-outline-warning" @click="reconnect(integ)">
                      <i class="bi bi-arrow-repeat"></i> Reconectar
                    </button>
                    <button v-if="isActive(integ)" class="btn btn-sm btn-outline-danger" @click="disconnect(integ)">
                      <i class="bi bi-x-circle"></i> Desconectar
                    </button>
                    <!-- Store controls inline -->
                    <div v-if="isActive(integ)" class="btn-group">
                      <button class="btn btn-sm btn-outline-success" @click="storeAction(integ, 'open')"
                        :disabled="!!storeActionLoading" title="Abrir loja">
                        <i class="bi bi-shop"></i>
                      </button>
                      <button class="btn btn-sm btn-outline-danger" @click="storeAction(integ, 'close')"
                        :disabled="!!storeActionLoading" title="Fechar loja">
                        <i class="bi bi-shop-window"></i>
                      </button>
                      <button class="btn btn-sm btn-outline-warning" @click="storeAction(integ, 'standby')"
                        :disabled="!!storeActionLoading" title="Standby">
                        <i class="bi bi-pause-circle"></i>
                      </button>
                    </div>
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
          Nenhuma integração aiqfome configurada ainda.
        </div>

        <!-- Add new integration -->
        <div class="mb-3">
          <button v-if="!showNewForm" class="btn btn-outline-primary" @click="openNewForm"
            :disabled="availableStores.length === 0">
            <i class="bi bi-plus-circle"></i> Adicionar nova integração
          </button>
          <small v-if="availableStores.length === 0 && !showNewForm" class="text-muted ms-2">
            Todas as lojas já possuem integração aiqfome.
          </small>
        </div>

        <!-- New integration form -->
        <div v-if="showNewForm" class="card mt-3">
          <div class="card-header d-flex align-items-center justify-content-between">
            <strong>Nova integração aiqfome</strong>
            <button type="button" class="btn-close" @click="cancelNewForm" aria-label="Fechar"></button>
          </div>
          <div class="card-body">
            <p class="text-muted mb-3">Conecte uma loja ao aiqfome via ID Magalu.</p>
            <div class="row g-3" style="max-width:600px">
              <div class="col-12">
                <label class="form-label">Loja</label>
                <SelectInput v-model="newForm.storeId" inputClass="form-select">
                  <option :value="null">-- Selecione uma loja --</option>
                  <option v-for="s in availableStores" :key="s.id" :value="s.id">{{ s.name }}</option>
                </SelectInput>
              </div>
              <div class="col-12">
                <label class="form-label">Client ID</label>
                <TextInput v-model="newForm.clientId" placeholder="Client ID do portal aiqfome" inputClass="form-control" />
              </div>
              <div class="col-12">
                <label class="form-label">Client Secret</label>
                <TextInput v-model="newForm.clientSecret" placeholder="Client Secret" inputClass="form-control" type="password" />
              </div>
              <div class="col-12 d-flex gap-2">
                <button class="btn btn-primary" @click="startConnection" :disabled="connecting">
                  <span v-if="connecting" class="spinner-border spinner-border-sm me-2" role="status"></span>
                  Conectar ao aiqfome
                </button>
                <button class="btn btn-outline-secondary" @click="cancelNewForm">Cancelar</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ═══ TAB: PAYMENTS ═══ -->
      <div v-if="activeTab === 'payments'">
        <div class="mb-3" v-if="integrations.length > 1">
          <label class="form-label">Integração</label>
          <SelectInput v-model="paymentIntegId" @change="loadPaymentMappings(paymentIntegId)" inputClass="form-select" style="max-width:400px">
            <option v-for="integ in integrations" :key="integ.id" :value="integ.id">{{ storeName(integ) }}</option>
          </SelectInput>
        </div>

        <div v-if="paymentMappings.length" class="card">
          <div class="card-body p-0">
            <div class="table-responsive">
              <table class="table table-hover mb-0 align-middle">
                <thead class="table-light">
                  <tr>
                    <th style="width:250px">Código aiqfome</th>
                    <th>Nome no sistema</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="m in paymentMappings" :key="m.aiqfomeCode">
                    <td><code class="fw-bold">{{ m.aiqfomeCode }}</code></td>
                    <td>
                      <TextInput v-model="m.systemName" :placeholder="m.aiqfomeCode"
                        inputClass="form-control form-control-sm" style="max-width:300px" />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          <div class="card-footer d-flex justify-content-end">
            <button class="btn btn-primary" @click="savePaymentMappings" :disabled="paymentSaving">
              <span v-if="paymentSaving" class="spinner-border spinner-border-sm me-1" role="status"></span>
              Salvar mapeamentos
            </button>
          </div>
        </div>
        <div v-else class="alert alert-info">Nenhum mapeamento de pagamento configurado.</div>
      </div>

      <!-- ═══ TAB: MENU SYNC ═══ -->
      <div v-if="activeTab === 'menu'">
        <div class="card">
          <div class="card-body">
            <p class="text-muted mb-3">Envie a estrutura do seu cardápio para o aiqfome (preços são gerenciados no painel aiqfome).</p>
            <div class="row g-3" style="max-width:600px">
              <div class="col-12" v-if="integrations.length > 1">
                <label class="form-label">Integração (loja)</label>
                <SelectInput v-model="menuIntegId" inputClass="form-select">
                  <option v-for="integ in integrations" :key="integ.id" :value="integ.id">{{ storeName(integ) }}</option>
                </SelectInput>
              </div>
              <div class="col-12">
                <label class="form-label">Cardápio</label>
                <SelectInput v-model="selectedMenuId" inputClass="form-select">
                  <option :value="null">-- Selecione um cardápio --</option>
                  <option v-for="m in menus" :key="m.id" :value="m.id">{{ m.name }}</option>
                </SelectInput>
              </div>
              <div class="col-12">
                <button class="btn btn-primary" @click="syncMenu" :disabled="syncing || !selectedMenuId || !menuIntegId">
                  <span v-if="syncing" class="spinner-border spinner-border-sm me-2" role="status"></span>
                  Sincronizar Cardápio
                </button>
              </div>
            </div>
            <div v-if="syncResult" class="mt-3">
              <div v-if="syncResult.error" class="alert alert-danger py-2 small mb-0">{{ syncResult.error }}</div>
              <div v-else class="alert alert-success py-2 small mb-0">
                Sincronização concluída.
                <span v-if="syncResult.categories != null"> {{ syncResult.categories }} categoria(s),</span>
                <span v-if="syncResult.items != null"> {{ syncResult.items }} item(ns)</span>
                <span v-if="syncResult.errors?.length"> — {{ syncResult.errors.length }} erro(s).</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
