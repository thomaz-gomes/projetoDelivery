<template>
  <div class="modal d-block" tabindex="-1" style="z-index:2000;background:rgba(0,0,0,0.5)" @click.self="handleBackdropClick">
    <div class="modal-dialog modal-lg modal-dialog-scrollable modal-fullscreen-sm-down">
      <div class="modal-content">

        <!-- Header -->
        <div class="modal-header">
          <div>
            <h5 class="modal-title mb-0">
              <i class="bi bi-box-seam me-2 text-primary"></i>Importar Nota / Compra
            </h5>
          </div>
          <button type="button" class="btn-close" @click="$emit('close')" :disabled="processing"></button>
        </div>

        <!-- Progress Steps -->
        <div class="modal-header border-0 py-2 px-4">
          <div class="d-flex align-items-center w-100 step-progress">
            <div
              v-for="(label, i) in steps"
              :key="i"
              class="step-item d-flex align-items-center"
              :class="{ active: step === i + 1, done: step > i + 1 }"
            >
              <div class="step-circle">
                <i v-if="step > i + 1" class="bi bi-check-lg"></i>
                <span v-else>{{ i + 1 }}</span>
              </div>
              <span class="step-label d-none d-sm-inline ms-1">{{ label }}</span>
              <div v-if="i < steps.length - 1" class="step-line"></div>
            </div>
          </div>
        </div>

        <!-- Body -->
        <div class="modal-body px-4">

          <!-- STEP 1: Method Selection -->
          <div v-if="step === 1">
            <p class="text-muted mb-3">Como deseja importar a nota?</p>
            <div class="row g-3">
              <div class="col-12 col-sm-6 col-md-3" v-for="m in methods" :key="m.key">
                <div
                  class="method-card"
                  :class="{ selected: method === m.key }"
                  @click="method = m.key"
                  role="button"
                  tabindex="0"
                  @keydown.enter="method = m.key"
                >
                  <i :class="m.icon + ' method-icon'" :style="{ color: m.color }"></i>
                  <div class="method-title">{{ m.title }}</div>
                  <div class="method-desc text-muted small">{{ m.desc }}</div>
                  <div class="text-primary-emphasis small mt-1 fw-semibold" v-if="m.creditLabel">{{ m.creditLabel }}</div>
                </div>
              </div>
            </div>
          </div>

          <!-- STEP 2: Input -->
          <div v-if="step === 2">

            <!-- MDe -->
            <div v-if="method === 'mde'">
              <label class="form-label fw-semibold">Loja</label>
              <select v-model="selectedStoreId" class="form-select mb-3">
                <option value="">Selecione a loja...</option>
                <option v-for="s in stores" :key="s.id" :value="s.id">{{ s.name }}</option>
              </select>

              <button
                class="btn btn-primary mb-3"
                :disabled="!selectedStoreId || mdeLoading"
                @click="syncMde"
              >
                <span v-if="mdeLoading" class="spinner-border spinner-border-sm me-1"></span>
                <i v-else class="bi bi-cloud-download me-1"></i>
                Sincronizar
              </button>

              <div v-if="mdeLoading" class="text-center py-4">
                <div class="spinner-border text-primary" role="status"></div>
                <div class="small text-muted mt-2">Buscando notas no SEFAZ...</div>
              </div>

              <div v-if="mdeNotes.length > 0" class="mt-2">
                <div class="d-flex align-items-center justify-content-between mb-2">
                  <span class="fw-semibold">{{ mdeNotes.length }} nota(s) encontrada(s)</span>
                  <div class="form-check">
                    <input class="form-check-input" type="checkbox" id="mdeSelectAll" :checked="selectedMdeImports.length === mdeNotes.length" @change="toggleAllMde">
                    <label class="form-check-label small" for="mdeSelectAll">Selecionar todas</label>
                  </div>
                </div>
                <div class="list-group">
                  <label
                    v-for="note in mdeNotes"
                    :key="note.id"
                    class="list-group-item list-group-item-action d-flex align-items-center gap-2"
                  >
                    <input class="form-check-input mt-0" type="checkbox" :value="note.id" v-model="selectedMdeImports">
                    <div class="flex-grow-1">
                      <div class="fw-semibold small">{{ note.emitente || 'Emitente desconhecido' }}</div>
                      <div class="text-muted" style="font-size:11px">{{ note.chave || note.id }}</div>
                    </div>
                    <span v-if="note.valor" class="badge bg-light text-dark border">R$ {{ Number(note.valor).toFixed(2) }}</span>
                  </label>
                </div>
              </div>

              <div v-if="!mdeLoading && mdeSynced && mdeNotes.length === 0" class="alert alert-info mt-3">
                <i class="bi bi-info-circle me-1"></i>Nenhuma nota nova encontrada no SEFAZ.
              </div>
            </div>

            <!-- XML Upload -->
            <div v-if="method === 'xml'">
              <label class="form-label fw-semibold">Arquivos XML de NFe</label>
              <input
                ref="xmlInput"
                type="file"
                accept=".xml"
                multiple
                class="d-none"
                @change="handleXmlFiles"
              />
              <div
                class="dropzone"
                :class="{ 'drag-over': dragging }"
                @dragover.prevent="dragging = true"
                @dragleave="dragging = false"
                @drop.prevent="handleXmlDrop"
                @click="$refs.xmlInput.click()"
                role="button"
                tabindex="0"
                @keydown.enter="$refs.xmlInput.click()"
              >
                <div class="dropzone-inner">
                  <i class="bi bi-file-earmark-code dropzone-icon text-muted"></i>
                  <div class="dropzone-text">Arraste os arquivos XML aqui ou toque para selecionar</div>
                  <div class="small text-muted mt-1">Aceita multiplos arquivos .xml de NFe</div>
                </div>
              </div>

              <div v-if="xmlFiles.length > 0" class="mt-3">
                <div class="fw-semibold small mb-2">{{ xmlFiles.length }} arquivo(s) selecionado(s)</div>
                <div class="list-group">
                  <div
                    v-for="(f, i) in xmlFiles"
                    :key="i"
                    class="list-group-item d-flex align-items-center justify-content-between py-2"
                  >
                    <div class="d-flex align-items-center gap-2">
                      <i class="bi bi-file-earmark-code text-success"></i>
                      <span class="small">{{ f.name }}</span>
                    </div>
                    <button class="btn btn-sm btn-outline-danger" @click="removeXmlFile(i)" title="Remover">
                      <i class="bi bi-x-lg"></i>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <!-- Access Key -->
            <div v-if="method === 'access_key'">
              <label class="form-label fw-semibold">Loja</label>
              <select v-model="selectedStoreId" class="form-select mb-3">
                <option value="">Selecione a loja...</option>
                <option v-for="s in stores" :key="s.id" :value="s.id">{{ s.name }}</option>
              </select>

              <label class="form-label fw-semibold">Chave de Acesso (44 digitos)</label>
              <input
                v-model="accessKey"
                type="text"
                class="form-control form-control-lg font-monospace"
                placeholder="0000 0000 0000 0000 0000 0000 0000 0000 0000 0000 0000"
                maxlength="54"
                @keydown.enter="startParse"
              />
              <div class="form-text">
                <span :class="accessKeyDigits === 44 ? 'text-success' : 'text-muted'">
                  {{ accessKeyDigits }}/44 digitos
                </span>
              </div>
            </div>

            <!-- Receipt Photo -->
            <div v-if="method === 'receipt_photo'">
              <label class="form-label fw-semibold">Loja</label>
              <select v-model="selectedStoreId" class="form-select mb-3">
                <option value="">Selecione a loja...</option>
                <option v-for="s in stores" :key="s.id" :value="s.id">{{ s.name }}</option>
              </select>

              <label class="form-label fw-semibold">Foto(s) do recibo</label>
              <input
                ref="photoInput"
                type="file"
                accept="image/*"
                multiple
                class="d-none"
                @change="handlePhotoFiles"
              />
              <input
                ref="cameraInput"
                type="file"
                accept="image/*"
                capture="environment"
                class="d-none"
                @change="handlePhotoFiles"
              />

              <div
                v-if="photoPreviews.length === 0"
                class="dropzone"
                :class="{ 'drag-over': dragging }"
                @dragover.prevent="dragging = true"
                @dragleave="dragging = false"
                @drop.prevent="handlePhotoDrop"
              >
                <div class="dropzone-inner">
                  <i class="bi bi-camera dropzone-icon text-muted"></i>
                  <div class="dropzone-text mb-3">Selecione as fotos do recibo</div>
                  <div class="d-flex gap-2 justify-content-center flex-wrap">
                    <button type="button" class="btn btn-outline-primary btn-sm px-3" @click.stop="$refs.photoInput.click()">
                      <i class="bi bi-folder2-open me-1"></i>Galeria
                    </button>
                    <button type="button" class="btn btn-outline-success btn-sm px-3" @click.stop="$refs.cameraInput.click()">
                      <i class="bi bi-camera me-1"></i>Camera
                    </button>
                  </div>
                  <div class="small text-muted mt-2">Ou arraste as fotos aqui</div>
                </div>
              </div>

              <div
                v-else
                class="photo-grid"
                :class="{ 'drag-over': dragging }"
                @dragover.prevent="dragging = true"
                @dragleave="dragging = false"
                @drop.prevent="handlePhotoDrop"
              >
                <div v-for="(preview, i) in photoPreviews" :key="i" class="photo-thumb">
                  <img :src="preview" :alt="`Foto ${i + 1}`" />
                  <button type="button" class="photo-remove-btn" @click.stop="removePhoto(i)" title="Remover">
                    <i class="bi bi-x-lg"></i>
                  </button>
                </div>
                <div
                  class="photo-add-btn"
                  @click="$refs.photoInput.click()"
                  role="button"
                  tabindex="0"
                  title="Adicionar da galeria"
                >
                  <i class="bi bi-plus-lg"></i>
                </div>
                <div
                  class="photo-add-btn photo-add-btn--camera"
                  @click="$refs.cameraInput.click()"
                  role="button"
                  tabindex="0"
                  title="Tirar foto"
                >
                  <i class="bi bi-camera"></i>
                </div>
              </div>

              <div class="form-text mt-2">
                {{ photoPreviews.length ? `${photoPreviews.length} foto(s) selecionada(s)` : 'Adicione fotos do recibo nao-fiscal' }}
              </div>
              <div class="alert alert-info mt-2 small py-2">
                <i class="bi bi-stars me-1"></i>Custo: <strong>{{ photoCost }} credito(s)</strong> por foto
              </div>
            </div>

            <!-- Parse Error -->
            <div v-if="parseError" class="alert alert-danger mt-3">
              <i class="bi bi-exclamation-triangle me-2"></i>{{ parseError }}
            </div>

          </div>

          <!-- STEP 3: Review (placeholder) -->
          <div v-if="step === 3">
            <div class="text-center py-5">
              <i class="bi bi-tools" style="font-size:3rem;color:#6c757d"></i>
              <h5 class="mt-3 text-muted">Em construcao</h5>
              <p class="text-muted small">A etapa de revisao sera implementada em breve.</p>
              <div v-if="importIds.length > 0" class="mt-3">
                <span class="badge bg-success">{{ importIds.length }} nota(s) processada(s)</span>
              </div>
            </div>
          </div>

          <!-- Loading overlay -->
          <div v-if="processing" class="parsing-overlay">
            <div class="text-center px-3">
              <div class="spinner-border text-primary mb-3" role="status">
                <span class="visually-hidden">Processando...</span>
              </div>
              <div class="fw-semibold">Processando...</div>
              <div class="small text-muted mt-1">Aguarde enquanto analisamos a nota</div>
              <div class="progress mt-3" style="height:4px;width:220px;margin:0 auto">
                <div class="progress-bar progress-bar-striped progress-bar-animated w-100"></div>
              </div>
            </div>
          </div>

        </div>

        <!-- Footer -->
        <div class="modal-footer">
          <button class="btn btn-outline-secondary" @click="$emit('close')" :disabled="processing">Cancelar</button>
          <button v-if="step > 1" class="btn btn-outline-secondary" @click="step--" :disabled="processing">Voltar</button>
          <button v-if="step === 1" class="btn btn-primary" @click="step = 2" :disabled="!method">
            Proximo <i class="bi bi-arrow-right ms-1"></i>
          </button>
          <button v-if="step === 2" class="btn btn-primary" @click="startParse" :disabled="!canParse || processing">
            <span v-if="processing" class="spinner-border spinner-border-sm me-1"></span>
            Analisar
          </button>
        </div>

      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import api from '../api'
