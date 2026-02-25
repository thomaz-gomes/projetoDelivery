<script setup>
import { ref, onMounted, computed } from 'vue';
import api from '../../api';
import Swal from 'sweetalert2'; // opcional (você já usa sweetalert2 no projeto)

const instances = ref([]);
const creating = ref(false);
const selected = ref(null);
const qrDataUrl = ref('');
const status = ref('');
const pollTimer = ref(null);
const evolutionEnabled = ref(false);
const stores = ref([]);

// --- Normalizador robusto para data URL do QR ---
function normalizeQrUrl(raw) {
  if (!raw) return '';

  if (typeof raw === 'object') {
    if (raw.dataUrl) return normalizeQrUrl(raw.dataUrl);
    if (raw.qrcode)  return normalizeQrUrl(raw.qrcode);
    if (raw.base64)  return `data:image/png;base64,${raw.base64}`;
    if (raw.data && raw.type?.includes('image')) return `data:${raw.type};base64,${raw.data}`;
  }

  let s = String(raw).trim();
  const idx = s.lastIndexOf('data:image');
  if (idx > 0) s = s.slice(idx);
  if (!s.startsWith('data:image')) {
    if (s.startsWith('image/')) s = 'data:' + s;
    else if (/^[A-Za-z0-9+/=]+$/.test(s)) s = 'data:image/png;base64,' + s;
  }

  return s;
}

async function loadInstances() {
  const { data } = await api.get('/wa/instances');
  instances.value = data;
  if (!selected.value && data.length) selected.value = data[0].instanceName;
}

async function loadStores() {
  try {
    const { data } = await api.get('/stores');
    stores.value = data || [];
  } catch (e) {
    console.warn('Falha ao carregar lojas', e);
    stores.value = [];
  }
}

// (inline wizard removed; use modal flows instead)

async function assignModal(inst) {
  const selId = 'sw-select-stores';
  const chkId = 'sw-assign-all';
  const html = `
    <div class="mb-2"><strong>Instância:</strong> ${inst.instanceName}</div>
    <div class="form-check mb-2"><input id="${chkId}" class="form-check-input" type="checkbox" /> <label class="form-check-label">Atribuir a todas as lojas</label></div>
    <div><label class="form-label">Escolha lojas (Ctrl/Cmd+click para múltipla)</label>
      <select id="${selId}" multiple style="width:100%;min-height:150px;">
        ${stores.value.map(s => `<option value="${s.id}">${s.name}</option>`).join('')}
      </select>
    </div>
  `;

  const result = await Swal.fire({
    title: 'Atribuir/Reconfigurar instância',
    html,
    showCancelButton: true,
    confirmButtonText: 'Atribuir',
    focusConfirm: false,
    preConfirm: () => {
      const all = document.getElementById(chkId).checked;
      const sel = Array.from(document.getElementById(selId).selectedOptions || []).map(o => o.value);
      if (!all && sel.length === 0) {
        Swal.showValidationMessage('Selecione ao menos uma loja ou marque "Atribuir a todas as lojas"');
        return false;
      }
      return { all, storeIds: sel };
    }
  });

  if (!result || !result.isConfirmed) return;
  const body = result.value.all ? { all: true } : { storeIds: result.value.storeIds };
  try {
    await api.post(`/wa/instances/${encodeURIComponent(inst.instanceName)}/assign-stores`, body);
    await Swal.fire('OK', 'Atribuição realizada com sucesso', 'success');
    await loadInstances();
  } catch (err) {
    console.error('Erro ao atribuir lojas via modal:', err);
    if (err?.response?.status === 409) {
      const conflicts = err.response.data?.conflictStoreIds || [];
      await Swal.fire('Conflito', `Algumas lojas já têm outra instância atribuída: ${conflicts.join(', ')}`, 'warning');
    } else {
      await Swal.fire('Erro', err?.response?.data?.message || err?.message || 'Falha ao atribuir lojas', 'error');
    }
  }
}

