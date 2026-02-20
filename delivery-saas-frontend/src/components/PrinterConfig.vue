<template>
  <teleport to="body">
    <div v-if="visible" class="modal-backdrop">
      <div class="modal-dialog modal-lg modal-centered">
        <div class="modal-content p-3">
        <div class="modal-header">
          <h5 class="modal-title">configurar impressão</h5>
          <button type="button" class="btn-close" @click="close"></button>
        </div>
        <div class="modal-body">
          <!-- Tabs -->
          <ul class="nav nav-tabs mb-3">
            <li class="nav-item">
              <a class="nav-link" :class="{ active: activeTab === 'config' }" href="#" @click.prevent="activeTab = 'config'">Configuracao</a>
            </li>
            <li class="nav-item">
              <a class="nav-link" :class="{ active: activeTab === 'template' }" href="#" @click.prevent="activeTab = 'template'">Template da Comanda</a>
            </li>
          </ul>

          <!-- Tab: Configuracao -->
          <div v-show="activeTab === 'config'">
            <p class="text-muted small">qual tipo de impressao vamos usar, hein?</p>

            <div class="mb-3">
              <label class="form-label">Impressora</label>
              <SelectInput v-model="printerName" class="form-select">
                <option value="">Selecione uma impressora</option>
                <option v-for="p in printers" :key="p" :value="p">{{ p }}</option>
              </SelectInput>
              <div class="mt-2 small text-muted">Se a lista estiver vazia, verifique se o agente de impressao esta executando na loja.</div>
              <div class="mt-2">
                <div v-if="discovering" class="small text-muted">Procurando impressoras...</div>
                <div v-else-if="discoverError" class="small text-danger">{{ discoverError }}</div>
                <div class="mt-2 small text-muted">Agente de impressao detectado: <strong>{{ printers.length ? 'sim' : 'nao' }}</strong></div>
                <div class="mt-2 small logs" v-if="logs.length">
                  <div class="small text-muted mb-1">Logs:</div>
                  <div class="log-line" v-for="(l, idx) in logs" :key="idx">{{ l }}</div>
                </div>
                <div class="mt-2 d-flex align-items-center gap-2 flex-wrap">
                  <button type="button" class="btn btn-sm btn-outline-secondary" @click="discoverPrinters">Tentar novamente</button>
                  <button type="button" class="btn btn-sm btn-outline-primary" @click="generatePairingCode" :disabled="pairingLoading">
                    {{ pairingLoading ? 'Gerando...' : 'Gerar codigo de pareamento' }}
                  </button>
                  <button type="button" class="btn btn-sm btn-outline-success" @click="showAgentModal = true">
                    ⬇ Baixar Agente de Impressao
                  </button>
                </div>
                <!-- Banner: agente conectou! -->
                <div v-if="agentConnected" class="agent-connected-box mt-3">
                  <div class="fw-bold">✅ Agente conectado com sucesso!</div>
                  <div class="small mt-1">
                    Impressora detectada: <strong>{{ printerName }}</strong>.
                    Selecione-a no campo acima e clique em <strong>"Salvar e usar"</strong>.
                  </div>
                </div>

                <!-- Código de pareamento aguardando agente -->
                <div v-else-if="pairingCode" class="pairing-code-box mt-3">
                  <div class="small fw-bold mb-2">Aguardando o agente de impressao...</div>
                  <ol class="pairing-steps small text-muted">
                    <li>Execute o <strong>agente de impressao</strong> no computador da loja</li>
                    <li>Informe a <strong>URL do servidor</strong> quando solicitado</li>
                    <li>Digite o codigo abaixo no campo de pareamento do agente:</li>
                  </ol>
                  <div class="pairing-code">{{ pairingCode }}</div>
                  <div class="d-flex justify-content-between align-items-center mt-2">
                    <div class="small" :class="pairingCountdown <= 60 ? 'text-danger' : 'text-muted'">
                      Expira em {{ formatCountdown(pairingCountdown) }}
                    </div>
                    <div class="small text-muted fst-italic">
                      <span class="spinner-border spinner-border-sm me-1" role="status"></span>
                      Aguardando conexao...
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div class="row">
              <div class="col-md-6 mb-3">
                <label class="form-label">Tipo de impressao</label>
                <SelectInput v-model="printType" class="form-select">
                  <option value="thermal">impressao termica</option>
                  <option value="generic">impressao generica (navegador)</option>
                </SelectInput>
              </div>
              <div class="col-md-3 mb-3">
                <label class="form-label">Largura de papel</label>
                <SelectInput v-model="paperWidth" class="form-select">
                  <option value="80">80 mm</option>
                  <option value="58">58 mm</option>
                </SelectInput>
              </div>
            </div>

            <hr />
            <h6 class="small">Numero de copias</h6>
            <div class="row g-2">
              <div class="col-md-3 mb-2">
                <label class="form-label">Copias por pedido</label>
                <input v-model.number="copies" type="number" min="1" max="10" class="form-control form-control-sm" />
              </div>
            </div>
          </div>

          <!-- Tab: Template -->
          <div v-show="activeTab === 'template'">
            <ReceiptTemplateEditor v-model="receiptTemplate" @test-print="testPrint" />
          </div>

        </div>
        <div class="modal-footer">
          <div class="me-auto text-start">
            <div v-if="agentConnected" class="small text-success fw-bold">✅ Agente conectado! Selecione a impressora e salve.</div>
            <div v-else-if="pairingCode" class="small text-primary">
              <span class="spinner-border spinner-border-sm me-1" role="status"></span>
              Codigo ativo — aguardando o agente digitar o codigo...
            </div>
            <div v-else class="small text-muted">Clique em "Gerar codigo de pareamento" para conectar o agente.</div>
          </div>
          <button class="btn btn-secondary" @click="close">Cancelar</button>
          <button class="btn btn-primary" @click="save" :disabled="!printerName">Salvar e usar</button>
        </div>
      </div>
    </div>
  </div>
  <!-- Modal: Baixar Agente de Impressao -->
  <div v-if="showAgentModal" class="modal-backdrop" style="z-index:3100" @click.self="showAgentModal = false">
    <div class="modal-dialog modal-centered" style="max-width:520px">
      <div class="modal-content p-3">
        <div class="modal-header">
          <h5 class="modal-title">Agente de Impressao Termica</h5>
          <button type="button" class="btn-close" @click="showAgentModal = false"></button>
        </div>
        <div class="modal-body">

          <p class="small text-muted mb-3">
            O agente e um programa instalado <strong>no computador da loja</strong> que recebe os pedidos
            e envia direto para a impressora termica — sem dialogo de impressao.
          </p>

          <div class="agent-download-box mb-3">
            <div class="d-flex align-items-center gap-3">
              <span style="font-size:2rem">🖨️</span>
              <div>
                <div class="fw-bold">Delivery Print Agent</div>
                <div class="small text-muted">Windows 10/11 · x64 · ~50 MB</div>
              </div>
              <a :href="agentDownloadUrl" target="_blank" class="btn btn-success ms-auto btn-sm px-3">
                ⬇ Baixar .exe
              </a>
            </div>
          </div>

          <div class="small fw-bold mb-1">Passos de instalacao:</div>
          <ol class="small text-muted ps-3" style="line-height:1.9">
            <li>Baixe e execute o instalador <strong>.exe</strong> acima no computador da loja</li>
            <li>Na primeira execucao, informe a <strong>URL do servidor</strong>:<br>
              <code class="user-select-all">{{ currentServerUrl }}</code>
            </li>
            <li>Clique em <strong>"Gerar codigo de pareamento"</strong> aqui no painel</li>
            <li>Digite o codigo de 6 caracteres no agente para concluir a conexao</li>
            <li>O icone verde na bandeja do Windows confirma que esta conectado</li>
          </ol>

          <div class="alert alert-info py-2 small mt-3 mb-0">
            <strong>Impressora USB?</strong> Instale o driver <em>"Generic / Text Only"</em> no Windows
            antes de configurar — ele aceita dados RAW sem interferencia.
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary btn-sm" @click="showAgentModal = false">Fechar</button>
          <button class="btn btn-primary btn-sm" @click="showAgentModal = false; generatePairingCode()">
            Gerar Codigo de Pareamento
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
import ReceiptTemplateEditor from './ReceiptTemplateEditor.vue';

