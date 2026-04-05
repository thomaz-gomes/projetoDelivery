<script setup>
import { ref, computed, onMounted } from 'vue';
import Swal from 'sweetalert2';
import api from '../api';
import TextInput from './form/input/TextInput.vue';
import SelectInput from './form/select/SelectInput.vue';

const integrations = ref([]);
const stores = ref([]);
const menus = ref([]);
const loading = ref(true);
const statusMsg = ref('');
const statusType = ref('info');
const activeTab = ref('connections');

// New integration form
const showNewForm = ref(false);
const newForm = ref({ storeId: null, token: '', merchantId: '' });
const connecting = ref(false);

// Payment mappings
const paymentIntegId = ref(null);
const paymentMappings = ref([]);
const paymentSaving = ref(false);

// Menu sync
const selectedMenuId = ref(null);
const menuIntegId = ref(null);
const syncing = ref(false);
const syncResult = ref(null);

// Store control
const storeActionLoading = ref('');

function showStatus(msg, type = 'info') { statusMsg.value = msg; statusType.value = type; }
function isActive(integ) { return Boolean(integ && integ.enabled && integ.accessToken); }
function storeName(integ) {
  if (!integ?.storeId) return '—';
  const s = stores.value.find(x => x.id === integ.storeId);
  return s ? s.name : integ.storeId;
}

const webhookUrl = computed(() => {
  const origin = window.location.origin || '';
  const apiBase = origin.replace('app.', 'api.');
  return `${apiBase}/webhooks/aiqfome`;
});

function copyWebhook() {
  navigator.clipboard.writeText(webhookUrl.value).then(() => showStatus('URL copiada!', 'success')).catch(() => {});
}

const availableStores = computed(() => {
  const usedIds = new Set(integrations.value.map(i => i.storeId).filter(Boolean));
  return stores.value.filter(s => !usedIds.has(s.id));
});

// ── Data loading ──
async function load() {
  try {
    const { data } = await api.get('/integrations/AIQFOME');
    integrations.value = (Array.isArray(data) ? data : (data ? [data] : [])).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  } catch (e) { integrations.value = []; }
}
async function loadStores() {
  try { const { data } = await api.get('/stores'); stores.value = data || []; } catch (e) {}
}
async function loadMenus() {
  try { const { data } = await api.get('/menu/menus'); menus.value = Array.isArray(data) ? data : (data?.menus || []); } catch (e) {}
}

// ── Connect (save aiqbridge token) ──
function openNewForm() { newForm.value = { storeId: null, token: '', merchantId: '' }; statusMsg.value = ''; showNewForm.value = true; }
function cancelNewForm() { showNewForm.value = false; statusMsg.value = ''; }

async function startConnection() {
  if (connecting.value) return;
  if (!newForm.value.token.trim()) { showStatus('Cole o token gerado no dashboard aiqbridge.', 'danger'); return; }
  if (!newForm.value.storeId) { showStatus('Selecione a loja.', 'danger'); return; }
  connecting.value = true;
  statusMsg.value = '';
  try {
    await api.post('/integrations/aiqfome/link/start', {
      token: newForm.value.token.trim(),
      storeId: newForm.value.storeId,
      merchantId: newForm.value.merchantId.trim() || null,
    });
    showStatus('Conectado ao aiqfome via aiqbridge!', 'success');
    showNewForm.value = false;
    await load();
  } catch (e) {
    showStatus(e?.response?.data?.message || 'Falha ao salvar token.', 'danger');
  } finally { connecting.value = false; }
}

// ── Disconnect ──
async function disconnect(integ) {
  const res = await Swal.fire({
    title: 'Desconectar aiqfome', text: `Desconectar a loja "${storeName(integ)}"?`,
    icon: 'warning', showCancelButton: true, confirmButtonText: 'Sim, desconectar', cancelButtonText: 'Cancelar', confirmButtonColor: '#dc3545',
  });
  if (!res?.isConfirmed) return;
  try {
    await api.post('/integrations/aiqfome/unlink', { integrationId: integ.id });
    showStatus('Desconectado.', 'info');
    await load();
  } catch (e) { showStatus(e?.response?.data?.message || 'Falha ao desconectar.', 'danger'); }
}