import Swal from 'sweetalert2'

const props = defineProps({
  storeId: { type: String, default: null },
})
const emit = defineEmits(['close', 'imported'])

// ── Steps ────────────────────────────────────────────────────────────────────
const steps = ['Metodo', 'Entrada', 'Revisao']
const step = ref(1)

// ── Method Selection ─────────────────────────────────────────────────────────
const method = ref('')
const serviceCosts = ref({})
const photoCost = computed(() => serviceCosts.value['NFE_RECEIPT_PHOTO'] ?? 5)

const methods = computed(() => [
  { key: 'mde', icon: 'bi bi-cloud-download', color: 'var(--primary)', title: 'MDe Automatico', desc: 'Buscar notas direto do SEFAZ', creditLabel: null },
  { key: 'xml', icon: 'bi bi-file-earmark-code', color: '#198754', title: 'Upload XML', desc: 'Envie arquivos .xml de NFe', creditLabel: null },
  { key: 'access_key', icon: 'bi bi-key', color: '#fd7e14', title: 'Chave de Acesso', desc: 'Digite os 44 digitos da nota', creditLabel: null },
  { key: 'receipt_photo', icon: 'bi bi-camera', color: '#6f42c1', title: 'Foto de Recibo', desc: 'Envie foto de recibo nao-fiscal', creditLabel: `${photoCost.value} credito(s) / foto` },
])

