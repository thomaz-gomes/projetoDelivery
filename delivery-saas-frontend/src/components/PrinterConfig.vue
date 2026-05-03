<template>
  <teleport to="body">
    <div v-if="visible" class="modal-backdrop">
      <div class="modal-dialog modal-lg modal-centered">
        <div class="modal-content p-3">

          <div class="modal-header">
            <h5 class="modal-title">Impressão Térmica</h5>
            <button type="button" class="btn-close" @click="close"></button>
          </div>

          <div class="modal-body">
            <!-- Header: status badge -->
            <div class="d-flex align-items-center gap-2 mb-3">
              <span class="badge rounded-pill"
                    :class="agentConnected ? 'bg-success' : 'bg-secondary'">
                {{ agentConnected ? '● Conectado' : '○ Desconectado' }}
              </span>
            </div>

            <!-- ─── Agente de Impressão ────────────────────────────────────── -->
            <div>

              <!-- Barra superior: URL + Baixar -->
              <div class="d-flex align-items-start gap-3 mb-3">
                <div class="info-box flex-grow-1">
                  <div class="small text-muted mb-1">URL do servidor (informar ao agente)</div>
                  <code class="user-select-all small">{{ currentServerUrl }}</code>
                </div>
                <button type="button" class="btn btn-sm btn-outline-success flex-shrink-0"
                        @click="showAgentModal = true">
                  ⬇ Baixar Agente
                </button>
              </div>

              <!-- Estado: CONECTADO -->
              <div v-if="agentConnected" class="agent-connected-box mb-3">
                <div class="fw-bold mb-2">✅ Agente conectado</div>
                <div class="small text-muted mb-2">Impressoras detectadas:</div>
                <div class="d-flex flex-wrap gap-2">
                  <span v-for="p in printers" :key="typeof p === 'string' ? p : p.name" class="printer-chip">
                    {{ typeof p === 'string' ? p : p.name }}
                    <span v-if="p.port" class="ms-1 text-muted" style="font-size:11px">({{ p.port }})</span>
                  </span>
                </div>
                <div class="mt-3">
                  <button class="btn btn-sm btn-outline-secondary" @click="discoverPrinters">
                    Atualizar lista de impressoras
                  </button>
                </div>
              </div>

              <!-- Estado: AGUARDANDO -->
              <div v-else>
                <!-- Código de pareamento ativo -->
                <div v-if="pairingCode" class="pairing-code-box mb-3">
                  <div class="small fw-bold mb-2">Aguardando o agente...</div>
                  <ol class="pairing-steps small text-muted">
                    <li>Execute o <strong>Delivery Print Agent</strong> no computador da loja</li>
                    <li>Na primeira execução, informe a URL do servidor acima</li>
                    <li>Digite o código abaixo no campo de pareamento do agente:</li>
                  </ol>
                  <div class="pairing-code">{{ pairingCode }}</div>
                  <div class="d-flex justify-content-between align-items-center mt-2">
                    <div class="small" :class="pairingCountdown <= 60 ? 'text-danger' : 'text-muted'">
                      Expira em {{ formatCountdown(pairingCountdown) }}
                    </div>
                    <div class="small text-muted fst-italic">
                      <span class="spinner-border spinner-border-sm me-1" role="status"></span>
                      Aguardando conexão...
                    </div>
                  </div>
                </div>

                <!-- Sem código: instrução + botão gerar -->
                <div v-else class="text-center py-4">
                  <div class="text-muted mb-3 small">
                    Gere um código para parear o agente instalado no computador da loja.
                  </div>
                  <button type="button" class="btn btn-primary"
                          @click="generatePairingCode" :disabled="pairingLoading">
                    {{ pairingLoading ? 'Gerando...' : '🔗 Gerar código de pareamento' }}
                  </button>
                </div>
              </div>

              <!-- Logs de atividade -->
              <div v-if="logs.length" class="mt-3 logs">
                <div class="small text-muted mb-1">Atividade:</div>
                <div class="log-line" v-for="(l, idx) in logs" :key="idx">{{ l }}</div>
              </div>
            </div>

          </div>

          <!-- ─── Impressora Fiscal (NF-e) ──────────────────────────────────── -->
          <div class="mt-3 pt-3 border-top">
            <div class="d-flex align-items-center gap-2 mb-2">
              <span class="fw-bold small">Impressora para NF-e / Cupom Fiscal</span>
              <span class="badge bg-secondary" style="font-size:10px">opcional</span>
            </div>
            <p class="small text-muted mb-2">
              Se não configurada, a NF-e será impressa na mesma impressora dos pedidos.
            </p>
            <div class="d-flex gap-2 align-items-end mb-2">
              <div class="flex-grow-1">
                <label class="form-label small mb-1">Nome da impressora fiscal</label>
                <input v-model="fiscalPrinterName" type="text" class="form-control form-control-sm"
                       placeholder="Ex: Microsoft Print to PDF"
                       :list="'fiscal-printer-list'" />
                <datalist id="fiscal-printer-list">
                  <option v-for="name in printerNames" :key="name" :value="name" />
                </datalist>
              </div>
              <div style="width:160px">
                <label class="form-label small mb-1">Tipo</label>
                <select v-model="fiscalPrinterType" class="form-select form-select-sm">
                  <option value="">-- auto --</option>
                  <option value="usb">USB / Raw</option>
                  <option value="network">Rede (TCP)</option>
                  <option value="windows">Windows (spooler)</option>
                </select>
              </div>
            </div>
            <div class="d-flex gap-2">
              <button class="btn btn-sm btn-primary" @click="saveFiscalPrinter" :disabled="savingFiscal">
                {{ fiscalSaved ? '✅ Salvo' : (savingFiscal ? 'Salvando...' : 'Salvar') }}
              </button>
              <button v-if="fiscalPrinterName" class="btn btn-sm btn-outline-danger" @click="clearFiscalPrinter">
                Limpar
              </button>
            </div>
          </div>

          <!-- Footer -->
          <div class="modal-footer">
            <div class="me-auto">
              <div v-if="agentConnected" class="small text-success fw-bold">
                ✅ Agente conectado — {{ printers.length }} impressora(s) detectada(s)
              </div>
              <div v-else-if="pairingCode" class="small text-primary">
                <span class="spinner-border spinner-border-sm me-1"></span>
                Aguardando o agente digitar o código...
              </div>
              <div v-else class="small text-muted">
                Agente não conectado. Gere um código de pareamento acima.
              </div>
            </div>
            <button class="btn btn-secondary" @click="close">Fechar</button>
          </div>
        </div>
      </div>
    </div>

    <!-- ─── Modal: Baixar Agente ───────────────────────────────────────────── -->
    <div v-if="showAgentModal" class="modal-backdrop" style="z-index:3100"
         @click.self="showAgentModal = false">
      <div class="modal-dialog modal-centered" style="max-width:520px">
        <div class="modal-content p-3">
          <div class="modal-header">
            <h5 class="modal-title">Delivery Print Agent</h5>
            <button type="button" class="btn-close" @click="showAgentModal = false"></button>
          </div>
          <div class="modal-body">
            <p class="small text-muted mb-3">
              Programa instalado <strong>no computador da loja</strong> que recebe os pedidos e
              envia direto para a impressora térmica — sem diálogo de impressão do Windows.
            </p>

            <div class="agent-download-box mb-3">
              <div class="d-flex align-items-center gap-3">
                <span style="font-size:2rem">🖨️</span>
                <div>
                  <div class="fw-bold">Delivery Print Agent</div>
                  <div class="small text-muted">Windows 10/11 · x64 · ~50 MB</div>
                </div>
                <a :href="agentDownloadUrl" target="_blank"
                   class="btn btn-success ms-auto btn-sm px-3">
                  ⬇ Baixar .exe
                </a>
              </div>
            </div>

            <div class="small fw-bold mb-1">Passos de instalação:</div>
            <ol class="small text-muted ps-3" style="line-height:1.9">
              <li>Baixe e execute o instalador no computador da loja</li>
              <li>Informe a <strong>URL do servidor</strong> quando solicitado:<br>
                <code class="user-select-all">{{ currentServerUrl }}</code>
              </li>
              <li>Clique em <strong>"Gerar código de pareamento"</strong> neste painel</li>
              <li>Digite o código de 6 caracteres no agente para concluir</li>
              <li>O ícone verde na bandeja do Windows confirma a conexão</li>
            </ol>

            <div class="alert alert-info py-2 small mt-3 mb-0">
              <strong>Impressora USB?</strong> Instale o driver <em>"Generic / Text Only"</em>
              no Windows antes de configurar — ele aceita dados RAW sem interferência do spooler.
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary btn-sm" @click="showAgentModal = false">Fechar</button>
            <button class="btn btn-primary btn-sm"
                    @click="showAgentModal = false; generatePairingCode()">
              Gerar Código de Pareamento
            </button>
          </div>
        </div>
      </div>
    </div>
  </teleport>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import api from '../api';

