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
const menus = ref([]);

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

async function loadMenus() {
  try {
    const { data } = await api.get('/menu/menus');
    menus.value = Array.isArray(data) ? data : [];
  } catch (e) {
    console.warn('Falha ao carregar cardápios', e);
    menus.value = [];
  }
}

// ── Bootstrap modal de Atribuir/Reconfigurar instância ──
// Cada instância só pode estar vinculada a UM cardápio (Menu.whatsappInstanceId
// @unique), então o select é single. O modal exibe o vínculo atual no topo,
// lista quais opções estão em uso por outros cardápios (desabilita-as) e
// devolve 409 amigável se rolar conflito por race.
const assignModalState = ref({ open: false, instance: null, menuId: '', saving: false, error: '' });

// Calculado on-the-fly: pra cada menu, descobre se já tem outra instância
// linkada (consulta API quando o modal abre).
const menuLinkOwners = ref({}); // { [menuId]: 'instanceName' | null }

async function refreshMenuLinkOwners() {
  // /wa/instances já vem com menu populado por instância — inverte o índice.
  try {
    const { data } = await api.get('/wa/instances');
    const owners = {};
    for (const inst of (data || [])) {
      if (inst.menu?.id) owners[inst.menu.id] = inst.instanceName;
    }
    menuLinkOwners.value = owners;
  } catch (e) { menuLinkOwners.value = {}; }
}

async function openAssignModal(inst) {
  assignModalState.value = {
    open: true,
    instance: inst,
    menuId: inst.menu?.id || '',
    saving: false,
    error: '',
  };
  await refreshMenuLinkOwners();
}

function closeAssignModal() {
  if (assignModalState.value.saving) return;
  assignModalState.value.open = false;
  assignModalState.value.error = '';
}

async function submitAssignModal() {
  const st = assignModalState.value;
  if (!st.instance) return;
  st.saving = true;
  st.error = '';
  try {
    const body = st.menuId ? { menuIds: [st.menuId] } : { menuIds: [] };
    // menuIds vazio sinaliza "desvincular"; o backend hoje rejeita isso, então
    // pra desvincular precisamos chamar a UI do MenuEdit. Por enquanto exigimos
    // um cardápio selecionado.
    if (!st.menuId) {
      st.error = 'Selecione um cardápio para vincular.';
      st.saving = false;
      return;
    }
    await api.post(`/wa/instances/${encodeURIComponent(st.instance.instanceName)}/assign-menus`, body);
    st.open = false;
    await loadInstances();
    Swal.fire({ icon: 'success', title: 'Vínculo atualizado', toast: true, position: 'top-end', timer: 2000, showConfirmButton: false });
  } catch (err) {
    console.error('assign modal error:', err);
    if (err?.response?.status === 409) {
      st.error = err.response.data?.message || 'Este cardápio já tem outra instância vinculada.';
    } else {
      st.error = err?.response?.data?.message || err?.message || 'Falha ao salvar';
    }
  } finally {
    st.saving = false;
  }
}