// ── Shared State ─────────────────────────────────────────────────────────────
const processing = ref(false)
const parseError = ref('')
const dragging = ref(false)
const stores = ref([])
const selectedStoreId = ref('')
const importIds = ref([])

// ── MDe State ────────────────────────────────────────────────────────────────
const mdeLoading = ref(false)
const mdeSynced = ref(false)
const mdeNotes = ref([])
const selectedMdeImports = ref([])

// ── XML State ────────────────────────────────────────────────────────────────
const xmlFiles = ref([]) // { name, content }

// ── Access Key State ─────────────────────────────────────────────────────────
const accessKey = ref('')
const accessKeyDigits = computed(() => accessKey.value.replace(/\D/g, '').length)

// ── Receipt Photo State ──────────────────────────────────────────────────────
const photoBase64 = ref([])
const photoPreviews = ref([])

// ── Computed ─────────────────────────────────────────────────────────────────
const canParse = computed(() => {
  if (method.value === 'mde') return selectedMdeImports.value.length > 0
  if (method.value === 'xml') return xmlFiles.value.length > 0
  if (method.value === 'access_key') return accessKeyDigits.value === 44 && !!selectedStoreId.value
  if (method.value === 'receipt_photo') return photoBase64.value.length > 0 && !!selectedStoreId.value
  return false
})