const props = defineProps({ visible: Boolean });
const emit = defineEmits(['update:visible','saved']);

const visible = ref(false);
const activeTab = ref('config');
const printers = ref([]);
const printerName = ref('');
const printType = ref('thermal');
const paperWidth = ref('80');
const copies = ref(1);
const receiptTemplate = ref('');
const discovering = ref(false);
const discoverError = ref('');
const pairingCode = ref('');
const pairingCountdown = ref(0);
const pairingLoading = ref(false);
let pairingTimer = null;
const logs = ref([]);
const showAgentModal = ref(false);
const agentConnected = ref(false);   // true quando agente parear e aparecer
let pairingPollTimer = null;         // polling periódico durante pareamento

// URL base do backend (para mostrar ao usuário e montar link de download)
const currentServerUrl = computed(() => {
  const base = api.defaults?.baseURL || '';
  return base.replace(/\/api\/?$/, '').replace(/\/$/, '') || window.location.origin;
});

const agentDownloadUrl = computed(() => `${currentServerUrl.value}/downloads/delivery-print-agent-setup.exe`);

function pushLog(msg){
  try{
    logs.value.unshift(`${new Date().toLocaleTimeString()} - ${String(msg)}`);
    if (logs.value.length > 30) logs.value.length = 30;
  }catch(e){}
}

