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
          <p class="text-muted small">qual tipo de impressão vamos usar, hein?</p>

          <div class="mb-3">
            <label class="form-label">Apelido</label>
            <input v-model="alias" class="form-control" placeholder="Apelido para esta impressora" />
          </div>

          <div class="mb-3">
            <label class="form-label">Impressora</label>
            <select v-model="printerName" class="form-select">
              <option value="">Selecione uma impressora</option>
              <option v-for="p in printers" :key="p" :value="p">{{ p }}</option>
            </select>
            <div class="mt-2 small text-muted">Se a lista estiver vazia, verifique se o agente de impressão/back-end está rodando.</div>
            <div class="mt-2">
              <div v-if="discovering" class="small text-muted">Procurando impressoras... ⏳</div>
              <div v-else-if="discoverError" class="small text-danger">{{ discoverError }}</div>
              
              <div class="mt-2">
                <button type="button" class="btn btn-sm btn-outline-secondary me-2" @click="discoverPrinters">Tentar novamente</button>
              </div>
            </div>
          </div>

          <div class="row">
            <div class="col-md-12 mb-3">
              <label class="form-label">Largura de papel</label>
              <select v-model="paperWidth" class="form-select">
                <option value="80">80 mm</option>
                <option value="58">58 mm</option>
              </select>
            </div>
          </div>

          <div class="form-check mt-2">
            <input class="form-check-input" type="checkbox" v-model="includeItemDescription" id="includeDesc" />
            <label class="form-check-label" for="includeDesc">incluir descrição de itens na impressão</label>
          </div>

          <hr />
          <div class="mb-3">
            <label class="form-label">Configuração do Agente Local (dev)</label>
            <input v-model="agentUrl" class="form-control mb-2" placeholder="Ex: http://localhost:4000/api/print" />
            <input v-model="agentToken" class="form-control" placeholder="Token do agente (x-print-agent-token) - opcional" />
            <div class="mt-2 small text-muted">Essas configurações são usadas quando a rota de impressão está definida para 'Local agent' (dev). Em produção a impressão deve ir via backend (/agent-print).</div>
          </div>

          <hr />
          <div class="mb-3">
            <h6>Agent / Token (Admin)</h6>
            <div class="small text-muted">Socket URL: <strong>{{ socketUrl || '-' }}</strong></div>
            <div class="small text-muted">Store IDs: <strong>{{ (storeIds || []).join(', ') || '-' }}</strong></div>
            <div class="small text-muted">Token emitido: <strong>{{ tokenHint || 'nenhum' }}</strong></div>
            <div class="mt-2 d-flex gap-2">
              <button class="btn btn-sm btn-outline-primary" @click="generateToken">Gerar / Rotacionar token</button>
              <button class="btn btn-sm btn-outline-secondary" @click="copyGeneratedToken" :disabled="!generatedToken">Copiar token gerado</button>
            </div>
            <div v-if="generatedToken" class="mt-2 small"><label>Token (copie e guarde em segurança — será exibido apenas agora)</label>
              <div style="display:flex; gap:8px; align-items:center"><input readonly style="flex:1" :value="generatedToken" /><button class="btn btn-sm btn-outline-secondary" @click="copyGeneratedToken">Copiar</button></div>
            </div>
          </div>

        </div>
        <div v-if="saveStatus" class="p-2">
          <div :class="['alert', saveSuccess ? 'alert-success' : 'alert-danger']" role="alert">{{ saveStatus }}</div>
        </div>
        <div class="modal-footer">
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
import printService from '../services/printService.js';
import api from '../api'

const props = defineProps({ visible: Boolean });
const emit = defineEmits(['update:visible','saved']);

const visible = ref(false);
const printers = ref([]);
const printerName = ref('');
const alias = ref('');
const agentUrl = ref('');
const agentToken = ref('');
// printType removed — we always print via agent/backend and let the agent decide
const printType = ref(null);
const paperWidth = ref('80');
const includeItemDescription = ref(false);
const discovering = ref(false);
const discoverError = ref('');
// qzAvailable/logs removed (no longer showing QZ Tray detection or logs in modal)
const generatedToken = ref('')
const tokenHint = ref('')
const printerSetting = ref(null)
const saving = ref(false)
const saveStatus = ref('')
const saveSuccess = ref(false)
const socketUrl = ref('')
const storeIds = ref([])

onMounted(() => {
  visible.value = props.visible;
  loadSaved();
  // load printers and agent info on frontend start
  discoverPrinters();
  fetchAgentSetup();
});

watch(() => props.visible, (v) => { visible.value = v; if (v) { discoverPrinters(); fetchAgentSetup(); } });

function close(){ emit('update:visible', false); }

async function fetchAgentSetup(){
  try{
    const { data } = await api.get('/agent-setup')
    tokenHint.value = data.tokenHint || ''
    printerSetting.value = data.printerSetting || null
    socketUrl.value = data.socketUrl || ''
    storeIds.value = data.storeIds || []
    // populate fields from server-side stored printerSetting if present
      if (printerSetting.value) {
      printerName.value = printerSetting.value.interface || printerName.value
      paperWidth.value = printerSetting.value.width ? String(printerSetting.value.width) : paperWidth.value
      alias.value = printerSetting.value.headerName || alias.value
      includeItemDescription.value = !!printerSetting.value.includeItemDescription
    }
  } catch(e){ console.warn('Failed to fetch /agent-setup', e); }
}

