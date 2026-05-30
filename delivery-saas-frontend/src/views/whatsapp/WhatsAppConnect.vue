<script setup>
import { ref, onMounted, onBeforeUnmount, computed } from 'vue';
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

onBeforeUnmount(() => {
  stopPolling();
  stopManagePoll();
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

// ── Bootstrap modal de Gerenciar instância ──
// Estado totalmente reativo: status e QR vão para refs e o template renderiza,
// sem manipulação de DOM no didOpen. Status auto-atualiza a cada 3s enquanto
// o modal estiver aberto e a instância NÃO estiver CONNECTED; quando conecta,
// o QR some e a UI mostra um banner verde.
const manageModalState = ref({
  open: false,
  instance: null,
  status: '...',
  qrUrl: '',
  loadingStatus: false,
  loadingQr: false,
});
let manageModalPollTimer = null;

async function fetchManageStatus() {
  const inst = manageModalState.value.instance;
  if (!inst) return;
  manageModalState.value.loadingStatus = true;
  try {
    const { data } = await api.get(`/wa/instances/${encodeURIComponent(inst.instanceName)}/status`);
    manageModalState.value.status = data.status || 'UNKNOWN';
  } catch (e) {
    console.warn('fetchManageStatus failed', e?.message || e);
    manageModalState.value.status = 'UNKNOWN';
  } finally {
    manageModalState.value.loadingStatus = false;
  }
}

async function fetchManageQr() {
  const inst = manageModalState.value.instance;
  if (!inst) return;
  manageModalState.value.loadingQr = true;
  try {
    const resp = await api.get(`/wa/instances/${encodeURIComponent(inst.instanceName)}/qr`, {
      validateStatus: () => true,
      headers: { 'Cache-Control': 'no-cache' },
    });
    if (resp.status === 204) { manageModalState.value.qrUrl = ''; return; }
    if (resp.status >= 400) { manageModalState.value.qrUrl = ''; return; }
    const rawQr = resp.data?.dataUrl || resp.data?.qrcode || resp.data;
    manageModalState.value.qrUrl = normalizeQrUrl(rawQr);
  } catch (e) {
    console.warn('fetchManageQr failed', e?.message || e);
    manageModalState.value.qrUrl = '';
  } finally {
    manageModalState.value.loadingQr = false;
  }
}

function stopManagePoll() {
  if (manageModalPollTimer) { clearInterval(manageModalPollTimer); manageModalPollTimer = null; }
}

function startManagePoll() {
  stopManagePoll();
  manageModalPollTimer = setInterval(async () => {
    if (!manageModalState.value.open) { stopManagePoll(); return; }
    await fetchManageStatus();
    if (manageModalState.value.status === 'CONNECTED') {
      manageModalState.value.qrUrl = '';
    } else if (!manageModalState.value.qrUrl) {
      await fetchManageQr();
    }
  }, 3000);
}

async function openManageModal(inst) {
  manageModalState.value = {
    open: true,
    instance: inst,
    status: inst.status || '...',
    qrUrl: '',
    loadingStatus: false,
    loadingQr: false,
  };
  await fetchManageStatus();
  if (manageModalState.value.status !== 'CONNECTED') await fetchManageQr();
  startManagePoll();
}

function closeManageModal() {
  stopManagePoll();
  manageModalState.value.open = false;
}

async function manageDeleteInstance() {
  const inst = manageModalState.value.instance;
  if (!inst) return;
  await deleteInstance(inst);
  closeManageModal();
}

async function manageOpenAssign() {
  const inst = manageModalState.value.instance;
  if (!inst) return;
  await openAssignModal(inst);
}

// Wrapper backward-compat: callers existentes (botão Gerenciar do card) e o
// próprio assignModal usam esse nome.
async function manageModal(inst) {
  await openManageModal(inst);
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

    <!-- ═══ Modal: Gerenciar instância (status + QR + ações) ═══ -->
    <div v-if="manageModalState.open" class="modal d-block" tabindex="-1" role="dialog"
         @click.self="closeManageModal" style="background:rgba(0,0,0,0.5)">
      <div class="modal-dialog modal-lg modal-dialog-centered" role="document">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">
              <i class="bi bi-whatsapp text-success me-2"></i>{{ manageModalState.instance?.displayName || manageModalState.instance?.instanceName }}
              <span v-if="manageModalState.instance?.menu" class="badge bg-info text-dark ms-2" style="font-size:0.7rem;font-weight:500">
                <i class="bi bi-card-list me-1"></i>{{ manageModalState.instance.menu.name }}
              </span>
              <span v-else class="badge bg-warning text-dark ms-2" style="font-size:0.7rem;font-weight:500">
                Sem cardápio
              </span>
            </h5>
            <button type="button" class="btn-close" @click="closeManageModal"></button>
          </div>
          <div class="modal-body">
            <!-- Banner verde quando CONNECTED -->
            <div v-if="manageModalState.status === 'CONNECTED'" class="alert alert-success d-flex align-items-center mb-3">
              <i class="bi bi-check-circle-fill me-2 fs-5"></i>
              <div>
                <div class="fw-semibold">WhatsApp conectado</div>
                <div class="small">Esta instância está pronta para enviar e receber mensagens.</div>
              </div>
            </div>

            <div class="row g-3">
              <!-- Coluna esquerda: passos -->
              <div class="col-md-7">
                <div class="text-muted small mb-2">PARA CONECTAR</div>
                <ol class="mc-steps">
                  <li><i class="bi bi-phone me-1"></i>Abra o WhatsApp no seu celular.</li>
                  <li>Toque em <strong>Mais opções</strong> (⋮) no Android ou em <strong>Configurações</strong> no iPhone.</li>
                  <li>Toque em <strong>Dispositivos conectados</strong> e depois em <strong>Conectar dispositivo</strong>.</li>
                  <li>Escaneie o QR ao lado para confirmar.</li>
                </ol>
                <div class="mt-3 small text-muted">
                  <strong class="d-block text-dark mb-1">Dicas</strong>
                  <ul class="mb-0 ps-3">
                    <li>Mantenha o aparelho conectado à internet.</li>
                    <li>Evite abrir o WhatsApp Web em outros PCs ao mesmo tempo.</li>
                    <li>Se o status travar em <em>QRCODE/PAIRING</em>, clique em <em>Carregar QR</em>.</li>
                  </ul>
                </div>
              </div>

              <!-- Coluna direita: status + QR + ações -->
              <div class="col-md-5">
                <div class="mc-status-box mb-2">
                  <div class="d-flex align-items-center justify-content-between mb-2">
                    <span class="text-muted small">Status</span>
                    <button class="btn btn-link btn-sm p-0" @click="fetchManageStatus" :disabled="manageModalState.loadingStatus" title="Atualizar status">
                      <i class="bi bi-arrow-clockwise" :class="{ 'mc-spin': manageModalState.loadingStatus }"></i>
                    </button>
                  </div>
                  <div class="fw-bold" :class="manageModalState.status === 'CONNECTED' ? 'text-success' : 'text-warning'">
                    {{ manageModalState.status }}
                  </div>
                </div>

                <div v-if="manageModalState.status !== 'CONNECTED'" class="mc-qr-box">
                  <div v-if="manageModalState.qrUrl">
                    <img :src="manageModalState.qrUrl" alt="QR Code" class="mc-qr-image" />
                  </div>
                  <div v-else-if="manageModalState.loadingQr" class="text-center text-muted py-4">
                    <div class="spinner-border spinner-border-sm me-1"></div>
                    Carregando QR...
                  </div>
                  <div v-else class="text-center text-muted py-4 small">
                    <i class="bi bi-qr-code fs-1 d-block mb-2 text-secondary"></i>
                    QR não disponível
                  </div>
                  <button class="btn btn-outline-secondary btn-sm w-100 mt-2" @click="fetchManageQr" :disabled="manageModalState.loadingQr">
                    <i class="bi bi-arrow-clockwise me-1"></i>Carregar QR
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div class="modal-footer d-flex justify-content-between">
            <button class="btn btn-outline-danger btn-sm" @click="manageDeleteInstance">
              <i class="bi bi-trash me-1"></i>Remover instância
            </button>
            <div class="d-flex gap-2">
              <button class="btn btn-outline-secondary btn-sm" @click="closeManageModal">Fechar</button>
              <button class="btn btn-primary btn-sm" @click="manageOpenAssign">
                <i class="bi bi-card-list me-1"></i>Vincular cardápio
              </button>
            </div>
          </div>
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

/* Manage modal — passos numerados, status box, QR */
.mc-steps {
  list-style: none;
  counter-reset: mc;
  padding-left: 0;
  margin: 0;
}
.mc-steps li {
  counter-increment: mc;
  position: relative;
  padding: 6px 0 6px 36px;
  font-size: 0.9rem;
  line-height: 1.35;
}
.mc-steps li::before {
  content: counter(mc);
  position: absolute;
  left: 0;
  top: 4px;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 2px solid #1f7a5a;
  color: #0b6b52;
  background: #fff;
  font-weight: 700;
  font-size: 0.8rem;
  display: flex;
  align-items: center;
  justify-content: center;
}
.mc-status-box {
  background: #f8f9fa;
  border: 1px solid #e9ecef;
  border-radius: 8px;
  padding: 10px 12px;
}
.mc-qr-box {
  background: #fff;
  border: 1px solid #e9ecef;
  border-radius: 8px;
  padding: 12px;
  text-align: center;
}
.mc-qr-image {
  width: 100%;
  max-width: 240px;
  height: auto;
  display: block;
  margin: 0 auto;
}
.mc-spin {
  animation: mc-rot 0.8s linear infinite;
  display: inline-block;
}
@keyframes mc-rot {
  to { transform: rotate(360deg); }
}
</style>