async function deleteInteg(integ) {
  const res = await Swal.fire({
    title: 'Remover integração', text: `Remover "${storeName(integ)}"?`,
    icon: 'warning', showCancelButton: true, confirmButtonText: 'Sim, remover', cancelButtonText: 'Cancelar', confirmButtonColor: '#dc3545',
  });
  if (!res?.isConfirmed) return;
  try { await api.delete(`/integrations/${integ.id}`); showStatus('Removida.', 'info'); await load(); }
  catch (e) { showStatus(e?.response?.data?.message || 'Falha ao remover.', 'danger'); }
}

async function toggleAutoAccept(integ) {
  try { await api.put(`/integrations/${integ.id}`, { autoAccept: !integ.autoAccept }); integ.autoAccept = !integ.autoAccept; }
  catch (e) { Swal.fire({ icon: 'error', text: e?.response?.data?.message || 'Erro' }); }
}

// ── Webhook config ──
async function configureWebhook(integ) {
  try {
    const webhookUrl = `${window.location.origin.replace('app.', 'api.')}/webhooks/aiqfome`;
    await api.post(`/integrations/aiqfome/webhook/config`, { integrationId: integ.id, url: webhookUrl });
    showStatus('Webhook configurado!', 'success');
  } catch (e) { showStatus(e?.response?.data?.message || 'Falha ao configurar webhook.', 'danger'); }
}

// ── Payment mappings ──
async function loadPaymentMappings(integId) {
  if (!integId) return; paymentIntegId.value = integId;
  try { const { data } = await api.get(`/integrations/aiqfome/${integId}/payment-mappings`); paymentMappings.value = data || []; }
  catch (e) { paymentMappings.value = []; }
}
async function savePaymentMappings() {
  if (!paymentIntegId.value) return; paymentSaving.value = true;
  try {
    await api.put(`/integrations/aiqfome/${paymentIntegId.value}/payment-mappings`, { mappings: paymentMappings.value.map(m => ({ aiqfomeCode: m.aiqfomeCode, systemName: m.systemName })) });
    showStatus('Mapeamentos salvos!', 'success');
  } catch (e) { showStatus('Erro ao salvar.', 'danger'); } finally { paymentSaving.value = false; }
}

// ── Menu sync ──
async function syncMenu() {
  if (!menuIntegId.value || !selectedMenuId.value) { showStatus('Selecione integração e cardápio.', 'danger'); return; }
  syncing.value = true; syncResult.value = null;
  try {
    const { data } = await api.post('/integrations/aiqfome/menu/sync', { integrationId: menuIntegId.value, menuId: selectedMenuId.value });
    syncResult.value = data; showStatus('Cardápio sincronizado!', 'success');
  } catch (e) { syncResult.value = { error: e?.response?.data?.message || 'Erro' }; }
  finally { syncing.value = false; }
}

// ── Store control ──
async function storeAction(integ, action) {
  storeActionLoading.value = `${integ.id}-${action}`;
  try {
    await api.post(`/integrations/aiqfome/store/${action}`, { integrationId: integ.id });
    const labels = { open: 'Loja aberta', close: 'Loja fechada', standby: 'Standby' };
    showStatus(`${storeName(integ)}: ${labels[action]}!`, 'success');
  } catch (e) { showStatus(e?.response?.data?.message || 'Erro.', 'danger'); }
  finally { storeActionLoading.value = ''; }
}

onMounted(async () => {
  loading.value = true;
  await Promise.all([loadStores(), loadMenus()]);
  await load();
  loading.value = false;
});
</script>