// ── On Mount ─────────────────────────────────────────────────────────────────
onMounted(async () => {
  // Pre-select store if prop provided
  if (props.storeId) selectedStoreId.value = props.storeId

  // Load AI credit costs
  try {
    const { data } = await api.get('/ai-credits/services')
    if (data && typeof data === 'object') {
      if (Array.isArray(data)) {
        const map = {}
        for (const s of data) map[s.key] = s.creditsPerUnit
        serviceCosts.value = map
      } else {
        serviceCosts.value = data
      }
    }
  } catch (_) {}

  // Load stores
  try {
    const { data } = await api.get('/stores')
    stores.value = Array.isArray(data) ? data : []
  } catch (_) {}
})

// ── MDe Sync ─────────────────────────────────────────────────────────────────
async function syncMde() {
  mdeLoading.value = true
  mdeSynced.value = false
  mdeNotes.value = []
  selectedMdeImports.value = []
  try {
    const { data } = await api.post('/purchase-imports/mde/sync', { storeId: selectedStoreId.value })
    mdeNotes.value = Array.isArray(data) ? data : (data.notes || data.items || [])
    mdeSynced.value = true
  } catch (e) {
    Swal.fire({ icon: 'error', text: e.response?.data?.message || 'Erro ao sincronizar com SEFAZ' })
  } finally {
    mdeLoading.value = false
  }
}