// Compat: chamadas internas existentes (manageModal) continuam usando assignModal()
async function assignModal(inst) {
  await openAssignModal(inst);
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

  // Step 2: configuração + vínculo a UM cardápio (1:1 com schema @unique).
  // Busca o estado atual de vínculos pra desabilitar cardápios já em uso.
  await refreshMenuLinkOwners();
  const dispId = 'sw-create-display-name';
  const selId = 'sw-create-select-menu';
  const html = `
    <div class="mb-3 text-start"><strong>Instância:</strong> ${name}</div>
    <div class="mb-3 text-start"><label class="form-label">Nome exibido (opcional)</label>
      <input id="${dispId}" class="form-control" value="${name}" />
    </div>
    <div class="text-start"><label class="form-label">Cardápio vinculado</label>
      <select id="${selId}" class="form-select">
        <option value="">— Sem vínculo (atribuir depois) —</option>
        ${menus.value.map(m => {
          const owner = menuLinkOwners.value[m.id];
          const disabled = !!owner;
          const label = disabled ? `${m.name} — em uso por "${owner}"` : m.name;
          return `<option value="${m.id}" ${disabled ? 'disabled' : ''}>${label}</option>`;
        }).join('')}
      </select>
      <div class="form-text">Cada instância só pode atender um cardápio.</div>
    </div>
  `;

  const res = await Swal.fire({
    title: 'Configurar instância',
    html,
    showCancelButton: true,
    confirmButtonText: 'Criar',
    cancelButtonText: 'Cancelar',
    focusConfirm: false,
    preConfirm: () => {
      const displayName = document.getElementById(dispId).value || name;
      const menuId = document.getElementById(selId).value || null;
      return { displayName, menuId };
    }
  });
  if (!res || !res.isConfirmed) return;

  creating.value = true;
  try {
    // create instance
    await api.post('/wa/instances', { instanceName: name, displayName: res.value.displayName || name });
    // bind to a menu when picked
    if (res.value.menuId) {
      try {
        await api.post(`/wa/instances/${encodeURIComponent(name)}/assign-menus`, { menuIds: [res.value.menuId] });
      } catch (assignErr) {
        // não falha a criação se o vínculo conflitar — operador resolve depois
        console.warn('Vínculo opcional falhou (instância já criada):', assignErr?.response?.data || assignErr);
        await Swal.fire('Atenção', 'Instância criada, mas o vínculo com cardápio falhou: ' + (assignErr?.response?.data?.message || 'conflito'), 'warning');
      }
    }

    await loadInstances();
    selected.value = name;
    await fetchStatus();
    await fetchQr();
    startPolling();
    await Swal.fire('OK', 'Instância criada.', 'success');
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
  await loadMenus();
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
                  <div class="d-flex align-items-center gap-3 flex-wrap">
                    <div>
                      <div class="fw-semibold">{{ inst.displayName || inst.instanceName }}</div>
                      <div class="text-muted small">{{ inst.instanceName }} — {{ inst.status }}</div>
                    </div>
                    <span v-if="inst.status === 'CONNECTED'" class="badge bg-success">Conectado</span>
                    <span v-else class="badge bg-secondary">{{ inst.status || 'Desconectado' }}</span>
                    <span v-if="inst.menu" class="badge bg-info text-dark" :title="`Cardápio vinculado: ${inst.menu.name}`">
                      <i class="bi bi-card-list me-1"></i>{{ inst.menu.name }}
                    </span>
                    <span v-else class="badge bg-warning text-dark" title="Esta instância não está atendendo nenhum cardápio">
                      <i class="bi bi-exclamation-triangle me-1"></i>Sem cardápio
                    </span>
                  </div>
                    <div class="d-flex gap-2">
                    <button class="btn btn-sm btn-outline-secondary" @click="openAssignModal(inst)" title="Vincular a um cardápio">
                      <i class="bi bi-card-list"></i> Vincular
                    </button>
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

    <!-- ═══ Modal: Vincular cardápio à instância ═══ -->
    <!-- z-index 1100 fica acima do Swal Manage modal (1060) caso o operador
         abra esse fluxo de dentro do botão "Atribuir/Reconfigurar" do Gerenciar. -->
    <div v-if="assignModalState.open" class="modal d-block" tabindex="-1" role="dialog"
         @click.self="closeAssignModal" style="background:rgba(0,0,0,0.5);z-index:1100;">
      <div class="modal-dialog modal-dialog-centered" role="document">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">
              <i class="bi bi-card-list me-2"></i>Vincular cardápio
            </h5>
            <button type="button" class="btn-close" @click="closeAssignModal" :disabled="assignModalState.saving"></button>
          </div>
          <div class="modal-body">
            <div class="mb-3 small">
              <div><strong>Instância:</strong> {{ assignModalState.instance?.displayName || assignModalState.instance?.instanceName }}</div>
              <div class="text-muted">
                Vínculo atual:
                <span v-if="assignModalState.instance?.menu" class="badge bg-info text-dark">
                  {{ assignModalState.instance.menu.name }}
                </span>
                <span v-else class="text-warning"><i class="bi bi-exclamation-triangle me-1"></i>Nenhum</span>
              </div>
            </div>
            <div class="mb-3">
              <label class="form-label">Cardápio que esta instância vai atender</label>
              <select class="form-select" v-model="assignModalState.menuId" :disabled="assignModalState.saving">
                <option value="">— Selecione um cardápio —</option>
                <option
                  v-for="m in menus"
                  :key="m.id"
                  :value="m.id"
                  :disabled="!!menuLinkOwners[m.id] && menuLinkOwners[m.id] !== assignModalState.instance?.instanceName"
                >
                  {{ m.name }}<template v-if="menuLinkOwners[m.id] && menuLinkOwners[m.id] !== assignModalState.instance?.instanceName"> — em uso por "{{ menuLinkOwners[m.id] }}"</template>
                </option>
              </select>
              <div class="form-text">
                Cada instância só pode atender um cardápio. Opções desabilitadas já estão em uso por outras instâncias.
              </div>
            </div>
            <div v-if="assignModalState.error" class="alert alert-danger py-2 mb-0 small">
              <i class="bi bi-exclamation-triangle me-1"></i>{{ assignModalState.error }}
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-outline-secondary" @click="closeAssignModal" :disabled="assignModalState.saving">
              Cancelar
            </button>
            <button class="btn btn-primary" :disabled="assignModalState.saving || !assignModalState.menuId" @click="submitAssignModal">
              <span v-if="assignModalState.saving" class="spinner-border spinner-border-sm me-1"></span>
              Salvar vínculo
            </button>
          </div>
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