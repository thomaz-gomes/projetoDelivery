<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import Swal from 'sweetalert2';
import api from '../api';

const route = useRoute();

// ── State ──
const integration = ref(null);
const stores = ref([]);
const menus = ref([]);
const loading = ref(true);

// ── Connection form ──
const clientId = ref('');
const clientSecret = ref('');
const selectedStoreId = ref(null);
const connecting = ref(false);

// ── Settings ──
const settingsSaving = ref(false);

// ── Payment mappings ──
const paymentMappings = ref([]);
const paymentSaving = ref(false);

// ── Menu sync ──
const selectedMenuId = ref(null);
const syncing = ref(false);
const syncResult = ref(null);

// ── Store control ──
const storeActionLoading = ref('');

// ── Status messages ──
const statusMsg = ref('');
const statusType = ref('info');

function showStatus(msg, type = 'info') {
  statusMsg.value = msg;
  statusType.value = type;
}

const isConnected = computed(() => {
  return Boolean(integration.value && integration.value.accessToken);
});

function storeName(integ) {
  if (!integ || !integ.storeId) return '—';
  const s = stores.value.find(x => x.id === integ.storeId);
  return s ? s.name : integ.storeId;
}

// ── Data loading ──
async function loadIntegration() {
  try {
    const { data } = await api.get('/integrations', { params: { provider: 'AIQFOME' } });
    const list = Array.isArray(data) ? data : (data ? [data] : []);
    integration.value = list[0] || null;
  } catch (e) {
    console.error('Failed to load aiqfome integration', e);
    integration.value = null;
  }
}

async function loadStores() {
  try {
    const { data } = await api.get('/stores');
    stores.value = data || [];
  } catch (e) {
    console.warn('Failed to load stores', e);
  }
}

async function loadMenus() {
  try {
    const { data } = await api.get('/menus');
    menus.value = Array.isArray(data) ? data : (data?.menus || []);
  } catch (e) {
    console.warn('Failed to load menus', e);
  }
}

async function loadPaymentMappings() {
  if (!integration.value) return;
  try {
    const { data } = await api.get(`/integrations/aiqfome/${integration.value.id}/payment-mappings`);
    paymentMappings.value = data || [];
  } catch (e) {
    paymentMappings.value = [];
    console.warn('Failed to load payment mappings', e);
  }
}

// ── Connection ──
async function startConnection() {
  if (connecting.value) return;
  if (!clientId.value.trim() || !clientSecret.value.trim()) {
    showStatus('Preencha o Client ID e Client Secret.', 'danger');
    return;
  }
  if (!selectedStoreId.value) {
    showStatus('Selecione a loja.', 'danger');
    return;
  }
  connecting.value = true;
  statusMsg.value = '';
  try {
    const { data } = await api.post('/integrations/aiqfome/link/start', {
      clientId: clientId.value.trim(),
      clientSecret: clientSecret.value.trim(),
      storeId: selectedStoreId.value,
    });
    if (data.authorizationUrl) {
      window.location.href = data.authorizationUrl;
    } else {
      showStatus('Resposta inesperada do servidor.', 'danger');
    }
  } catch (e) {
    console.error('startConnection failed', e);
    showStatus(e?.response?.data?.message || e?.response?.data?.error || 'Falha ao iniciar conexão.', 'danger');
  } finally {
    connecting.value = false;
  }
}

async function disconnect() {
  if (!integration.value) return;
  const res = await Swal.fire({
    title: 'Desconectar aiqfome',
    text: `Tem certeza que deseja desconectar a loja "${storeName(integration.value)}" do aiqfome?`,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'Sim, desconectar',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#dc3545',
  });
  if (!res || !res.isConfirmed) return;
  try {
    await api.post('/integrations/aiqfome/unlink', { integrationId: integration.value.id });
    showStatus('aiqfome desconectado.', 'info');
    await loadIntegration();
  } catch (e) {
    console.error('disconnect failed', e);
    showStatus(e?.response?.data?.message || 'Falha ao desconectar.', 'danger');
  }
}

// ── Settings ──
async function saveSettings() {
  if (!integration.value) return;
  settingsSaving.value = true;
  try {
    await api.put(`/integrations/${integration.value.id}`, {
      autoAccept: integration.value.autoAccept,
      enabled: integration.value.enabled,
    });
    showStatus('Configurações salvas com sucesso!', 'success');
  } catch (e) {
    showStatus(e?.response?.data?.message || 'Erro ao salvar configurações.', 'danger');
  } finally {
    settingsSaving.value = false;
  }
}

// ── Payment mappings ──
async function savePaymentMappings() {
  if (!integration.value) return;
  paymentSaving.value = true;
  try {
    await api.put(`/integrations/aiqfome/${integration.value.id}/payment-mappings`, {
      mappings: paymentMappings.value.map(m => ({
        aiqfomeCode: m.aiqfomeCode,
        systemName: m.systemName,
      })),
    });
    showStatus('Mapeamentos salvos com sucesso!', 'success');
  } catch (e) {
    showStatus(e?.response?.data?.message || 'Erro ao salvar mapeamentos.', 'danger');
  } finally {
    paymentSaving.value = false;
  }
}

