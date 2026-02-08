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
            <div class="col-md-3 mb-3">
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

          <hr />
          <h6 class="small">Opções avançadas (QZ / Pixel)</h6>
          <div class="row g-2">
            <div class="col-md-2 mb-2">
              <label class="form-label">Unidades</label>
              <SelectInput v-model="units" class="form-select form-select-sm">
                <option value="in">in</option>
                <option value="mm">mm</option>
              </SelectInput>
            </div>
            <div class="col-md-2 mb-2">
              <label class="form-label">scaleContent</label>
              <SelectInput v-model="scaleContent" class="form-select form-select-sm">
                <option :value="undefined">auto</option>
                <option :value="true">false (no scale)</option>
                <option :value="false">true (scale)</option>
              </SelectInput>
            </div>
            <div class="col-md-3 mb-2">
              <TextInput v-model="pageWidth" label="pageWidth" labelClass="form-label" inputClass="form-control form-control-sm" placeholder="ex: 8.5" />
            </div>
            <div class="col-md-3 mb-2">
              <TextInput v-model="pageHeight" label="pageHeight" labelClass="form-label" inputClass="form-control form-control-sm" placeholder="ex: 11" />
            </div>
            
                      <div class="col-md-2 mb-2">
                        <TextInput v-model="density" label="density" labelClass="form-label" inputClass="form-control form-control-sm" placeholder="ex: 300" />
                      </div>
          </div>

          <div class="row g-2 mt-2">
            <div class="col-md-2 mb-2">
              <label class="form-label">copies</label>
              <input v-model.number="copies" type="number" min="1" class="form-control form-control-sm" />
            </div>
            <div class="col-md-3 mb-2">
              <label class="form-label">colorType</label>
              <SelectInput v-model="colorType" class="form-select form-select-sm">
                <option value="color">color</option>
                <option value="grayscale">grayscale</option>
                <option value="blackwhite">blackwhite</option>
                <option value="default">default</option>
              </SelectInput>
            </div>
            <div class="col-md-7 mb-2">
              <label class="form-label">margins (top,right,bottom,left)</label>
              <div class="d-flex gap-1">
                <input v-model.number="margins.top" type="number" step="0.1" class="form-control form-control-sm" placeholder="top" />
                <input v-model.number="margins.right" type="number" step="0.1" class="form-control form-control-sm" placeholder="right" />
                <input v-model.number="margins.bottom" type="number" step="0.1" class="form-control form-control-sm" placeholder="bottom" />
                <input v-model.number="margins.left" type="number" step="0.1" class="form-control form-control-sm" placeholder="left" />
              </div>
            </div>
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
const pageWidth = ref('');
const pageHeight = ref('');
const units = ref('in');
const scaleContent = ref(undefined);
const margins = ref({ top: 0.25, right: 0.25, bottom: 0.25, left: 0.25 });
const density = ref('');
const copies = ref(1);
const colorType = ref('default');
const discovering = ref(false);
const discoverError = ref('');
const qzAvailable = ref(false);
const generatedToken = ref('');
const logs = ref([]);

// Normalize various shapes returned by QZ into an array of unique printer names
function normalizePrinters(raw) {
  let v = raw;
  try {
    if (typeof v === 'string') {
      // Some QZ clients may return a JSON string
      const parsed = JSON.parse(v);
      v = parsed;
    }
  } catch (e) {
    // keep original
  }
  // Flatten one-level nested arrays
  if (Array.isArray(v) && v.length === 1 && Array.isArray(v[0])) v = v[0];
  if (!Array.isArray(v)) return [];
  const flat = v.map(i => (typeof i === 'string' ? i : JSON.stringify(i))).filter(Boolean);
  return Array.from(new Set(flat));
}

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
      pageWidth.value = cfg.pageWidth || '';
      pageHeight.value = cfg.pageHeight || '';
      units.value = cfg.units || 'in';
      scaleContent.value = typeof cfg.scaleContent === 'undefined' ? undefined : cfg.scaleContent;
      if (cfg.margins) margins.value = Object.assign({}, margins.value, cfg.margins);
      density.value = cfg.density || '';
      copies.value = typeof cfg.copies !== 'undefined' ? cfg.copies : 1;
      colorType.value = cfg.colorType || 'default';
    }
  }catch(e){ console.warn('Failed to load saved printer config', e); }
}

