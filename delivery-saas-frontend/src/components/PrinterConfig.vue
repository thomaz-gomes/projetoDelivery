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
            <TextInput v-model="alias" placeholder="Apelido para esta impressora" inputClass="form-control" />
          </div>

          <div class="mb-3">
            <label class="form-label">Impressora</label>
            <SelectInput   v-model="printerName"  class="form-select">
              <option value="">Selecione uma impressora</option>
              <option v-for="p in printers" :key="p" :value="p">{{ p }}</option>
            </SelectInput>
            <div class="mt-2 small text-muted">Se a lista estiver vazia, verifique se o agente de impressão está executando na loja.</div>
            <div v-if="ENABLE_QZ" class="mt-2 small text-success">Impressão por QZ Tray ativada — não é necessário agente local.</div>
            <div class="mt-2">
              <div v-if="discovering" class="small text-muted">Procurando impressoras... ⏳</div>
              <div v-else-if="discoverError" class="small text-danger">{{ discoverError }}</div>
              <div class="mt-2 small text-muted">Agente de impressão detectado: <strong>{{ printers.length ? 'sim' : 'não' }}</strong></div>
              <div class="mt-2 small logs" v-if="logs.length">
                <div class="small text-muted mb-1">Logs:</div>
                <div class="log-line" v-for="(l, idx) in logs" :key="idx">{{ l }}</div>
              </div>
                  <div class="mt-2">
                    <button type="button" class="btn btn-sm btn-outline-secondary me-2" @click="discoverPrinters">Tentar novamente</button>
                    <button v-if="ENABLE_QZ" type="button" class="btn btn-sm btn-outline-secondary me-2" @click="discoverPrintersQZ">Descobrir via QZ</button>
                    <button type="button" class="btn btn-sm btn-outline-primary" @click="generateToken">Gerar token de agente</button>
                  </div>
            </div>
          </div>

          <div class="row">
            <div class="col-md-6 mb-3">
              <label class="form-label">Tipo de impressão</label>
              <SelectInput   v-model="printType"  class="form-select">
                <option value="thermal">impressão térmica</option>
                <option value="generic">impressão genérica (navegador)</option>
              </SelectInput>
            </div>
            <div class="col-md-6 mb-3">
              <label class="form-label">Largura de papel</label>
              <SelectInput   v-model="paperWidth"  class="form-select">
                <option value="80">80 mm</option>
                <option value="58">58 mm</option>
              </SelectInput>
            </div>
          </div>

          <div class="form-check mt-2">
            <input class="form-check-input" type="checkbox" v-model="includeItemDescription" id="includeDesc" />
            <label class="form-check-label" for="includeDesc">incluir descrição de itens na impressão</label>
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
import printService from '../services/printService.js';
import api from '../api';
import { API_URL } from '../config';

const ENABLE_QZ = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_ENABLE_QZ)
  ? String(import.meta.env.VITE_ENABLE_QZ) === '1' || String(import.meta.env.VITE_ENABLE_QZ) === 'true'
  : false;

const props = defineProps({ visible: Boolean });
const emit = defineEmits(['update:visible','saved']);

const visible = ref(false);
const printers = ref([]);
const printerName = ref('');
const alias = ref('');
const printType = ref('thermal');
const paperWidth = ref('80');
const includeItemDescription = ref(false);
const discovering = ref(false);
const discoverError = ref('');
const qzAvailable = ref(false);
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
      alias.value = cfg.alias || '';
      printType.value = cfg.printType || 'thermal';
      paperWidth.value = cfg.paperWidth || '80';
      includeItemDescription.value = !!cfg.includeItemDescription;
    }
  }catch(e){ console.warn('Failed to load saved printer config', e); }
}