async function createInstance() {
  // Step 1: ask for instance name
  const { value: name } = await Swal.fire({
    title: 'Nova instância',
    input: 'text',
    inputLabel: 'Nome da instância (ex.: loja-01)',
    inputPlaceholder: 'loja-01',
    showCancelButton: true,
    confirmButtonText: 'Próximo',
    cancelButtonText: 'Cancelar',
    inputValidator: (v) => {
      if (!v || !String(v).trim()) return 'Informe um nome válido';
      return null;
    }
  });
  if (!name) return;

  // Step 2: configuration + assign
  const selId = 'sw-create-select-stores';
  const dispId = 'sw-create-display-name';
  const chkId = 'sw-create-assign-all';
  const html = `
    <div class="mb-2"><strong>Instância:</strong> ${name}</div>
    <div class="mb-3"><label class="form-label">Nome exibido (opcional)</label>
      <input id="${dispId}" class="form-control" value="${name}" />
    </div>
    <div class="form-check mb-2"><input id="${chkId}" class="form-check-input" type="checkbox" /> <label class="form-check-label">Atribuir a todas as lojas</label></div>
    <div><label class="form-label">Escolha lojas (Ctrl/Cmd+click para múltipla)</label>
      <select id="${selId}" multiple style="width:100%;min-height:150px;">
        ${stores.value.map(s => `<option value="${s.id}">${s.name}</option>`).join('')}
      </select>
    </div>
  `;

  const res = await Swal.fire({
    title: 'Configurar instância',
    html,
    showCancelButton: true,
    confirmButtonText: 'Criar e atribuir',
    cancelButtonText: 'Cancelar',
    focusConfirm: false,
    preConfirm: () => {
      const displayName = document.getElementById(dispId).value || name;
      const all = document.getElementById(chkId).checked;
      const sel = Array.from(document.getElementById(selId).selectedOptions || []).map(o => o.value);
      if (!all && sel.length === 0) {
        Swal.showValidationMessage('Selecione ao menos uma loja ou marque "Atribuir a todas as lojas"');
        return false;
      }
      return { displayName, all, storeIds: sel };
    }
  });
  if (!res || !res.isConfirmed) return;

  creating.value = true;
  try {
    // create instance
    await api.post('/wa/instances', { instanceName: name, displayName: res.value.displayName || name });
    // assign stores
    if (res.value.all) {
      await api.post(`/wa/instances/${encodeURIComponent(name)}/assign-stores`, { all: true });
    } else if (res.value.storeIds && res.value.storeIds.length) {
      await api.post(`/wa/instances/${encodeURIComponent(name)}/assign-stores`, { storeIds: res.value.storeIds });
    }

    await loadInstances();
    selected.value = name;
    await fetchStatus();
    await fetchQr();
    startPolling();
    await Swal.fire('OK', 'Instância criada e atribuída.', 'success');
  } catch (err) {
    console.error('Erro ao criar instância:', err);
    const msg = err?.response?.data?.message || err?.message || 'Erro interno ao criar instância';
    await Swal.fire('Erro', String(msg), 'error');
  } finally {
    creating.value = false;
  }

}

async function fetchQr() {
  if (!selected.value) return;
  if (status.value === 'CONNECTED') { qrDataUrl.value = ''; return; }

  const resp = await api.get(`/wa/instances/${encodeURIComponent(selected.value)}/qr`, {
    validateStatus: () => true,
    headers: { 'Cache-Control': 'no-cache' },
  });

  if (resp.status === 204) { status.value = 'CONNECTED'; qrDataUrl.value = ''; return; }
  if (resp.status >= 400) { console.warn('Falha ao obter QR:', resp.data); qrDataUrl.value = ''; return; }

  const rawQr = resp.data?.dataUrl || resp.data?.qrcode || resp.data;
  qrDataUrl.value = normalizeQrUrl(rawQr);
}

async function fetchStatus() {
  if (!selected.value) return;
  const { data } = await api.get(`/wa/instances/${encodeURIComponent(selected.value)}/status`);
  status.value = data.status || 'UNKNOWN';
  if (status.value === 'CONNECTED') qrDataUrl.value = '';
}

// Load WhatsApp related settings (e.g. notification toggle)
async function loadSettings() {
  try {
    const { data } = await api.get('/wa/settings');
    // backend returns { evolutionEnabled: boolean } (or similar)
    evolutionEnabled.value = !!data?.evolutionEnabled;
  } catch (e) {
    console.warn('Falha ao carregar settings WhatsApp', e);
  }
}