onMounted(() => {
  visible.value = props.visible;
  loadSaved();
  if (visible.value) discoverPrinters();
});

onUnmounted(() => {
  if (pairingTimer) { clearInterval(pairingTimer); pairingTimer = null; }
  stopPairingPoll();
});

// watch prop changes
watch(() => props.visible, (v) => { visible.value = v; if (v) { discoverPrinters(); } });

function close(){
  stopPairingPoll();
  emit('update:visible', false);
}

// ── Polling enquanto aguarda agente conectar ──────────────────────────────────
function startPairingPoll() {
  stopPairingPoll();
  agentConnected.value = false;
  // Aguarda 4s antes do primeiro poll (agente precisa de tempo para parear)
  pairingPollTimer = setInterval(async () => {
    if (!pairingCode.value) { stopPairingPoll(); return; } // código expirou
    try {
      const { data } = await api.get('/agent-print/printers');
      if (data?.ok && Array.isArray(data.printers) && data.printers.length > 0) {
        printers.value = data.printers;
        if (!printerName.value) printerName.value = printers.value[0];
        agentConnected.value = true;
        pushLog('Agente conectado com sucesso!');
        stopPairingPoll();
      }
    } catch (_) { /* silencioso — tentará novamente */ }
  }, 4000);
}

function stopPairingPoll() {
  if (pairingPollTimer) { clearInterval(pairingPollTimer); pairingPollTimer = null; }
}

function loadSaved(){
  try{
    const s = localStorage.getItem('printerConfig');
    if (s){
      const cfg = JSON.parse(s);
      printerName.value = cfg.printerName || '';
      printType.value = cfg.printType || 'thermal';
      paperWidth.value = cfg.paperWidth || '80';
      copies.value = typeof cfg.copies !== 'undefined' ? cfg.copies : 1;
      receiptTemplate.value = cfg.receiptTemplate || '';
    }
  }catch(e){ console.warn('Failed to load saved printer config', e); }
}

async function discoverPrinters(){
  printers.value = [];
  discoverError.value = '';
  discovering.value = true;
  try {
    pushLog('Consultando agente de impressao via backend...');
    const { data } = await api.get('/agent-print/printers');
    if (data && data.ok && Array.isArray(data.printers) && data.printers.length) {
      printers.value = data.printers;
      if (!printerName.value) printerName.value = printers.value[0];
      pushLog('Agente retornou ' + printers.value.length + ' impressora(s)');
    } else {
      discoverError.value = 'Nenhuma impressora encontrada. Verifique se o agente esta conectado.';
      pushLog('Agente nao retornou impressoras');
    }
  } catch (e) {
    const msg = e?.response?.data?.message || e?.message || String(e);
    discoverError.value = 'Erro ao buscar impressoras: ' + msg;
    pushLog('Erro discovery: ' + msg);
  } finally {
    discovering.value = false;
  }
}

