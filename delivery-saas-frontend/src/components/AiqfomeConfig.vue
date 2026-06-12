<script setup>
import { ref, computed, onMounted } from 'vue';
import Swal from 'sweetalert2';
import api from '../api';
import TextInput from './form/input/TextInput.vue';
import SelectInput from './form/select/SelectInput.vue';
import { API_URL } from '../config';

const integrations = ref([]);
const stores = ref([]);
const menus = ref([]);
const loading = ref(true);
const statusMsg = ref('');
const statusType = ref('info');
const activeTab = ref('connections');

// New integration form — vincula a um CARDÁPIO (a loja vem do cardápio)
const showNewForm = ref(false);
const newForm = ref({ menuId: null, token: '', merchantId: '' });
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
  // Prefere a base real do backend (axios baseURL); cai para o origin (app.->api.)
  // só quando API_URL é relativo/vazio (modo proxy em dev).
  const base = (API_URL && /^https?:\/\//.test(API_URL))
    ? API_URL.replace(/\/$/, '')
    : (window.location.origin || '').replace('app.', 'api.');
  return `${base}/webhooks/aiqfome`;
});

function copyWebhook() {
  navigator.clipboard.writeText(webhookUrl.value).then(() => showStatus('URL copiada!', 'success')).catch(() => {});
}

// Cardápios ainda não vinculados a nenhuma integração aiqfome (1 cardápio por integração).
const availableMenus = computed(() => {
  const usedMenuIds = new Set();
  integrations.value.forEach(i => (i.menuLinks || []).forEach(l => usedMenuIds.add(l.menuId)));
  return menus.value.filter(m => !usedMenuIds.has(m.id));
});

function menuLabel(m) {
  const s = stores.value.find(x => x.id === m.storeId);
  return m.name + (s ? ` (${s.name})` : '');
}

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
function openNewForm() { newForm.value = { menuId: null, token: '', merchantId: '' }; statusMsg.value = ''; showNewForm.value = true; }
function cancelNewForm() { showNewForm.value = false; statusMsg.value = ''; }