// Remove a specific instance (used from card and modal)
async function deleteInstance(inst) {
  const res = await Swal.fire({
    title: 'Remover instância',
    text: `Remover a instância "${inst.instanceName}"? Esta ação não pode ser desfeita.`,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'Sim, remover',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#dc3545',
  });
  if (!res || !res.isConfirmed) return;
  try {
    await api.delete(`/wa/instances/${encodeURIComponent(inst.instanceName)}`);
    await loadInstances();
    if (selected.value === inst.instanceName) { selected.value = instances.value[0]?.instanceName || null; }
    await Swal.fire('Removida', 'Instância removida.', 'success');
  } catch (e) {
    console.error('deleteInstance failed', e);
    await Swal.fire('Erro', 'Falha ao remover instância', 'error');
  }
}

async function removeInstance() {
  if (!selected.value) return;

  const confirm = await Swal.fire({
    title: 'Remover instância?',
    text: `Tem certeza que deseja remover a instância ${selected.value}?`,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'Sim, remover',
    cancelButtonText: 'Cancelar',
  });

  if (!confirm.isConfirmed) return;

  try {
    await api.delete(`/wa/instances/${encodeURIComponent(selected.value)}`);
    await Swal.fire('Removida!', 'Instância removida com sucesso.', 'success');
    // Atualiza lista e limpa estado
    await loadInstances();
    selected.value = instances.value[0]?.instanceName || null;
    qrDataUrl.value = '';
    status.value = '';
  } catch (err) {
    console.error('Erro ao remover instância:', err);
    await Swal.fire('Erro', 'Falha ao remover instância.', 'error');
  }
}

function startPolling() {
  stopPolling();
  pollTimer.value = setInterval(async () => {
    await fetchStatus();
    if (status.value === 'CONNECTED') {
      stopPolling();
      qrDataUrl.value = '';
    } else if (!qrDataUrl.value) {
      await fetchQr();
    }
  }, 3000);
}

function stopPolling() {
  if (pollTimer.value) {
    clearInterval(pollTimer.value);
    pollTimer.value = null;
  }
}

onMounted(async () => {
  await loadInstances();
  await loadSettings();
  await loadStores();
  if (selected.value) {
    await fetchStatus();
    await fetchQr();
    startPolling();
  }
});

// assignStores removed; use modal-based assignModal(inst) instead

async function toggleEvolution(next) {
  if (typeof next === 'undefined') next = !evolutionEnabled.value;
  const prev = !next;
  try {
    const { data } = await api.put('/wa/settings', { evolutionEnabled: next });
    evolutionEnabled.value = !!data.evolutionEnabled;
    await Swal.fire('OK', `${evolutionEnabled.value ? 'Notificação ativada' : 'Notificação desativada'}`, 'success');
  } catch (e) {
    console.error('Falha ao atualizar toggle Evolution', e);
    // revert UI to previous state
    evolutionEnabled.value = prev;
    await Swal.fire('Erro', e?.response?.data?.message || 'Falha ao atualizar', 'error');
  }
}

