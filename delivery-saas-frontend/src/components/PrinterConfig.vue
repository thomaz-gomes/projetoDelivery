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
                <div class="mt-2">
                  <button type="button" class="btn btn-sm btn-outline-secondary me-2" @click="discoverPrinters">Tentar novamente</button>
                  <button type="button" class="btn btn-sm btn-outline-primary" @click="generateToken">Gerar token de agente</button>
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
            <div v-if="generatedToken" class="small text-success">Token gerado e copiado: <code>{{ generatedToken }}</code></div>
            <div v-else class="small text-muted">Clique em "Gerar token de agente" para criar um token para o agente.</div>
          </div>
          <button class="btn btn-secondary" @click="close">Cancelar</button>
          <button class="btn btn-primary" @click="save" :disabled="!printerName">Salvar e usar</button>
        </div>
      </div>
    </div>
  </div>
  </teleport>
</template>

<script setup>
import { ref, onMounted, watch } from 'vue';
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
const generatedToken = ref('');
const logs = ref([]);

function pushLog(msg){
  try{
    logs.value.unshift(`${new Date().toLocaleTimeString()} - ${String(msg)}`);
    if (logs.value.length > 30) logs.value.length = 30;
  }catch(e){}
}

onMounted(() => {
  visible.value = props.visible;
  // this modal uses backend/agent endpoints for discovery and token generation
  // printers list will be fetched from backend/agents
  loadSaved();
  if (visible.value) discoverPrinters();
});

// watch prop changes
watch(() => props.visible, (v) => { visible.value = v; if (v) { discoverPrinters(); } });

function close(){
  emit('update:visible', false);
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

async function generateToken(){
  try {
    const { data } = await api.post('/agent-setup/token');
    if (data && data.token) {
      generatedToken.value = data.token;
      try { await navigator.clipboard.writeText(data.token); pushLog('Token copiado para clipboard'); } catch(e){}
      try { localStorage.setItem('agentToken', data.token); } catch(e){}
      pushLog('Token gerado com sucesso');
    } else {
      pushLog('generateToken: resposta inesperada');
      discoverError.value = 'Falha ao gerar token';
    }
  } catch(e) {
    const msg = e?.response?.data?.message || e?.message || String(e);
    pushLog('generateToken error: ' + msg);
    discoverError.value = 'Erro ao gerar token: ' + msg;
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
</style>
