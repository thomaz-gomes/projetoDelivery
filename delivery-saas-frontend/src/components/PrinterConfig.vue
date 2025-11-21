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
            <div class="mt-2 small text-muted">Se a lista estiver vazia, verifique se o QZ Tray está rodando e autorizado.</div>
            <div class="mt-2">
              <div v-if="discovering" class="small text-muted">Procurando impressoras... ⏳</div>
              <div v-else-if="discoverError" class="small text-danger">{{ discoverError }}</div>
              <div class="mt-2 small text-muted">QZ Tray detectado: <strong>{{ qzAvailable ? 'sim' : 'não' }}</strong></div>
              <div class="mt-2 small logs" v-if="logs.length">
                <div class="small text-muted mb-1">Logs:</div>
                <div class="log-line" v-for="(l, idx) in logs" :key="idx">{{ l }}</div>
              </div>
              <div class="mt-2">
                <button type="button" class="btn btn-sm btn-outline-secondary me-2" @click="discoverPrinters">Tentar novamente</button>
              </div>
            </div>
          </div>

          <div class="row">
            <div class="col-md-6 mb-3">
              <label class="form-label">Tipo de impressão</label>
              <select v-model="printType" class="form-select">
                <option value="thermal">impressão térmica</option>
                <option value="generic">impressão genérica (navegador)</option>
              </select>
            </div>
            <div class="col-md-6 mb-3">
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
import { connectQZ } from '../services/printService.js';

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
const logs = ref([]);

function pushLog(msg){
  try{
    logs.value.unshift(`${new Date().toLocaleTimeString()} - ${String(msg)}`);
    if (logs.value.length > 30) logs.value.length = 30;
  }catch(e){}
}

onMounted(() => {
  visible.value = props.visible;
  qzAvailable.value = !!window.qz;
  if (qzAvailable.value) pushLog('window.qz detected on mount');
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
  qzAvailable.value = !!window.qz;
  pushLog('discoverPrinters called; qzAvailable=' + qzAvailable.value);
  try{
    // Ensure QZ is connected (will coalesce concurrent attempts)
    const ok = await connectQZ();
    pushLog('connectQZ result: ' + ok);
    if (!ok) {
      discoverError.value = 'Não foi possível conectar ao QZ Tray (verifique se o app está rodando e autorizado).';
      discovering.value = false;
      pushLog('connectQZ failed');
      return;
    }
    if (!window.qz || !window.qz.printers) {
      discoverError.value = 'QZ Tray não expõe printers API.';
      discovering.value = false;
      pushLog('window.qz.printers missing');
      return;
    }
    const list = await window.qz.printers.find();
    pushLog('printers.find() returned ' + (Array.isArray(list) ? list.length + ' printers' : String(list)));
    if (Array.isArray(list)) printers.value = list;
    const def = await window.qz.printers.getDefault();
    pushLog('printers.getDefault() => ' + String(def));
    if (def && !printerName.value) printerName.value = def;
  }catch(e){
    console.warn('Failed to discover printers (is QZ Tray running/authorized?)', e);
    pushLog('discover error: ' + String(e?.message || e));
    discoverError.value = String(e?.message || e || 'Erro desconhecido ao descobrir impressoras');
  } finally {
    discovering.value = false;
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
  emit('saved', cfg);
  emit('update:visible', false);
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