async function discoverPrinters(){
  printers.value = [];
  discoverError.value = '';
  discovering.value = true;
  if (ENABLE_QZ) {
    // When QZ Tray is enabled, prefer asking the browser-side QZ API for
    // printers (if present). If the `qz` object isn't available, fall back
    // to the local HTTP mock (ports 4000/4001) so dev still works.
    pushLog('QZ Tray enabled; attempting browser QZ API discovery');
    try {
      if (typeof window !== 'undefined' && window.qz && window.qz.printers && typeof window.qz.printers.find === 'function') {
        try {
          const result = await window.qz.printers.find();
          if (Array.isArray(result) && result.length) {
            printers.value = result;
            if (printers.value.length && !printerName.value) printerName.value = printers.value[0];
            pushLog('qz.printers.find returned ' + printers.value.length + ' printers');
            discovering.value = false;
            return;
          }
        } catch (e) {
          pushLog('qz.printers.find failed: ' + String(e?.message || e));
        }
      }

      // Fallback: try local mock (ports 4000 then 4001)
      pushLog('Browser QZ API not available; trying local mock ports 4000/4001');
      const ports = [4000, 4001];
      for (const p of ports) {
        try {
          const res = await fetch(`http://localhost:${p}/printers`);
          if (!res.ok) continue;
          const body = await res.json();
          if (body && Array.isArray(body.printers)) {
            printers.value = body.printers;
            if (printers.value.length && !printerName.value) printerName.value = printers.value[0];
            pushLog(`Local print mock:${p} returned ${printers.value.length} printers`);
            discovering.value = false;
            return;
          }
        } catch (e) {
          // try next port
        }
      }

      discoverError.value = 'QZ Tray ativado — descoberta de agentes não necessária.';
      pushLog('Local discovery failed or returned no printers');
    } catch (e) {
      discoverError.value = 'QZ Tray ativado — descoberta de agentes não necessária.';
      pushLog('Local discovery error: ' + String(e?.message || e));
    } finally {
      discovering.value = false;
    }
    return;
  }
  pushLog('discoverPrinters called; querying backend agent-print/printers');
  try {
    // call backend to ask a connected agent for printers
    const storeId = (window && window.currentStoreId) || '';
    const qs = storeId ? `?storeId=${encodeURIComponent(storeId)}` : '';
    const base = String((API_URL || '')).replace(/\/$/, '') || '';
    const res = await fetch(`${base}/agent-print/printers${qs}`);
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      discoverError.value = `Falha ao consultar agentes: ${res.status} ${txt}`;
      pushLog('agent-print/printers failed: ' + String(txt || res.status));
      discovering.value = false;
      return;
    }
    const body = await res.json();
    if (body && Array.isArray(body.printers)) {
      printers.value = body.printers;
      if (printers.value.length && !printerName.value) printerName.value = printers.value[0];
      pushLog('agent-print/printers found ' + printers.value.length + ' printers');
    } else {
      discoverError.value = 'Nenhum agente respondeu com lista de impressoras.';
      pushLog('agent-print/printers returned no printers');
    }
  } catch (e) {
    console.warn('discoverPrinters error', e);
    discoverError.value = String(e?.message || e || 'Erro desconhecido');
    pushLog('discover error: ' + String(e?.message || e));
  } finally {
    discovering.value = false;
  }
}

// Force discovery via browser QZ API and show detailed errors
async function discoverPrintersQZ(){
  printers.value = [];
  discoverError.value = '';
  discovering.value = true;
  try {
    if (typeof window !== 'undefined' && window.qz && window.qz.printers && typeof window.qz.printers.find === 'function') {
      try {
        const result = await window.qz.printers.find();
        if (Array.isArray(result) && result.length) {
          printers.value = result;
          if (printers.value.length && !printerName.value) printerName.value = printers.value[0];
          pushLog('qz.printers.find returned ' + printers.value.length + ' printers');
        } else {
          discoverError.value = 'QZ retornou lista vazia.';
          pushLog('qz.printers.find returned empty');
        }
      } catch (e) {
        discoverError.value = 'Erro ao consultar QZ: ' + (e?.message || e);
        pushLog('qz.printers.find failed: ' + String(e?.message || e));
      }
    } else {
      discoverError.value = 'QZ não disponível no navegador.';
      pushLog('qz object not found in window');
    }
  } finally {
    discovering.value = false;
  }
}

async function generateToken(){
  try{
  const res = await api.post('/agent-setup/token');
    if (!res.ok) {
      const txt = await res.text().catch(()=>'');
      pushLog('generateToken failed: ' + txt);
      discoverError.value = 'Falha ao gerar token: ' + (txt || res.status);
      return;
    }
    const body = await res.json();
    if (body && body.token) {
      generatedToken.value = body.token;
      try { await navigator.clipboard.writeText(body.token); pushLog('Token copiado para clipboard'); } catch(e){}
      // store in localStorage for frontend convenience
      try { localStorage.setItem('agentToken', body.token); } catch(e){}
    }
  }catch(e){
    pushLog('generateToken error: ' + String(e?.message || e));
    discoverError.value = String(e?.message || e);
  }
}

function save(){
  const cfg = {
    alias: alias.value,
    printerName: printerName.value,
    printType: printType.value,
    paperWidth: paperWidth.value,
    includeItemDescription: includeItemDescription.value,
  };
  try{ localStorage.setItem('printerConfig', JSON.stringify(cfg)); } catch(e){ console.warn('Failed to save printer config', e); }

  // Try to persist to backend PrinterSetting (requires admin auth). If it
  // fails (no auth / network), fall back to localStorage only.
  (async () => {
    try {
      const iface = printerName.value ? `printer:${printerName.value}` : undefined;
      const body = { interface: iface, type: printType.value === 'thermal' ? 'EPSON' : 'GENERIC', width: Number(paperWidth.value) || 80, headerName: alias.value || undefined };
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