// ── Menu sync ──
async function syncMenu() {
  if (!integration.value || !selectedMenuId.value) {
    showStatus('Selecione um cardápio para sincronizar.', 'danger');
    return;
  }
  syncing.value = true;
  syncResult.value = null;
  try {
    const { data } = await api.post('/integrations/aiqfome/menu/sync', {
      integrationId: integration.value.id,
      menuId: selectedMenuId.value,
    });
    syncResult.value = data;
    showStatus('Cardápio sincronizado com sucesso!', 'success');
  } catch (e) {
    console.error('syncMenu failed', e);
    syncResult.value = { error: e?.response?.data?.message || 'Erro ao sincronizar cardápio.' };
    showStatus(e?.response?.data?.message || 'Erro ao sincronizar cardápio.', 'danger');
  } finally {
    syncing.value = false;
  }
}

// ── Store control ──
async function storeAction(action) {
  if (!integration.value) return;
  storeActionLoading.value = action;
  try {
    await api.post(`/integrations/aiqfome/store/${action}`, {
      integrationId: integration.value.id,
    });
    const labels = { open: 'Loja aberta', close: 'Loja fechada', standby: 'Loja em standby' };
    showStatus(labels[action] || 'Ação realizada com sucesso!', 'success');
  } catch (e) {
    showStatus(e?.response?.data?.message || 'Erro ao executar ação.', 'danger');
  } finally {
    storeActionLoading.value = '';
  }
}

// ── Init ──
onMounted(async () => {
  loading.value = true;
  await Promise.all([loadStores(), loadMenus()]);
  await loadIntegration();

  // Check OAuth callback query params
  if (route.query.connected === 'true') {
    showStatus('Conectado ao aiqfome com sucesso!', 'success');
  } else if (route.query.error) {
    showStatus(`Erro na conexão: ${route.query.error}`, 'danger');
  }

  if (isConnected.value) {
    await loadPaymentMappings();
  }
  loading.value = false;
});
</script>

