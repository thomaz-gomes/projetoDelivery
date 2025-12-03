<template>
  <div class="printer-setup">
    <h3>Configuração de Impressora</h3>

    <div v-if="!autoDetected">
      <label>Backend Socket URL</label>
      <TextInput v-model="form.backend" placeholder="http://localhost:3000" />

      <label>Store IDs (comma-separated)</label>
      <TextInput v-model="form.storeIds" placeholder="store-1,store-2" />
      <small style="color:#666">Se a máquina atende várias lojas, informe os store ids separados por vírgula.</small>

      <label>Agent Token</label>
      <TextInput v-model="form.token" placeholder="PRINT_AGENT_TOKEN" />
    </div>

    <div v-else>
      <div><strong>Backend:</strong> {{ form.backend }}</div>
      <div><strong>Store IDs:</strong> {{ form.storeIds }}</div>
    </div>

    <div>
      <label>Printer (detectado via agente local)</label>
      <SelectInput   v-model="form.printer" >
        <option disabled value="">-- selecione --</option>
        <option v-for="p in printers" :key="p.name" :value="p.name">{{ p.name }} <span v-if="p.default">(default)</span></option>
      </SelectInput>
      <label style="margin-top:8px">Ou informe o nome exato da impressora (interface)</label>
      <TextInput v-model="form.printerInterface" placeholder="printer:Print iD" />

      <label style="margin-top:8px">Printer Type (emulação)</label>
      <SelectInput   v-model="form.printerType" >
        <option value="EPSON">EPSON (ESC/POS)</option>
        <option value="STAR">STAR</option>
      </SelectInput>
      
      <label style="margin-top:8px">Codepage</label>
      <SelectInput   v-model="form.printerCodepage" >
        <option value="windows-1252">Windows-1252 (CP1252)</option>
        <option value="cp437">CP437</option>
        <option value="cp850">CP850</option>
        <option value="cp852">CP852</option>
        <option value="iso-8859-1">ISO-8859-1</option>
        <option value="utf8">UTF-8</option>
      </SelectInput>
      <label style="display:flex;align-items:center;margin-top:8px"><input type="checkbox" v-model="form.dryRun" style="margin-right:8px"/> DRY_RUN (não envia ao dispositivo)</label>
    </div>

    <div style="margin-top:8px">
      <button @click="generateToken" :disabled="agentDetecting || !autoDetected">Gerar token</button>
      <button @click="detectAgent" :disabled="agentDetecting">Atualizar impressoras</button>
      <button @click="testPrint" :disabled="(!form.printer && !form.printerInterface) || agentDetecting">Testar impressão</button>
    </div>

    <div style="margin-top:12px">
      <button @click="save">Salvar (localStorage)</button>
    </div>

    <div style="margin-top:12px;color:#666">
      <div v-if="status">{{ status }}</div>
      <div v-if="form.token"><strong>Token (visível apenas uma vez):</strong> <code>{{ form.token }}</code></div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import config from '../config'
import api from '../api'

const printers = ref([])
const status = ref('')
const agentDetecting = ref(false)

// Default printerCodepage set to the most common Windows printing codepage
const form = reactive({ backend: '', storeIds: '', token: '', printer: '', printerInterface: '', printerType: 'EPSON', printerCodepage: 'utf8', dryRun: true })
const autoDetected = ref(false)

onMounted(async () => {
  status.value = 'Buscando configuração padrão do backend...'
  try {
    const { data } = await api.get('/agent-setup')
    form.backend = data.socketUrl || config.API_URL
    form.storeIds = (data.storeIds || []).join(',')
    // tokenHint is only informational
    if (data.tokenHint) status.value = `Token existente: ${data.tokenHint}`
    autoDetected.value = true
    // immediately populate printers from local agent
    await detectAgent()
    status.value = `Detectado backend e ${data.storeIds?.length || 0} storeId(s). Apenas escolha a impressora.`
  } catch (e) {
    status.value = 'Não foi possível buscar configuração do backend: ' + (e && e.message ? e.message : e)
  }
})

async function detectAgent() {
  agentDetecting.value = true
  status.value = 'Consultando agente local (http://localhost:4000/printers)...'
  try {
    const res = await fetch('http://localhost:4000/printers')
    if (!res.ok) throw new Error('HTTP ' + res.status)
    const data = await res.json()
    printers.value = data.map(p => ({ name: p.name, default: p.default }))
    status.value = `Encontradas ${printers.value.length} impressoras via agente local.`
  } catch (e) {
    status.value = 'Erro consultando agente local: ' + (e && e.message ? e.message : e)
  } finally {
    agentDetecting.value = false
  }
}

async function generateToken() {
  status.value = 'Gerando token...'
  try {
    const { data } = await api.post('/agent-setup/token')
    form.token = data.token
    // persist token locally so the save step includes it
    try { const saved = JSON.parse(localStorage.getItem('printerSetup') || '{}'); saved.token = data.token; localStorage.setItem('printerSetup', JSON.stringify(saved)); } catch(e){}
    status.value = 'Token gerado — copie e guarde em segurança.'
  } catch (e) {
    status.value = 'Falha ao gerar token: ' + (e?.response?.data?.message || e.message || e)
  }
}

async function testPrint() {
  status.value = 'Solicitando teste de impressão...'
  try {
    const sids = String(form.storeIds || '').split(',').map(s=>s.trim()).filter(Boolean)
    const storeId = sids[0]
    if (!storeId) { status.value = 'Nenhum storeId configurado'; return }
    const body = {
      storeId,
      printerName: form.printer || null,
      printerInterface: form.printerInterface || null,
      printerType: form.printerType || null,
      printerCodepage: form.printerCodepage || null,
      dryRun: Boolean(form.dryRun),
      text: 'Teste de impressão — Delivery'
    }
    const { data } = await api.post('/agent-setup/print-test', body)
    status.value = 'Resposta do agente: ' + JSON.stringify(data)
  } catch (e) {
    status.value = 'Falha no teste de impressão: ' + (e?.response?.data?.message || e.message || e)
  }
}

function save() {
  try {
    const toSave = { backend: form.backend, storeIds: form.storeIds, token: form.token, printer: form.printer, printerCodepage: form.printerCodepage }
    localStorage.setItem('printerSetup', JSON.stringify(toSave))
    status.value = 'Configuração salva localmente.'
  } catch (e) {
    status.value = 'Falha ao salvar configuração: ' + (e && e.message ? e.message : e)
  }
}

// load saved
try {
  const saved = JSON.parse(localStorage.getItem('printerSetup') || '{}')
  if (saved && Object.keys(saved).length) Object.assign(form, saved)
} catch (e) {}

</script>

<style scoped>
.printer-setup { padding: 12px; max-width: 520px; background: #fff; border: 1px solid #eee }
label { display:block; margin-top:8px; font-weight:600 }
input, select { width:100%; padding:6px; box-sizing:border-box }
button { margin-right:8px }
</style>
