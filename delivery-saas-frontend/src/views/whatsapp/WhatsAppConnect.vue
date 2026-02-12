<script setup>
import { ref, onMounted } from 'vue';
import api from '../../api';
import Swal from 'sweetalert2'; // opcional (você já usa sweetalert2 no projeto)

const instances = ref([]);
const creating = ref(false);
const selected = ref(null);
const qrDataUrl = ref('');
const status = ref('');
const pollTimer = ref(null);

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

async function createInstance() {
  const name = prompt('Nome da instância (ex.: loja-01)');
  if (!name) return;
  creating.value = true;
  try {
    await api.post('/wa/instances', { instanceName: name, displayName: name });
    await loadInstances();
    selected.value = name;
    await fetchStatus();
    await fetchQr();
    startPolling();
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
  if (selected.value) {
    await fetchStatus();
    await fetchQr();
    startPolling();
  }
});
</script>

<template>
  <div class="container-sm py-4">
    <header class="d-flex align-items-center justify-content-between mb-4">
      <h2 class="h4 fw-semibold mb-0">Conectar WhatsApp (Evolution API)</h2>
      <div class="d-flex gap-2">
        <button class="btn btn-primary" :disabled="creating" @click="createInstance">
          + Nova instância
        </button>
        <button v-if="selected" class="btn btn-danger" @click="removeInstance">
          🗑 Remover
        </button>
      </div>
    </header>

    <div class="card">
      <div class="card-body">
        <!-- Linha de seleção e status -->
        <div v-if="instances.length > 0" class="d-flex flex-wrap align-items-center gap-3 mb-3">
          <label class="form-label mb-0">Instância:</label>
          <SelectInput   v-model="selected"  class="form-select w-auto">
            <option v-for="i in instances" :key="i.id" :value="i.instanceName">
              {{ i.displayName || i.instanceName }} — {{ i.status }}
            </option>
          </SelectInput>
          <button class="btn btn-outline-secondary" @click="fetchStatus">Atualizar status</button>
        </div>
        <div v-else class="mb-3 text-secondary">
          Nenhuma instância criada. Crie uma para começar.
        </div>

        <div v-if="selected" class="row g-4">
          <!-- Coluna esquerda: instruções em formato WhatsApp -->
          <div class="col-12 col-md-7">
            <h3 class="h5 mb-3">Etapas para acessar</h3>

            <div class="wa-steps">
              <div class="wa-step">
                <div class="step-num">1</div>
                <div class="step-text">Abra o WhatsApp no seu celular.</div>
              </div>

              <div class="wa-step">
                <div class="step-num">2</div>
                <div class="step-text">Toque em <b>Mais opções</b> • no Android ou em <b>Configurações</b> ⚙️ no iPhone.</div>
              </div>

              <div class="wa-step">
                <div class="step-num">3</div>
                <div class="step-text">Toque em <b>Dispositivos conectados</b> e, em seguida, em <b>Conectar dispositivo</b>.</div>
              </div>

              <div class="wa-step">
                <div class="step-num">4</div>
                <div class="step-text">Escaneie o QR code para confirmar.</div>
              </div>

              <!-- Removed persistent-login checkbox and phone-entry link per request -->

              <div class="mt-4">
                <p class="mb-2 text-muted"><b class="text-dark">Dicas</b></p>
                <ul class="ms-3">
                  <li>Mantenha o aparelho conectado à internet.</li>
                  <li>Evite abrir o WhatsApp Web em outros PCs ao mesmo tempo.</li>
                  <li>Se o status travar em <i>QRCODE/PAIRING</i>, recarregue o QR.</li>
                </ul>
              </div>
            </div>
          </div>

          <!-- Coluna direita: QR centralizado -->
          <div class="col-12 col-md-5 d-flex flex-column align-items-center justify-content-center">
            <div class="small text-muted mb-2 text-center">
              Status: <b class="text-dark">{{ status || '...' }}</b>
            </div>

            <div v-if="status === 'CONNECTED'" class="text-success fw-medium mb-3">
              Conectado ✓
            </div>

            <div v-else-if="status === 'QRCODE' || status === 'PAIRING'" class="text-warning fw-medium mb-3">
              Aguardando leitura do QR
            </div>

            <div v-else class="text-secondary fw-medium mb-3">
              Aguardando...
            </div>

            <div v-if="status !== 'CONNECTED'" class="qr-box mb-3 d-flex align-items-center justify-content-center">
              <img
                v-if="qrDataUrl"
                :src="qrDataUrl || undefined"
                alt="QR"
                class="qr-image"
              />
              <div v-else class="small text-secondary">
                QR não disponível. Clique em “Carregar QR”.
              </div>
            </div>

            <div class="d-flex gap-2">
              <button class="btn btn-outline-secondary" @click="fetchQr" :disabled="status === 'CONNECTED'">
                Carregar QR
              </button>
              <button class="btn btn-outline-secondary" @click="fetchStatus">
                Atualizar Status
              </button>
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