function formatCountdown(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function startPairingTimer(expiresAt) {
  if (pairingTimer) clearInterval(pairingTimer);
  const update = () => {
    const remaining = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
    pairingCountdown.value = remaining;
    if (remaining <= 0) {
      clearInterval(pairingTimer);
      pairingTimer = null;
      pairingCode.value = '';
      pushLog('Codigo de pareamento expirou');
    }
  };
  update();
  pairingTimer = setInterval(update, 1000);
}

async function generatePairingCode(){
  pairingLoading.value = true;
  try {
    const { data } = await api.post('/agent-setup/generate-code');
    if (data && data.code) {
      pairingCode.value = data.code;
      agentConnected.value = false;
      startPairingTimer(data.expiresAt);
      startPairingPoll();
      pushLog('Codigo de pareamento gerado: ' + data.code);
    } else {
      pushLog('generatePairingCode: resposta inesperada');
      discoverError.value = 'Falha ao gerar codigo de pareamento';
    }
  } catch(e) {
    const msg = e?.response?.data?.message || e?.message || String(e);
    pushLog('Erro ao gerar codigo: ' + msg);
    discoverError.value = 'Erro ao gerar codigo: ' + msg;
  } finally {
    pairingLoading.value = false;
  }
}

async function testPrint(){
  try {
    pushLog('Enviando impressao de teste...');
    const { data } = await api.post('/agent-setup/print-test', {
      printerName: printerName.value || undefined,
      receiptTemplate: receiptTemplate.value || undefined,
      copies: 1,
    });
    if (data && data.ok) pushLog('Impressao de teste enviada com sucesso');
    else pushLog('Falha ao enviar teste: ' + JSON.stringify(data));
  } catch (e) {
    const msg = e?.response?.data?.message || e?.message || String(e);
    pushLog('Erro ao imprimir teste: ' + msg);
  }
}

function save(){
  const cfg = {
    printerName: printerName.value,
    printType: printType.value,
    paperWidth: paperWidth.value,
    copies: copies.value,
    receiptTemplate: receiptTemplate.value,
  };
  try{ localStorage.setItem('printerConfig', JSON.stringify(cfg)); } catch(e){ console.warn('Failed to save printer config', e); }

  // Try to persist to backend PrinterSetting (requires admin auth). If it
  // fails (no auth / network), fall back to localStorage only.
  (async () => {
    try {
      const iface = printerName.value ? `printer:${printerName.value}` : undefined;
      const body = {
        interface: iface,
        type: printType.value === 'thermal' ? 'EPSON' : 'GENERIC',
        width: Number(paperWidth.value) || 80,
        headerName: undefined,
        copies: copies.value || 1,
        printerName: printerName.value || null,
        receiptTemplate: receiptTemplate.value || null,
      };
      try {
        const { data } = await api.post('/agent-setup/settings', body);
        if (data && data.ok) pushLog('Saved printer settings to backend');
        else pushLog('Failed to save settings to backend: ' + JSON.stringify(data));
      } catch (e) {
        pushLog('Failed to save settings to backend: ' + (e?.response?.data?.message || e?.message || e));
      }
    } catch (e) {
      pushLog('Could not persist settings to backend (no auth/network)');
    } finally {
      emit('saved', cfg);
      emit('update:visible', false);
    }
  })();
}
</script>

<style scoped>
.modal-backdrop{ position: fixed; inset:0; background: rgba(0,0,0,0.45); display:flex; align-items:center; justify-content:center; z-index:3000; }
.modal-dialog{ max-width:780px; width:100%; }
.modal-centered{ display:flex; align-items:center; justify-content:center; }
.modal-content{ border-radius:8px; max-height:80vh; overflow:auto; background:#fff; box-shadow:0 8px 30px rgba(0,0,0,0.18); }
.logs{ background:#f8f9fa; border:1px solid #e9ecef; padding:8px; border-radius:6px; max-height:120px; overflow:auto; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, 'Roboto Mono', monospace; }
.log-line{ font-size:12px; color:#333; white-space:pre-wrap; }
.pairing-code-box{ background:#f0f7ff; border:1px solid #b3d4fc; border-radius:8px; padding:12px 16px; }
.pairing-steps{ margin:0 0 8px 0; padding-left:20px; line-height:1.7; }
.pairing-code{ font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, monospace; font-size:32px; font-weight:700; letter-spacing:6px; color:#1a56db; user-select:all; text-align:center; }
.agent-download-box{ background:#f0fdf4; border:1px solid #86efac; border-radius:8px; padding:14px 16px; }
.agent-connected-box{ background:#f0fdf4; border:2px solid #22c55e; border-radius:8px; padding:12px 16px; color:#15803d; }
</style>