<template>
  <div>
    <div class="d-flex align-items-center justify-content-between mb-4">
      <div class="d-flex align-items-center gap-3">
        <img src="https://aiqfome.com/favicon.ico" alt="aiqfome" style="height:36px" />
        <div>
          <h4 class="mb-0">Integração aiqfome</h4>
          <small class="text-muted">via aiqbridge</small>
        </div>
      </div>
      <span v-if="integrations.some(i => isActive(i))" class="badge bg-success fs-6 px-3 py-2">
        {{ integrations.filter(i => isActive(i)).length }} loja(s) conectada(s)
      </span>
    </div>

    <div v-if="loading" class="text-center py-5"><div class="spinner-border text-primary"></div></div>

    <template v-else>
      <div v-if="statusMsg" :class="['alert', `alert-${statusType}`]">{{ statusMsg }}</div>

      <ul class="nav nav-tabs mb-4">
        <li class="nav-item"><a class="nav-link" :class="{ active: activeTab === 'connections' }" href="#" @click.prevent="activeTab = 'connections'"><i class="bi bi-link-45deg me-1"></i>Conexões</a></li>
        <li class="nav-item"><a class="nav-link" :class="{ active: activeTab === 'payments' }" href="#" @click.prevent="activeTab = 'payments'; loadPaymentMappings((integrations.find(i => isActive(i)) || integrations[0])?.id)"><i class="bi bi-credit-card me-1"></i>Pagamentos</a></li>
        <li class="nav-item"><a class="nav-link" :class="{ active: activeTab === 'menu' }" href="#" @click.prevent="activeTab = 'menu'; menuIntegId = (integrations.find(i => isActive(i)) || integrations[0])?.id"><i class="bi bi-list-ul me-1"></i>Cardápio</a></li>
      </ul>

      <!-- CONNECTIONS -->
      <div v-if="activeTab === 'connections'">
        <div v-if="integrations.length > 0" class="mb-4">
          <div class="d-flex flex-column gap-2">
            <div v-for="integ in integrations" :key="integ.id" class="card" :class="isActive(integ) ? 'border-success' : 'border-secondary'">
              <div class="card-body py-3">
                <div class="d-flex align-items-center justify-content-between flex-wrap gap-2">
                  <div class="d-flex align-items-center gap-3">
                    <div>
                      <div class="fw-semibold">{{ storeName(integ) }}</div>
                      <div class="text-muted small">Merchant ID: {{ integ.merchantId || '—' }}</div>
                    </div>
                    <span v-if="isActive(integ)" class="badge bg-success">Conectado</span>
                    <span v-else class="badge bg-secondary">Desconectado</span>
                  </div>
                  <div v-if="isActive(integ)" class="d-flex align-items-center gap-2">
                    <div class="form-check form-switch mb-0">
                      <input class="form-check-input" type="checkbox" :checked="integ.autoAccept" @change="toggleAutoAccept(integ)" />
                      <label class="form-check-label small">Aceite automático</label>
                    </div>
                  </div>
                  <div class="d-flex gap-2">
                    <div v-if="isActive(integ)" class="btn-group">
                      <button class="btn btn-sm btn-outline-success" @click="storeAction(integ, 'open')" :disabled="!!storeActionLoading" title="Abrir"><i class="bi bi-shop"></i></button>
                      <button class="btn btn-sm btn-outline-danger" @click="storeAction(integ, 'close')" :disabled="!!storeActionLoading" title="Fechar"><i class="bi bi-shop-window"></i></button>
                      <button class="btn btn-sm btn-outline-warning" @click="storeAction(integ, 'standby')" :disabled="!!storeActionLoading" title="Standby"><i class="bi bi-pause-circle"></i></button>
                    </div>
                    <button v-if="isActive(integ)" class="btn btn-sm btn-outline-danger" @click="disconnect(integ)"><i class="bi bi-x-circle"></i> Desconectar</button>
                    <button class="btn btn-sm btn-outline-secondary" @click="deleteInteg(integ)" title="Remover"><i class="bi bi-trash"></i></button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div v-else class="alert alert-info">Nenhuma integração aiqfome configurada.</div>

        <!-- Webhook URL -->
        <div v-if="integrations.length > 0" class="card mb-3">
          <div class="card-body py-2 d-flex align-items-center gap-2">
            <i class="bi bi-globe text-primary"></i>
            <div>
              <div class="small text-muted">URL do Webhook (configure no aiqbridge)</div>
              <code class="small user-select-all">{{ webhookUrl }}</code>
            </div>
            <button class="btn btn-sm btn-outline-secondary ms-auto" @click="copyWebhook" title="Copiar"><i class="bi bi-clipboard"></i></button>
          </div>
        </div>

        <button v-if="!showNewForm" class="btn btn-outline-primary" @click="openNewForm" :disabled="availableStores.length === 0">
          <i class="bi bi-plus-circle"></i> Adicionar integração
        </button>

        <!-- New integration form -->
        <div v-if="showNewForm" class="card mt-3">
          <div class="card-header d-flex align-items-center justify-content-between">
            <strong>Nova integração aiqfome (aiqbridge)</strong>
            <button type="button" class="btn-close" @click="cancelNewForm"></button>
          </div>
          <div class="card-body">
            <div class="alert alert-light small mb-3">
              <i class="bi bi-info-circle me-1"></i>
              Gere o token no <a href="https://www.aiqbridge.com.br/web/" target="_blank">dashboard aiqbridge</a> e cole abaixo.
            </div>
            <div class="row g-3" style="max-width:600px">
              <div class="col-12">
                <label class="form-label">Loja</label>
                <SelectInput v-model="newForm.storeId" inputClass="form-select">
                  <option :value="null">-- Selecione --</option>
                  <option v-for="s in availableStores" :key="s.id" :value="s.id">{{ s.name }}</option>
                </SelectInput>
              </div>
              <div class="col-12">
                <label class="form-label">Token aiqbridge</label>
                <TextInput v-model="newForm.token" placeholder="Cole o token JWT do aiqbridge" inputClass="form-control" />
              </div>
              <div class="col-12">
                <label class="form-label">Merchant ID (opcional)</label>
                <TextInput v-model="newForm.merchantId" placeholder="ID da loja no aiqfome" inputClass="form-control" />
                <div class="form-text">Usado para associar webhooks recebidos à loja correta.</div>
              </div>
              <div class="col-12 d-flex gap-2">
                <button class="btn btn-primary" @click="startConnection" :disabled="connecting">
                  <span v-if="connecting" class="spinner-border spinner-border-sm me-2"></span>
                  Salvar e conectar
                </button>
                <button class="btn btn-outline-secondary" @click="cancelNewForm">Cancelar</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- PAYMENTS -->
      <div v-if="activeTab === 'payments'">
        <div v-if="paymentMappings.length" class="card">
          <div class="card-body p-0">
            <table class="table table-hover mb-0 align-middle">
              <thead class="table-light">
                <tr><th style="width:250px">Código aiqfome</th><th>Nome no sistema</th></tr>
              </thead>
              <tbody>
                <tr v-for="m in paymentMappings" :key="m.aiqfomeCode">
                  <td><code class="fw-bold">{{ m.aiqfomeCode }}</code></td>
                  <td><TextInput v-model="m.systemName" :placeholder="m.aiqfomeCode" inputClass="form-control form-control-sm" style="max-width:300px" /></td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="card-footer d-flex justify-content-end">
            <button class="btn btn-primary" @click="savePaymentMappings" :disabled="paymentSaving">
              <span v-if="paymentSaving" class="spinner-border spinner-border-sm me-1"></span>Salvar
            </button>
          </div>
        </div>
        <div v-else class="alert alert-info">Nenhum mapeamento configurado.</div>
      </div>

      <!-- MENU -->
      <div v-if="activeTab === 'menu'">
        <div class="card">
          <div class="card-body">
            <p class="text-muted mb-3">Envie a estrutura do cardápio para o aiqfome (preços são gerenciados no aiqfome).</p>
            <div class="row g-3" style="max-width:600px">
              <div class="col-12">
                <label class="form-label">Cardápio</label>
                <SelectInput v-model="selectedMenuId" inputClass="form-select">
                  <option :value="null">-- Selecione --</option>
                  <option v-for="m in menus" :key="m.id" :value="m.id">{{ m.name }}</option>
                </SelectInput>
              </div>
              <div class="col-12">
                <button class="btn btn-primary" @click="syncMenu" :disabled="syncing || !selectedMenuId || !menuIntegId">
                  <span v-if="syncing" class="spinner-border spinner-border-sm me-2"></span>Sincronizar
                </button>
              </div>
            </div>
            <div v-if="syncResult" class="mt-3">
              <div v-if="syncResult.error" class="alert alert-danger py-2 small mb-0">{{ syncResult.error }}</div>
              <div v-else class="alert alert-success py-2 small mb-0">
                Sincronizado: {{ syncResult.items || 0 }} item(ns)
                <span v-if="syncResult.errors?.length"> — {{ syncResult.errors.length }} erro(s)</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