// Per-instance management modal: shows status, QR and controls
async function manageModal(inst) {
  const name = inst.instanceName;

  async function fetchQrFor() {
    const resp = await api.get(`/wa/instances/${encodeURIComponent(name)}/qr`, {
      validateStatus: () => true,
      headers: { 'Cache-Control': 'no-cache' },
    });
    if (resp.status === 204) return null;
    if (resp.status >= 400) throw new Error('Falha ao obter QR');
    const rawQr = resp.data?.dataUrl || resp.data?.qrcode || resp.data;
    return normalizeQrUrl(rawQr);
  }

  async function fetchStatusFor() {
    const { data } = await api.get(`/wa/instances/${encodeURIComponent(name)}/status`);
    return data.status || 'UNKNOWN';
  }

  let statusText = '...';
  let qrUrl = null;
  try { statusText = await fetchStatusFor(); } catch (_) { statusText = 'UNKNOWN'; }
  try { qrUrl = await fetchQrFor(); } catch (_) { qrUrl = null; }
  const stepsHtml = `
    <div style="display:flex;flex-direction:column;gap:12px;font-family:inherit;color:#222;">
      ${["Abra o WhatsApp no seu celular.",
         "Toque em <b>Mais opções</b> • no Android ou em <b>Configurações</b> no iPhone.",
         "Toque em <b>Dispositivos conectados</b> e, em seguida, em <b>Conectar dispositivo</b>.",
         "Escaneie o QR code para confirmar."].map((text, idx) => `
        <div style="display:flex;gap:12px;align-items:flex-start;">
          <div style="min-width:36px;min-height:36px;border-radius:50%;border:2px solid #1f7a5a;color:#0b6b52;display:flex;align-items:center;justify-content:center;font-weight:700;background:#fff;box-shadow:none;">${idx+1}</div>
          <div style="line-height:1.3;">${text}</div>
        </div>
      `).join('')}

      <div style="margin-top:8px;color:#6c757d;">
        <strong style="color:#222;display:block;margin-bottom:6px;">Dicas</strong>
        <ul style="margin:0;padding-left:20px;color:#6c757d;">
          <li>Mantenha o aparelho conectado à internet.</li>
          <li>Evite abrir o WhatsApp Web em outros PCs ao mesmo tempo.</li>
          <li>Se o status travar em <i>QRCODE/PAIRING</i>, recarregue o QR.</li>
        </ul>
      </div>
    </div>
  `;

  const html = `
    <div style="display:flex;gap:16px;flex-wrap:wrap;">
      <div style="flex:1;min-width:260px;">${stepsHtml}</div>
      <div style="width:320px;flex:0 0 320px;">
        <div><div class="mb-2">Status: <strong id="sw-status">${statusText}</strong></div></div>
        <div id="sw-qr-box" class="mt-2">${qrUrl ? `<img id="sw-qr-img" src="${qrUrl}" style="max-width:280px;" />` : '<div class="text-muted">QR não disponível</div>'}</div>
        <div class="mt-3 d-flex gap-2">
          <button id="sw-btn-fetch-qr" class="btn btn-outline-secondary btn-sm">Carregar QR</button>
          <button id="sw-btn-fetch-status" class="btn btn-outline-secondary btn-sm">Atualizar status</button>
        </div>
        <div class="mt-2 d-flex gap-2">
          <button id="sw-btn-assign" class="btn btn-primary btn-sm">Atribuir/Reconfigurar</button>
          <button id="sw-btn-remove" class="btn btn-danger btn-sm">Remover</button>
        </div>
      </div>
    </div>
  `;

  await Swal.fire({
    title: inst.displayName || inst.instanceName,
    html,
    showCloseButton: true,
    showConfirmButton: false,
    width: '900px',
    didOpen: () => {
      const btnQr = document.getElementById('sw-btn-fetch-qr');
      const btnStatus = document.getElementById('sw-btn-fetch-status');
      const btnAssign = document.getElementById('sw-btn-assign');
      const btnRemove = document.getElementById('sw-btn-remove');

      btnQr?.addEventListener('click', async () => {
        btnQr.disabled = true;
        try {
          const q = await fetchQrFor();
          const box = document.getElementById('sw-qr-box');
          box.innerHTML = q ? `<img id="sw-qr-img" src="${q}" style="max-width:280px;" />` : '<div class="text-muted">QR não disponível</div>';
        } catch (e) {
          console.error('fetchQrFor failed', e);
          Swal.showValidationMessage('Falha ao carregar QR');
        } finally { btnQr.disabled = false; }
      });

      btnStatus?.addEventListener('click', async () => {
        btnStatus.disabled = true;
        try {
          const s = await fetchStatusFor();
          const el = document.getElementById('sw-status');
          if (el) el.textContent = s;
        } catch (e) { console.error('fetchStatusFor failed', e); }
        finally { btnStatus.disabled = false; }
      });

      btnAssign?.addEventListener('click', async () => {
        await assignModal(inst);
        // refresh status/qr in modal
        try { const s = await fetchStatusFor(); const el = document.getElementById('sw-status'); if (el) el.textContent = s; } catch (_) {}
        try { const q = await fetchQrFor(); const box = document.getElementById('sw-qr-box'); if (box) box.innerHTML = q ? `<img id="sw-qr-img" src="${q}" style="max-width:280px;" />` : '<div class="text-muted">QR não disponível</div>'; } catch (_) {}
      });

      btnRemove?.addEventListener('click', async () => {
        await deleteInstance(inst);
        Swal.close();
      });
    }
  });
}
</script>