async function discoverPrinters(){
  printers.value = [];
  discoverError.value = '';
  discovering.value = true;
  if (ENABLE_QZ) {
    // When QZ Tray is enabled, query the real QZ API for printers.
    pushLog('QZ Tray enabled; attempting real QZ printer discovery');
    try {
      if (typeof window !== 'undefined' && window.qz) {
        // Ensure QZ is connected and use findAll for a full list
        const { initQZ } = await import('../plugins/qz.js');
        await initQZ();
        if (window.qz && window.qz.printers) {
          const listFn = window.qz.printers.findAll || window.qz.printers.getAll;
            if (typeof listFn === 'function') {
            const result = await listFn();
            // TEMP LOG: show raw result from QZ before normalization
            console.debug('QZ raw result (discoverPrinters):', result);
            pushLog('Raw QZ result logged to console');
              // Normalize result: QZ client may return an array, or a JSON string
              // containing an array. Also handle nested arrays.
              let normalized = result;
              try {
                if (typeof normalized === 'string') {
                  const parsed = JSON.parse(normalized);
                  normalized = parsed;
                }
              } catch (e) { /* keep original */ }

              // If nested array like [["p1","p2"]], flatten once
              if (Array.isArray(normalized) && normalized.length === 1 && Array.isArray(normalized[0])) {
                normalized = normalized[0];
              }

              if (Array.isArray(normalized) && normalized.length) {
                // Ensure all items are strings and unique
                const flat = normalized.map(i => (typeof i === 'string' ? i : JSON.stringify(i))).filter(Boolean);
                const unique = Array.from(new Set(flat));
                printers.value = unique;
                if (printers.value.length && !printerName.value) printerName.value = printers.value[0];
                pushLog('QZ returned ' + printers.value.length + ' printers');
                discovering.value = false;
                return;
              } else {
                pushLog('QZ returned empty printer list');
              }
          } else if (typeof window.qz.printers.find === 'function') {
            // As a last resort, try getting default printer name or an alternate
            try {
              const def = await window.qz.printers.find();
              const arr = normalizePrinters(def);
              if (arr.length) {
                printers.value = arr;
                if (!printerName.value) printerName.value = arr[0];
                pushLog('QZ returned default printer(s): ' + arr.length);
                discovering.value = false;
                return;
              }
            } catch(e) {
              pushLog('qz.printers.find (default) failed: ' + String(e?.message || e));
            }
          }
        }
      }

      discoverError.value = 'QZ Tray não respondeu com lista de impressoras.';
    } catch (e) {
      discoverError.value = 'Erro consultando QZ: ' + String(e?.message || e);
      pushLog('QZ discovery error: ' + String(e?.message || e));
    } finally {
      discovering.value = false;
    }
    return;
  }
  // Legacy agent-based discovery has been removed. Inform the user and
  // allow manual configuration or QZ-based discovery instead.
  pushLog('agent-print discovery removed; use QZ Tray or enter printer name manually');
  discoverError.value = 'A descoberta via agentes foi removida — insira o nome da impressora manualmente ou use QZ Tray.';
  discovering.value = false;
}

// Force discovery via browser QZ API and show detailed errors
async function discoverPrintersQZ(){
  printers.value = [];
  discoverError.value = '';
  discovering.value = true;
  try {
    if (typeof window !== 'undefined' && window.qz && window.qz.printers) {
      const { initQZ } = await import('../plugins/qz.js');
      await initQZ();
      const listFn = window.qz.printers.findAll || window.qz.printers.getAll;
      if (typeof listFn === 'function') {
        const result = await listFn();
        // TEMP LOG: show raw result from QZ before normalization
        console.debug('QZ raw result (discoverPrintersQZ):', result);
        pushLog('Raw QZ result logged to console');
        // Normalize similar to discoverPrinters
        let normalized = result;
        try { if (typeof normalized === 'string') normalized = JSON.parse(normalized); } catch(e){}
        if (Array.isArray(normalized) && normalized.length === 1 && Array.isArray(normalized[0])) normalized = normalized[0];
        if (Array.isArray(normalized) && normalized.length) {
          const flat = normalized.map(i => (typeof i === 'string' ? i : JSON.stringify(i))).filter(Boolean);
          const unique = Array.from(new Set(flat));
          printers.value = unique;
          if (printers.value.length && !printerName.value) printerName.value = printers.value[0];
          pushLog('QZ returned ' + printers.value.length + ' printers');
        } else {
          discoverError.value = 'QZ retornou lista vazia.';
          pushLog('QZ returned empty');
        }
      } else {
        // Fall back to default printer or alternate shapes
        const def = await window.qz.printers.find();
        const arr = normalizePrinters(def);
        if (arr.length) {
          printers.value = arr;
          if (!printerName.value) printerName.value = arr[0];
          pushLog('QZ returned default printer(s): ' + arr.length);
        } else {
          discoverError.value = 'QZ não retornou impressoras.';
        }
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
    pageWidth: pageWidth.value,
    pageHeight: pageHeight.value,
    units: units.value,
    scaleContent: scaleContent.value,
    margins: margins.value,
    density: density.value,
    copies: copies.value,
    colorType: colorType.value,
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