const props = defineProps({ visible: Boolean });
const emit  = defineEmits(['update:visible', 'saved']);

// ── State ─────────────────────────────────────────────────────────────────
const visible         = ref(false);

// Agente
const printers        = ref([]);
const discovering     = ref(false);
const agentConnected  = ref(false);
const showAgentModal  = ref(false);
const logs            = ref([]);

// Pareamento
const pairingCode     = ref('');
const pairingCountdown = ref(0);
const pairingLoading  = ref(false);
let pairingTimer      = null;
let pairingPollTimer  = null;

// Impressora fiscal
const fiscalPrinterName = ref('');
const fiscalPrinterType = ref('');
const savingFiscal      = ref(false);
const fiscalSaved       = ref(false);

// ── Computed ──────────────────────────────────────────────────────────────
const currentServerUrl = computed(() => {
  const base = api.defaults?.baseURL || '';
  return base.replace(/\/api\/?$/, '').replace(/\/$/, '') || window.location.origin;
});

const printerNames = computed(() =>
  printers.value.map(p => (typeof p === 'string' ? p : p.name)).filter(Boolean)
);

const agentDownloadUrl = computed(() =>
  `${currentServerUrl.value}/downloads/delivery-print-agent-setup.exe`
);

// ── Helpers ───────────────────────────────────────────────────────────────
function pushLog(msg) {
  logs.value.unshift(`${new Date().toLocaleTimeString()} — ${String(msg)}`);
  if (logs.value.length > 30) logs.value.length = 30;
}