async function startConnection() {
  if (connecting.value) return;
  if (!newForm.value.token.trim()) { showStatus('Cole o token gerado no dashboard aiqbridge.', 'danger'); return; }
  if (!newForm.value.menuId) { showStatus('Selecione o cardápio.', 'danger'); return; }
  connecting.value = true;
  statusMsg.value = '';
  try {
    await api.post('/integrations/aiqfome/link/start', {
      token: newForm.value.token.trim(),
      menuId: newForm.value.menuId,
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

// ── Vínculo do cardápio (1 cardápio por integração → define a loja) ──
const expandedMenusId = ref(null);
const menuForm = ref({ menuId: null });
const savingMenus = ref(false);

function openMenuPanel(integ) {
  if (expandedMenusId.value === integ.id) { expandedMenusId.value = null; return; }
  const links = integ.menuLinks || [];
  const current = links.find(l => l.isDefault) || links[0] || null;
  menuForm.value = { menuId: current?.menuId || null };
  expandedMenusId.value = integ.id;
}

async function saveMenuLinks(integ) {
  if (savingMenus.value) return;
  if (!menuForm.value.menuId) { showStatus('Selecione um cardápio.', 'danger'); return; }
  savingMenus.value = true;
  try {
    // 1 cardápio por integração: envia lista de um item, marcado como default.
    await api.put(`/integrations/${integ.id}`, { menuIds: [menuForm.value.menuId], defaultMenuId: menuForm.value.menuId });
    showStatus('Cardápio atualizado.', 'success');
    expandedMenusId.value = null;
    await load();
  } catch (e) {
    showStatus(e?.response?.data?.message || 'Erro ao salvar cardápio.', 'danger');
  } finally { savingMenus.value = false; }
}

// Extrai a causa real (mensagem + detalhe do erro da bridge) para o usuário.
function errDetail(e, fallback) {
  const d = e?.response?.data || {};
  return [d.message, d.error].filter(Boolean).join(' — ') || e?.message || fallback;
}

// ── Webhook config ──
const webhookConfiguring = ref('');
async function configureWebhook(integ) {
  webhookConfiguring.value = integ.id;
  try {
    const { data } = await api.post(`/integrations/aiqfome/webhook/config`, { integrationId: integ.id, webhookUrl: webhookUrl.value });
    showStatus(data.secretCaptured
      ? 'Webhook registrado e assinatura ativada!'
      : 'Webhook registrado (sem secret retornado — verifique no aiqbridge).', 'success');
  } catch (e) {
    showStatus(errDetail(e, 'Falha ao configurar webhook.'), 'danger');
  } finally { webhookConfiguring.value = ''; }
}

const webhookTesting = ref('');
async function testWebhook(integ) {
  const id = integ?.id;
  if (!id) { showStatus('Nenhuma integração aiqfome conectada.', 'danger'); return; }
  webhookTesting.value = id;
  try {
    await api.post('/integrations/aiqfome/webhook/test', { integrationId: id });
    showStatus(`Evento de teste disparado (merchant ${integ.merchantId || '—'}). Confira o visualizador e o log OUT no aiqbridge.`, 'success');
  } catch (e) {
    showStatus(errDetail(e, 'Falha ao disparar evento de teste.'), 'danger');
  } finally { webhookTesting.value = ''; }
}

const webhookInspecting = ref('');
async function inspectWebhook(integ) {
  const id = integ?.id;
  if (!id) { showStatus('Nenhuma integração aiqfome conectada.', 'danger'); return; }
  webhookInspecting.value = id;
  try {
    const { data } = await api.get('/integrations/aiqfome/webhook/config', { params: { integrationId: id } });
    await Swal.fire({
      title: 'Webhook registrado no aiqbridge',
      html: `<pre style="text-align:left;white-space:pre-wrap;font-size:12px">${JSON.stringify(data.config, null, 2)}</pre>
             <div class="small text-muted mt-2">Secret armazenado: ${data.hasSecret ? 'sim' : 'não'}</div>`,
      width: 600,
    });
  } catch (e) {
    showStatus(errDetail(e, 'Falha ao consultar a config do webhook.'), 'danger');
  } finally { webhookInspecting.value = ''; }
}

const webhookEventsLoading = ref(false);
async function viewWebhookEvents() {
  webhookEventsLoading.value = true;
  try {
    const { data } = await api.get('/integrations/aiqfome/webhook/events');
    const evts = data.events || [];
    const fmt = (d) => d ? new Date(d).toLocaleString('pt-BR') : '—';
    const badge = (s) => s === 'PROCESSED' ? '🟢' : s === 'ERROR' ? '🔴' : '🟡';
    const rows = evts.length
      ? evts.map(e => `<tr>
          <td style="white-space:nowrap">${fmt(e.receivedAt)}</td>
          <td>${badge(e.status)} ${e.status}</td>
          <td>${e.event || '—'}</td>
          <td>${e.merchantId || '—'}</td>
          <td style="color:#dc3545">${e.error ? String(e.error).slice(0, 120) : ''}</td>
        </tr>`).join('')
      : '<tr><td colspan="5">Nenhum evento recebido ainda.</td></tr>';
    const latestPayload = evts[0]?.payload ? JSON.stringify(evts[0].payload, null, 2) : '(sem eventos)';
    await Swal.fire({
      title: 'Webhooks aiqfome recebidos',
      html: `<div style="overflow:auto"><table style="width:100%;font-size:12px;text-align:left">
        <thead><tr><th>Quando</th><th>Status</th><th>Evento</th><th>Merchant</th><th>Erro</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
        <details style="text-align:left;margin-top:10px"><summary style="cursor:pointer">Ver payload do evento mais recente</summary>
        <pre style="white-space:pre-wrap;font-size:11px;max-height:240px;overflow:auto">${latestPayload.replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]))}</pre></details>`,
      width: 760,
    });
  } catch (e) {
    showStatus(errDetail(e, 'Falha ao listar eventos.'), 'danger');
  } finally { webhookEventsLoading.value = false; }
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
  <div class="container py-4">
    <div class="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-4">
      <div class="d-flex align-items-center gap-3">
        <img src="https://aiqfome.com/favicon.ico" alt="aiqfome" style="height:36px" />
        <div>
          <h4 class="mb-0">Integração aiqfome</h4>
          <small class="text-muted">via aiqbridge</small>
        </div>
      </div>
      <span v-if="integrations.some(i => isActive(i))" class="badge bg-success px-3 py-2">
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
                  <div class="d-flex flex-wrap gap-2">
                    <div v-if="isActive(integ)" class="btn-group">
                      <button class="btn btn-sm btn-outline-success" @click="storeAction(integ, 'open')" :disabled="!!storeActionLoading" title="Abrir"><i class="bi bi-shop"></i></button>
                      <button class="btn btn-sm btn-outline-danger" @click="storeAction(integ, 'close')" :disabled="!!storeActionLoading" title="Fechar"><i class="bi bi-shop-window"></i></button>
                      <button class="btn btn-sm btn-outline-warning" @click="storeAction(integ, 'standby')" :disabled="!!storeActionLoading" title="Standby"><i class="bi bi-pause-circle"></i></button>
                    </div>
                    <button class="btn btn-sm btn-outline-info" @click="openMenuPanel(integ)" title="Cardápio vinculado">
                      <i class="bi bi-card-list"></i> Cardápio
                    </button>
                    <button v-if="isActive(integ)" class="btn btn-sm btn-outline-primary" @click="configureWebhook(integ)" :disabled="webhookConfiguring === integ.id" title="Registrar webhook no aiqbridge e ativar validação de assinatura">
                      <span v-if="webhookConfiguring === integ.id" class="spinner-border spinner-border-sm me-1"></span>
                      <i v-else class="bi bi-broadcast"></i> Registrar webhook
                    </button>
                    <button v-if="isActive(integ)" class="btn btn-sm btn-outline-secondary" @click="inspectWebhook(integ)" :disabled="webhookInspecting === integ.id" title="Ver config registrada no aiqbridge">
                      <span v-if="webhookInspecting === integ.id" class="spinner-border spinner-border-sm"></span>
                      <i v-else class="bi bi-search"></i>
                    </button>
                    <button v-if="isActive(integ)" class="btn btn-sm btn-outline-secondary" @click="testWebhook(integ)" :disabled="webhookTesting === integ.id" title="Disparar evento de teste nesta integração">
                      <span v-if="webhookTesting === integ.id" class="spinner-border spinner-border-sm"></span>
                      <i v-else class="bi bi-send"></i>
                    </button>
                    <button v-if="isActive(integ)" class="btn btn-sm btn-outline-danger" @click="disconnect(integ)"><i class="bi bi-x-circle"></i> Desconectar</button>
                    <button class="btn btn-sm btn-outline-secondary" @click="deleteInteg(integ)" title="Remover"><i class="bi bi-trash"></i></button>
                  </div>
                </div>

                <!-- Editor do cardápio vinculado (1 por integração, colapsável) -->
                <div v-if="expandedMenusId === integ.id" class="mt-3 pt-3 border-top">
                  <div class="fw-semibold small mb-2"><i class="bi bi-card-list me-1"></i>Cardápio vinculado a esta integração</div>
                  <div v-if="menus.length === 0" class="alert alert-light py-2 small mb-2">
                    Nenhum cardápio cadastrado. Crie um cardápio antes de vincular.
                  </div>
                  <div v-else style="max-width:480px">
                    <SelectInput v-model="menuForm.menuId">
                      <option :value="null">-- Selecione o cardápio --</option>
                      <option v-for="m in menus" :key="m.id" :value="m.id">{{ menuLabel(m) }}</option>
                    </SelectInput>
                  </div>
                  <div class="d-flex justify-content-between align-items-center mt-3">
                    <small class="text-muted"><i class="bi bi-info-circle me-1"></i>Os pedidos do aiqfome vão para a loja deste cardápio.</small>
                    <div class="d-flex gap-1">
                      <button class="btn btn-sm btn-outline-secondary" @click="expandedMenusId = null">Cancelar</button>
                      <button class="btn btn-sm btn-primary" @click="saveMenuLinks(integ)" :disabled="savingMenus">
                        <span v-if="savingMenus" class="spinner-border spinner-border-sm me-1"></span>Salvar
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div v-else class="alert alert-info">Nenhuma integração aiqfome configurada.</div>

        <!-- Webhook URL -->
        <div v-if="integrations.length > 0" class="card mb-3">
          <div class="card-body py-2 d-flex align-items-center flex-wrap gap-2">
            <i class="bi bi-globe text-primary"></i>
            <div class="flex-grow-1" style="min-width:0">
              <div class="small text-muted">URL do Webhook — use <strong>Registrar webhook</strong> (em cada integração) para configurar, ou cole no dashboard aiqbridge. <strong>Testar</strong> e <strong>Ver config</strong> ficam em cada integração.</div>
              <code class="small user-select-all" style="word-break:break-all">{{ webhookUrl }}</code>
            </div>
            <div class="ms-auto d-flex gap-1">
              <button class="btn btn-sm btn-outline-secondary" @click="viewWebhookEvents" :disabled="webhookEventsLoading" title="Ver todos os webhooks recebidos">
                <span v-if="webhookEventsLoading" class="spinner-border spinner-border-sm"></span>
                <i v-else class="bi bi-list-check"></i>
              </button>
              <button class="btn btn-sm btn-outline-secondary" @click="copyWebhook" title="Copiar"><i class="bi bi-clipboard"></i></button>
            </div>
          </div>
        </div>

        <button v-if="!showNewForm" class="btn btn-outline-primary" @click="openNewForm" :disabled="availableMenus.length === 0">
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
                <label class="form-label">Cardápio</label>
                <SelectInput v-model="newForm.menuId">
                  <option :value="null">-- Selecione --</option>
                  <option v-for="m in availableMenus" :key="m.id" :value="m.id">{{ menuLabel(m) }}</option>
                </SelectInput>
                <div class="form-text">A loja é definida pelo cardápio. Um cardápio por integração.</div>
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