<template>
  <div class="container-sm py-4">
    <div class="d-flex align-items-center justify-content-between mb-4">
      <div class="d-flex align-items-center gap-3">
        <h4 class="mb-0">Conectar WhatsApp</h4>
      </div>
      <div class="d-flex align-items-center gap-2">
        <span v-if="instances.some(i => i.status === 'CONNECTED')" class="badge bg-success fs-6 px-3 py-2">
          {{ instances.filter(i => i.status === 'CONNECTED').length }} conectado(s)
        </span>
        <button class="btn btn-outline-primary" @click="createInstance">
          <i class="bi bi-plus-circle"></i> Adicionar nova instância
        </button>
        <div class="form-check form-switch d-flex align-items-center gap-2">
          <input class="form-check-input" type="checkbox" id="wa-notify-switch" v-model="evolutionEnabled" @change="toggleEvolution(evolutionEnabled)" />
          <label class="form-check-label mb-0" for="wa-notify-switch">Ativar notificação</label>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-body">
        <!-- Lista de instâncias (cards) -->
        <div v-if="instances.length > 0" class="mb-3">
          <h6 class="text-muted mb-3">Instâncias configuradas</h6>
          <div class="d-flex flex-column gap-2">
            <div v-for="inst in instances" :key="inst.id" class="card" :class="inst.status === 'CONNECTED' ? 'border-success' : 'border-secondary'">
              <div class="card-body py-3">
                <div class="d-flex align-items-center justify-content-between flex-wrap gap-2">
                  <div class="d-flex align-items-center gap-3">
                    <div>
                      <div class="fw-semibold">{{ inst.displayName || inst.instanceName }}</div>
                      <div class="text-muted small">{{ inst.instanceName }} — {{ inst.status }}</div>
                    </div>
                    <span v-if="inst.status === 'CONNECTED'" class="badge bg-success">Conectado</span>
                    <span v-else class="badge bg-secondary">{{ inst.status || 'Desconectado' }}</span>
                  </div>
                    <div class="d-flex gap-2">
                    <button class="btn btn-sm btn-outline-primary" @click="manageModal(inst)">Gerenciar</button>
                    <button class="btn btn-sm btn-outline-danger" @click="deleteInstance(inst)">Remover</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div v-else class="alert alert-info">Nenhuma instância criada ainda.</div>

        <div v-if="selected" class="row g-4">
          <div class="col-12">
            <div class="alert alert-secondary">
              Abra <strong>Gerenciar</strong> na lista de instâncias para ver as instruções passo a passo e o QR code no modal.
            </div>
          </div>
        </div>

        <div v-else-if="instances.length > 0" class="text-secondary">
          Nenhuma instância selecionada. Crie uma para começar.
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* WhatsApp-style steps & QR layout */
.wa-steps { display: flex; flex-direction: column; gap: 1rem; }
.wa-step { display: flex; gap: 1rem; align-items: flex-start; }
.step-num {
  min-width: 36px; min-height: 36px; border-radius: 50%;
  border: 2px solid #1f7a5a; color: #0b6b52; display: inline-flex;
  align-items: center; justify-content: center; font-weight: 700;
  background: #fff; box-shadow: none;
}
.step-text { color: #222; line-height: 1.25; }
/* removed .wa-continue checkbox rule (element removed) */
.qr-box {
  width: 100%; max-width: 320px; height: auto; padding: 12px; border-radius: 12px;
  background: #fff; border: 1px solid #e9ecef; box-shadow: 0 1px 2px rgba(0,0,0,0.03);
}
.qr-image { width: 100%; height: auto; max-width: 280px; object-fit: contain; display: block; }

/* Responsive tweaks */
@media (max-width: 767px) {
  .step-num { min-width: 32px; min-height: 32px; }
  .qr-box { max-width: 220px; }
}
</style>