function formatCountdown(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ── Impressora Fiscal ─────────────────────────────────────────────────────
async function loadFiscalPrinter() {
  try {
    const { data } = await api.get('/settings/printer-setting')
    if (data?.setting) {
      fiscalPrinterName.value = data.setting.fiscalPrinterName || ''
      fiscalPrinterType.value = data.setting.fiscalPrinterType || ''
    }
  } catch (e) { /* silencioso */ }
}

async function saveFiscalPrinter() {
  savingFiscal.value = true
  fiscalSaved.value = false
  try {
    await api.post('/settings/printer-setting', {
      fiscalPrinterName: fiscalPrinterName.value || null,
      fiscalPrinterType: fiscalPrinterType.value || null,
    })
    fiscalSaved.value = true
    setTimeout(() => { fiscalSaved.value = false }, 2000)
  } catch (e) {
    pushLog('Erro ao salvar impressora fiscal: ' + (e?.response?.data?.error || e?.message || String(e)))
  } finally {
    savingFiscal.value = false
  }
}

async function clearFiscalPrinter() {
  fiscalPrinterName.value = ''
  fiscalPrinterType.value = ''
  await saveFiscalPrinter()
}

// ── Lifecycle ─────────────────────────────────────────────────────────────
onMounted(() => {
  visible.value = props.visible;
  if (visible.value) { discoverPrinters(); loadFiscalPrinter(); }
});

onUnmounted(() => {
  if (pairingTimer) { clearInterval(pairingTimer); pairingTimer = null; }
  stopPairingPoll();
});

watch(() => props.visible, (v) => {
  visible.value = v;
  if (v) { discoverPrinters(); loadFiscalPrinter(); }
});

// ── Descoberta de impressoras ─────────────────────────────────────────────
async function discoverPrinters() {
  printers.value    = [];
  discovering.value = true;
  try {
    pushLog('Consultando agente...');
    const { data } = await api.get('/agent-print/printers');
    if (data?.ok && Array.isArray(data.printers) && data.printers.length) {
      printers.value   = data.printers;
      agentConnected.value = true;
      pushLog(`Agente retornou ${printers.value.length} impressora(s)`);
    } else {
      agentConnected.value = false;
      pushLog('Agente não encontrado ou sem impressoras');
    }
  } catch (e) {
    agentConnected.value = false;
    pushLog('Erro ao contactar agente: ' + (e?.response?.data?.message || e?.message || String(e)));
  } finally {
    discovering.value = false;
  }
}

// ── Polling após código gerado ────────────────────────────────────────────
function startPairingPoll() {
  stopPairingPoll();
  agentConnected.value = false;
  pairingPollTimer = setInterval(async () => {
    if (!pairingCode.value) { stopPairingPoll(); return; }
    try {
      const { data } = await api.get('/agent-print/printers');
      if (data?.ok && Array.isArray(data.printers) && data.printers.length > 0) {
        printers.value       = data.printers;
        agentConnected.value = true;
        pushLog('✅ Agente conectado com sucesso!');
        stopPairingPoll();
      }
    } catch (_) { /* silencioso */ }
  }, 4000);
}

function stopPairingPoll() {
  if (pairingPollTimer) { clearInterval(pairingPollTimer); pairingPollTimer = null; }
}

// ── Gerar código de pareamento ────────────────────────────────────────────
function startPairingTimer(expiresAt) {
  if (pairingTimer) clearInterval(pairingTimer);
  const update = () => {
    const remaining = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
    pairingCountdown.value = remaining;
    if (remaining <= 0) {
      clearInterval(pairingTimer);
      pairingTimer = null;
      pairingCode.value = '';
      pushLog('Código de pareamento expirou');
    }
  };
  update();
  pairingTimer = setInterval(update, 1000);
}

async function generatePairingCode() {
  pairingLoading.value = true;
  try {
    const { data } = await api.post('/agent-setup/generate-code');
    if (data?.code) {
      pairingCode.value    = data.code;
      agentConnected.value = false;
      startPairingTimer(data.expiresAt);
      startPairingPoll();
      pushLog('Código gerado: ' + data.code);
    } else {
      pushLog('Resposta inesperada ao gerar código');
    }
  } catch (e) {
    pushLog('Erro ao gerar código: ' + (e?.response?.data?.message || e?.message || String(e)));
  } finally {
    pairingLoading.value = false;
  }
}

function close() {
  stopPairingPoll();
  emit('update:visible', false);
}
</script>

<style scoped>
.modal-backdrop {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.45);
  display: flex; align-items: center; justify-content: center;
  z-index: 3000;
}
.modal-dialog    { max-width: 760px; width: 100%; }
.modal-centered  { display: flex; align-items: center; justify-content: center; }
.modal-content   { border-radius: 8px; max-height: 85vh; overflow: auto; background: #fff; box-shadow: 0 8px 30px rgba(0,0,0,0.18); }

/* Logs */
.logs       { background: #f8f9fa; border: 1px solid #e9ecef; padding: 8px; border-radius: 6px; max-height: 120px; overflow: auto; font-family: ui-monospace, monospace; }
.log-line   { font-size: 12px; color: #333; white-space: pre-wrap; }

/* Info box (URL servidor) */
.info-box   { background: #f0f4ff; border: 1px solid #c7d7fa; border-radius: 6px; padding: 8px 12px; }

/* Pareamento */
.pairing-code-box  { background: #f0f7ff; border: 1px solid #b3d4fc; border-radius: 8px; padding: 14px 18px; }
.pairing-steps     { margin: 0 0 10px 0; padding-left: 20px; line-height: 1.8; }
.pairing-code      {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, monospace;
  font-size: 36px; font-weight: 700; letter-spacing: 8px;
  color: #1a56db; user-select: all; text-align: center;
  padding: 8px 0;
}

/* Agente conectado */
.agent-connected-box { background: #f0fdf4; border: 2px solid #22c55e; border-radius: 8px; padding: 14px 18px; color: #15803d; }
.printer-chip        { background: #dcfce7; border: 1px solid #86efac; border-radius: 20px; padding: 3px 12px; font-size: 13px; color: #15803d; }

/* Download box */
.agent-download-box { background: #f0fdf4; border: 1px solid #86efac; border-radius: 8px; padding: 14px 16px; }
</style>