<template>
  <div>
    <!-- Header -->
    <div class="d-flex align-items-center justify-content-between mb-4">
      <div class="d-flex align-items-center gap-3">
        <h4 class="mb-0">Integração aiqfome</h4>
      </div>
      <span v-if="isConnected" class="badge bg-success fs-6 px-3 py-2">Conectado</span>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="text-center py-5">
      <div class="spinner-border text-primary" role="status">
        <span class="visually-hidden">Carregando...</span>
      </div>
    </div>

    <template v-else>
      <!-- Status message -->
      <div v-if="statusMsg" :class="['alert', `alert-${statusType}`]" role="alert">{{ statusMsg }}</div>

      <!-- ═══ CONNECTION SECTION ═══ -->
      <div class="card mb-4">
        <div class="card-header">
          <strong>Conexão</strong>
        </div>
        <div class="card-body">
          <!-- Not connected: show form -->
          <template v-if="!isConnected">
            <p class="text-muted mb-3">Insira as credenciais do aiqfome para conectar sua loja.</p>
            <div class="row g-3" style="max-width:600px">
              <div class="col-12">
                <label class="form-label">Client ID</label>
                <TextInput v-model="clientId" placeholder="Client ID do aiqfome" inputClass="form-control" />
              </div>
              <div class="col-12">
                <label class="form-label">Client Secret</label>
                <TextInput v-model="clientSecret" placeholder="Client Secret do aiqfome" inputClass="form-control" type="password" />
              </div>
              <div class="col-12">
                <label class="form-label">Loja</label>
                <SelectInput v-model="selectedStoreId" inputClass="form-select">
                  <option :value="null">-- Selecione uma loja --</option>
                  <option v-for="s in stores" :key="s.id" :value="s.id">{{ s.name }}</option>
                </SelectInput>
              </div>
              <div class="col-12">
                <button class="btn btn-primary" @click="startConnection" :disabled="connecting">
                  <span v-if="connecting" class="spinner-border spinner-border-sm me-2" role="status"></span>
                  Conectar aiqfome
                </button>
              </div>
            </div>
          </template>

          <!-- Connected: show status -->
          <template v-else>
            <div class="d-flex align-items-center justify-content-between flex-wrap gap-3">
              <div>
                <div class="d-flex align-items-center gap-2 mb-1">
                  <span class="badge bg-success">Conectado</span>
                  <span class="fw-semibold">{{ storeName(integration) }}</span>
                </div>
                <div class="text-muted small" v-if="integration.updatedAt">
                  Atualizado em {{ new Date(integration.updatedAt).toLocaleString('pt-BR') }}
                </div>
              </div>
              <button class="btn btn-outline-danger" @click="disconnect">
                <i class="bi bi-x-circle me-1"></i>Desconectar
              </button>
            </div>
          </template>
        </div>
      </div>

      <!-- ═══ SETTINGS SECTION ═══ -->
      <div v-if="isConnected" class="card mb-4">
        <div class="card-header">
          <strong>Configurações</strong>
        </div>
        <div class="card-body">
          <div class="d-flex flex-column gap-3" style="max-width:400px">
            <div class="form-check form-switch">
              <input class="form-check-input" type="checkbox" role="switch" id="aiqfomeAutoAccept"
                v-model="integration.autoAccept" />
              <label class="form-check-label" for="aiqfomeAutoAccept">
                Aceite automático de pedidos
              </label>
            </div>
            <div class="form-check form-switch">
              <input class="form-check-input" type="checkbox" role="switch" id="aiqfomeEnabled"
                v-model="integration.enabled" />
              <label class="form-check-label" for="aiqfomeEnabled">
                Integração ativa
              </label>
            </div>
            <div>
              <button class="btn btn-primary" @click="saveSettings" :disabled="settingsSaving">
                <span v-if="settingsSaving" class="spinner-border spinner-border-sm me-2" role="status"></span>
                Salvar configurações
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- ═══ PAYMENT MAPPING SECTION ═══ -->
      <div v-if="isConnected" class="card mb-4">
        <div class="card-header d-flex align-items-center justify-content-between">
          <strong>Mapeamento de Pagamentos</strong>
          <button class="btn btn-sm btn-outline-primary" @click="loadPaymentMappings">
            <i class="bi bi-arrow-clockwise me-1"></i>Recarregar
          </button>
        </div>
        <div class="card-body p-0" v-if="paymentMappings.length">
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
                    <TextInput
                      v-model="m.systemName"
                      :placeholder="m.defaultName || m.aiqfomeCode"
                      inputClass="form-control form-control-sm"
                      style="max-width:300px"
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="card-footer d-flex justify-content-end">
            <button class="btn btn-primary" @click="savePaymentMappings" :disabled="paymentSaving">
              <span v-if="paymentSaving" class="spinner-border spinner-border-sm me-1" role="status"></span>
              Salvar mapeamentos
            </button>
          </div>
        </div>
        <div class="card-body" v-else>
          <p class="text-muted mb-0">Nenhum mapeamento de pagamento encontrado. Os mapeamentos serão criados automaticamente quando pedidos forem recebidos.</p>
        </div>
      </div>

      <!-- ═══ MENU SYNC SECTION ═══ -->
      <div v-if="isConnected" class="card mb-4">
        <div class="card-header">
          <strong>Sincronização de Cardápio</strong>
        </div>
        <div class="card-body">
          <div class="d-flex align-items-end gap-3 flex-wrap" style="max-width:600px">
            <div class="flex-grow-1">
              <label class="form-label">Cardápio</label>
              <SelectInput v-model="selectedMenuId" inputClass="form-select">
                <option :value="null">-- Selecione um cardápio --</option>
                <option v-for="m in menus" :key="m.id" :value="m.id">{{ m.name }}</option>
              </SelectInput>
            </div>
            <button class="btn btn-primary" @click="syncMenu" :disabled="syncing || !selectedMenuId">
              <span v-if="syncing" class="spinner-border spinner-border-sm me-2" role="status"></span>
              Sincronizar Cardápio
            </button>
          </div>
          <!-- Sync result -->
          <div v-if="syncResult" class="mt-3">
            <div v-if="syncResult.error" class="alert alert-danger py-2 small mb-0">
              {{ syncResult.error }}
            </div>
            <div v-else class="alert alert-success py-2 small mb-0">
              Sincronização concluída.
              <span v-if="syncResult.successCount != null"> {{ syncResult.successCount }} item(ns) sincronizado(s).</span>
              <span v-if="syncResult.errorCount"> {{ syncResult.errorCount }} erro(s).</span>
            </div>
          </div>
        </div>
      </div>

      <!-- ═══ STORE CONTROL SECTION ═══ -->
      <div v-if="isConnected" class="card mb-4">
        <div class="card-header">
          <strong>Controle da Loja</strong>
        </div>
        <div class="card-body">
          <p class="text-muted mb-3">Controle o status da sua loja no aiqfome.</p>
          <div class="d-flex gap-2 flex-wrap">
            <button class="btn btn-success" @click="storeAction('open')" :disabled="!!storeActionLoading">
              <span v-if="storeActionLoading === 'open'" class="spinner-border spinner-border-sm me-1" role="status"></span>
              <i v-else class="bi bi-shop me-1"></i>
              Abrir Loja
            </button>
            <button class="btn btn-danger" @click="storeAction('close')" :disabled="!!storeActionLoading">
              <span v-if="storeActionLoading === 'close'" class="spinner-border spinner-border-sm me-1" role="status"></span>
              <i v-else class="bi bi-shop-window me-1"></i>
              Fechar Loja
            </button>
            <button class="btn btn-warning" @click="storeAction('standby')" :disabled="!!storeActionLoading">
              <span v-if="storeActionLoading === 'standby'" class="spinner-border spinner-border-sm me-1" role="status"></span>
              <i v-else class="bi bi-pause-circle me-1"></i>
              Standby
            </button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