function toggleAllMde() {
  if (selectedMdeImports.value.length === mdeNotes.value.length) {
    selectedMdeImports.value = []
  } else {
    selectedMdeImports.value = mdeNotes.value.map(n => n.id)
  }
}

// ── XML File Handling ────────────────────────────────────────────────────────
function handleXmlFiles(event) {
  const files = Array.from(event.target.files || [])
  event.target.value = ''
  for (const file of files) readXmlFile(file)
}

function handleXmlDrop(event) {
  dragging.value = false
  const files = Array.from(event.dataTransfer.files || []).filter(f => f.name.endsWith('.xml'))
  for (const file of files) readXmlFile(file)
}

function readXmlFile(file) {
  const reader = new FileReader()
  reader.onload = (e) => {
    xmlFiles.value.push({ name: file.name, content: e.target.result })
  }
  reader.readAsText(file)
}

function removeXmlFile(index) {
  xmlFiles.value.splice(index, 1)
}

// ── Photo Handling ───────────────────────────────────────────────────────────
function handlePhotoFiles(event) {
  const files = Array.from(event.target.files || [])
  event.target.value = ''
  for (const file of files) readPhotoFile(file)
}

function handlePhotoDrop(event) {
  dragging.value = false
  const files = Array.from(event.dataTransfer.files || []).filter(f => f.type.startsWith('image/'))
  for (const file of files) readPhotoFile(file)
}

function readPhotoFile(file) {
  const reader = new FileReader()
  reader.onload = (e) => {
    photoBase64.value.push(e.target.result)
    photoPreviews.value.push(e.target.result)
  }
  reader.readAsDataURL(file)
}

function removePhoto(index) {
  photoBase64.value.splice(index, 1)
  photoPreviews.value.splice(index, 1)
}

// ── Poll Job ─────────────────────────────────────────────────────────────────
async function pollJob(jobId) {
  while (true) {
    const { data } = await api.get(`/purchase-imports/parse/${jobId}`)
    if (data.status === 'done') return data.importId
    if (data.status === 'error') throw new Error(data.error || 'Erro no processamento')
    await new Promise(r => setTimeout(r, 1000))
  }
}

// ── Parse ────────────────────────────────────────────────────────────────────
async function startParse() {
  parseError.value = ''
  processing.value = true
  importIds.value = []

  try {
    const payload = { storeId: selectedStoreId.value }

    if (method.value === 'xml') {
      for (const file of xmlFiles.value) {
        payload.method = 'xml'
        payload.input = file.content
        const { data } = await api.post('/purchase-imports/parse', payload)
        const importId = await pollJob(data.jobId)
        importIds.value.push(importId)
      }
    } else if (method.value === 'access_key') {
      payload.method = 'access_key'
      payload.input = accessKey.value.replace(/\D/g, '')
      const { data } = await api.post('/purchase-imports/parse', payload)
      const importId = await pollJob(data.jobId)
      importIds.value.push(importId)
    } else if (method.value === 'receipt_photo') {
      payload.method = 'receipt_photo'
      payload.input = photoBase64.value
      const { data } = await api.post('/purchase-imports/parse', payload)
      const importId = await pollJob(data.jobId)
      importIds.value.push(importId)
    } else if (method.value === 'mde') {
      importIds.value = [...selectedMdeImports.value]
    }

    // Trigger AI matching for non-photo methods
    for (const id of importIds.value) {
      if (method.value !== 'receipt_photo') {
        await api.post(`/purchase-imports/${id}/match`)
      }
    }

    // Move to step 3 (review - placeholder for now)
    step.value = 3
  } catch (e) {
    parseError.value = e.response?.data?.message || e.message || 'Erro ao processar'
    Swal.fire({ icon: 'error', text: parseError.value })
  } finally {
    processing.value = false
  }
}