function loadSaved(){
  try{
    const s = localStorage.getItem('printerConfig');
    if (s){
      const cfg = JSON.parse(s);
      printerName.value = cfg.printerName || printerName.value;
      alias.value = cfg.alias || alias.value;
      agentUrl.value = cfg.agentUrl || agentUrl.value;
      agentToken.value = cfg.agentToken || agentToken.value;
      printType.value = cfg.printType || printType.value;
      paperWidth.value = cfg.paperWidth || paperWidth.value;
      includeItemDescription.value = !!cfg.includeItemDescription;
    }
  }catch(e){ console.warn('Failed to load saved printer config', e); }
}

async function discoverPrinters(){
  printers.value = [];
  discoverError.value = '';
  discovering.value = true;
  // attempt to discover printers via backend or local agent
  try{
    const ok = await printService.connectQZ();
    if (!ok) {
      discoverError.value = 'Não foi possível contatar o serviço de impressão (verifique backend/agent).';
      discovering.value = false;
      return;
    }

    // Prefer querying the local agent first (dev-friendly). If unavailable,
    // fall back to backend proxy. Use configured agentToken when available.
    try {
      const cfg = printService.getPrinterConfig && printService.getPrinterConfig() || {};
      const headers = {};
      if (cfg.agentToken) headers['x-print-agent-token'] = cfg.agentToken;
      const resLocal = await fetch((cfg.agentUrl && cfg.agentUrl.indexOf('http') === 0 ? cfg.agentUrl.replace(/\/api\/print\/?$/, '') : 'http://localhost:4000') + '/api/print/printers', { headers });
      if (resLocal && resLocal.ok) {
        const list = await resLocal.json();
        if (Array.isArray(list)) printers.value = list.map(p => (typeof p === 'string' ? p : (p.name || p)));
        discovering.value = false;
        return;
      }
    } catch (e) {
      // local agent not reachable or returned error; continue to backend fallback
    }

    // fallback: try backend (proxied via Vite) — handle errors gracefully
    try {
      const res = await fetch('/api/print/printers');
      if (res && res.ok) {
        const list = await res.json();
        if (Array.isArray(list)) printers.value = list.map(p => (typeof p === 'string' ? p : (p.name || p)));
      }
    } catch (e) {
      // ignore errors from backend proxy — we'll show a friendly message
    }
  } catch(e){
    console.warn('Failed to discover printers (backend)', e);
    discoverError.value = String(e?.message || e || 'Erro desconhecido ao descobrir impressoras');
  } finally { discovering.value = false; }
}

async function generateToken(){
  generatedToken.value = ''
  try{
    const { data } = await api.post('/agent-setup/token')
    generatedToken.value = data.token
    // also set agentToken in local UI so user can copy/paste to agent
    agentToken.value = data.token
    // update tokenHint by refetching setup info
    await fetchAgentSetup()
  } catch(e){ console.error('Failed to generate token', e); alert('Falha ao gerar token: ' + (e?.response?.data?.message || e?.message || e)) }
}

function copyGeneratedToken(){
  if (!generatedToken.value) return;
  try { navigator.clipboard.writeText(generatedToken.value); alert('Token copiado para área de transferência'); } catch(e) { alert('Falha ao copiar token: ' + e) }
}

async function save(){
  const cfg = {
    alias: alias.value,
    printerName: printerName.value,
    paperWidth: paperWidth.value,
    includeItemDescription: includeItemDescription.value,
    agentUrl: agentUrl.value,
    agentToken: agentToken.value,
  };

  // Persist to backend PrinterSetting (admin-only). If backend call fails, still save locally.
  try{
    await api.post('/agent-setup/settings', {
      interface: cfg.printerName || undefined,
      width: cfg.paperWidth ? Number(cfg.paperWidth) : undefined,
      headerName: cfg.alias || undefined,
      headerCity: undefined,
      includeItemDescription: !!cfg.includeItemDescription
    })
  } catch(e){ console.warn('Failed to persist printer settings to backend', e); }

  saving.value = true
  saveStatus.value = ''
  saveSuccess.value = false

  try{ localStorage.setItem('printerConfig', JSON.stringify(cfg)); } catch(e){ console.warn('Failed to save printer config', e); }
  // update in-memory printService config
  try { await printService.setPrinterConfig(cfg); } catch(e){}

  // show success in modal and close shortly after; if backend persistence failed earlier we still saved locally
  saveStatus.value = 'Configuração salva com sucesso.'
  saveSuccess.value = true
  saving.value = false
  try { emit('saved', cfg); } catch(e){}
  // keep modal open briefly to show confirmation
  setTimeout(() => { emit('update:visible', false); }, 1200)
}
</script>

<style scoped>
.modal-backdrop{ position: fixed; inset:0; background: rgba(0,0,0,0.45); display:flex; align-items:center; justify-content:center; z-index:3000; }
.modal-dialog{ max-width:780px; width:100%; }
.modal-centered{ display:flex; align-items:center; justify-content:center; }
.modal-content{ border-radius:8px; max-height:80vh; overflow:auto; background:#fff; box-shadow:0 8px 30px rgba(0,0,0,0.18); }
/* logs UI removed */
</style>