// ── Backdrop ─────────────────────────────────────────────────────────────────
function handleBackdropClick() {
  if (!processing.value) emit('close')
}
</script>

<style scoped>
/* Step progress bar */
.step-progress {
  gap: 0;
}
.step-item {
  display: flex;
  align-items: center;
  flex: 1;
}
.step-circle {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: #dee2e6;
  color: #6c757d;
  font-size: 12px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: background 0.2s, color 0.2s;
}
.step-item.active .step-circle {
  background: #0d6efd;
  color: #fff;
}
.step-item.done .step-circle {
  background: #198754;
  color: #fff;
}
.step-label {
  font-size: 13px;
  color: #6c757d;
  white-space: nowrap;
}
.step-item.active .step-label {
  color: #0d6efd;
  font-weight: 600;
}
.step-item.done .step-label {
  color: #198754;
}
.step-line {
  flex: 1;
  height: 2px;
  background: #dee2e6;
  margin: 0 6px;
}

/* Method cards */
.method-card {
  border: 2px solid #dee2e6;
  border-radius: 12px;
  padding: 20px 16px;
  text-align: center;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s, background 0.15s;
  user-select: none;
}
.method-card:hover {
  border-color: #0d6efd;
  box-shadow: 0 2px 8px rgba(13, 110, 253, 0.12);
}
.method-card.selected {
  border-color: #0d6efd;
  background: #f0f5ff;
}
.method-icon {
  font-size: 2rem;
  display: block;
  margin-bottom: 8px;
}
.method-title {
  font-weight: 600;
  font-size: 15px;
}
.method-desc {
  font-size: 12px;
  margin-top: 4px;
}

/* Dropzone */
.dropzone {
  border: 2px dashed #ced4da;
  border-radius: 12px;
  padding: 32px 16px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
  background: #fff;
  position: relative;
  overflow: hidden;
  min-height: 160px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.dropzone:hover,
.dropzone.drag-over {
  border-color: #0d6efd;
  background: #f0f5ff;
}
.dropzone-inner {
  text-align: center;
}
.dropzone-icon {
  font-size: 2.5rem;
  display: block;
  margin-bottom: 8px;
}
.dropzone-text {
  font-size: 14px;
  font-weight: 500;
}

/* Grid de fotos */
.photo-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 12px;
  border: 2px dashed #ced4da;
  border-radius: 12px;
  background: #f8f9fa;
  min-height: 120px;
  transition: border-color 0.15s, background 0.15s;
}
.photo-grid.drag-over {
  border-color: #0d6efd;
  background: #f0f5ff;
}
.photo-thumb {
  position: relative;
  width: 96px;
  height: 96px;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid #dee2e6;
  flex-shrink: 0;
}
.photo-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.photo-remove-btn {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: rgba(220, 53, 69, 0.88);
  color: #fff;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  padding: 0;
  line-height: 1;
}
.photo-remove-btn:hover {
  background: #dc3545;
}
.photo-add-btn {
  width: 96px;
  height: 96px;
  border-radius: 8px;
  border: 2px dashed #ced4da;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: #6c757d;
  font-size: 1.5rem;
  flex-shrink: 0;
  transition: border-color 0.15s, color 0.15s, background 0.15s;
}
.photo-add-btn:hover {
  border-color: #0d6efd;
  color: #0d6efd;
  background: #f0f5ff;
}
.photo-add-btn--camera:hover {
  border-color: #198754;
  color: #198754;
  background: #f0fff4;
}

/* Loading overlay */
.parsing-overlay {
  position: absolute;
  inset: 0;
  background: rgba(255, 255, 255, 0.88);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
  border-radius: 0 0 0.375rem 0.375rem;
}
</style>
