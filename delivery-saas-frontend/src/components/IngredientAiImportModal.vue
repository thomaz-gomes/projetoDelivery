<template>
  <div class="modal d-block ai-import-backdrop" tabindex="-1" role="dialog" @click.self="handleBackdropClick">
    <div class="modal-dialog modal-xl modal-dialog-scrollable modal-fullscreen-sm-down" role="document">
      <div class="modal-content">

        <!-- Header -->
        <div class="modal-header">
          <div>
            <h5 class="modal-title mb-0">
              <i class="bi bi-stars me-2 text-warning"></i>Importar Ingredientes com IA
            </h5>
          </div>
          <button type="button" class="btn-close" @click="$emit('close')" :disabled="parsing || applying"></button>
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

          <!-- STEP 1: Escolher Metodo -->
          <div v-if="step === 1">
            <p class="text-muted mb-3">Como deseja importar os ingredientes?</p>
            <div class="row g-3">
              <div class="col-6 col-sm-3">
                <div
                  class="method-card"
                  :class="{ selected: method === 'photo' }"
                  @click="method = 'photo'"
                  role="button"
                  tabindex="0"
                  @keydown.enter="method = 'photo'"
                >
                  <i class="bi bi-camera method-icon text-success"></i>
                  <div class="method-title">Foto</div>
                  <div class="method-desc text-muted small">Fotos ou screenshots da lista</div>
                  <div class="text-primary-emphasis small mt-1 fw-semibold">5 credito(s) / arquivo</div>
                </div>
              </div>
              <div class="col-6 col-sm-3">
                <div
                  class="method-card"
                  :class="{ selected: method === 'spreadsheet' }"
                  @click="method = 'spreadsheet'"
                  role="button"
                  tabindex="0"
                  @keydown.enter="method = 'spreadsheet'"
                >
                  <i class="bi bi-file-earmark-spreadsheet method-icon text-warning"></i>
                  <div class="method-title">Planilha</div>
                  <div class="method-desc text-muted small">Arquivo .xlsx, .xls ou .csv</div>
                  <div class="text-primary-emphasis small mt-1 fw-semibold">5 credito(s) / arquivo</div>
                </div>
              </div>
              <div class="col-6 col-sm-3">
                <div
                  class="method-card"
                  :class="{ selected: method === 'pdf' }"
                  @click="method = 'pdf'"
                  role="button"
                  tabindex="0"
                  @keydown.enter="method = 'pdf'"
                >
                  <i class="bi bi-file-earmark-pdf method-icon text-danger"></i>
                  <div class="method-title">PDF</div>
                  <div class="method-desc text-muted small">Arquivo .pdf com ingredientes</div>
                  <div class="text-primary-emphasis small mt-1 fw-semibold">5 credito(s) / arquivo</div>
                </div>
              </div>
              <div class="col-6 col-sm-3">
                <div
                  class="method-card"
                  :class="{ selected: method === 'docx' }"
                  @click="method = 'docx'"
                  role="button"
                  tabindex="0"
                  @keydown.enter="method = 'docx'"
                >
                  <i class="bi bi-file-earmark-word method-icon text-primary"></i>
                  <div class="method-title">Word</div>
                  <div class="method-desc text-muted small">Arquivo .docx ou .doc</div>
                  <div class="text-primary-emphasis small mt-1 fw-semibold">5 credito(s) / arquivo</div>
                </div>
              </div>
            </div>
          </div>

          <!-- STEP 2: Input -->
          <div v-if="step === 2">

            <!-- Photo -->
            <div v-if="method === 'photo'">
              <label class="form-label fw-semibold">Fotos da lista de ingredientes</label>
              <input
                ref="photoInput"
                type="file"
                accept="image/*"
                multiple
                class="d-none"
                @change="handleFileChange($event, 'photo')"
              />
              <input
                ref="cameraInput"
                type="file"
                accept="image/*"
                capture="environment"
                class="d-none"
                @change="handleFileChange($event, 'photo')"
              />
              <div
                v-if="photoPreviews.length === 0"
                class="dropzone"
                :class="{ 'drag-over': dragging }"
                @dragover.prevent="dragging = true"
                @dragleave="dragging = false"
                @drop.prevent="handleDrop($event, 'photo')"
              >
                <div class="dropzone-inner">
                  <i class="bi bi-images dropzone-icon text-muted"></i>
                  <div class="dropzone-text mb-3">Selecione as fotos da lista de ingredientes</div>
                  <div class="d-flex gap-2 justify-content-center flex-wrap">
                    <button type="button" class="btn btn-outline-primary btn-sm px-3" @click="$refs.photoInput.click()">
                      <i class="bi bi-folder2-open me-1"></i>Galeria
                    </button>
                    <button type="button" class="btn btn-outline-success btn-sm px-3" @click="$refs.cameraInput.click()">
                      <i class="bi bi-camera me-1"></i>Camera
                    </button>
                  </div>
                  <div class="small text-muted mt-2">Ou arraste as fotos aqui - JPG, PNG, WEBP</div>
                </div>
              </div>
              <div
                v-else
                class="photo-grid"
                :class="{ 'drag-over': dragging }"
                @dragover.prevent="dragging = true"
                @dragleave="dragging = false"
                @drop.prevent="handleDrop($event, 'photo')"
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
                {{ photoPreviews.length ? `${photoPreviews.length} foto(s) selecionada(s)` : 'Adicione fotos da lista de ingredientes' }}
              </div>
            </div>

            <!-- Spreadsheet -->
            <div v-if="method === 'spreadsheet'">
              <label class="form-label fw-semibold">Planilha de ingredientes</label>
              <div
                class="dropzone"
                :class="{ 'drag-over': dragging, 'has-file': sheetFileName }"
                @dragover.prevent="dragging = true"
                @dragleave="dragging = false"
                @drop.prevent="handleDrop($event, 'spreadsheet')"
                @click="$refs.sheetInput.click()"
                role="button"
                tabindex="0"
              >
                <input
                  ref="sheetInput"
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  class="d-none"
                  @change="handleFileChange($event, 'spreadsheet')"
                />
                <div v-if="!sheetFileName" class="dropzone-inner">
                  <i class="bi bi-file-earmark-spreadsheet dropzone-icon text-muted"></i>
                  <div class="dropzone-text">Arraste a planilha aqui ou toque para selecionar</div>
                  <div class="small text-muted mt-1">.xlsx, .xls, .csv</div>
                </div>
                <div v-else class="dropzone-inner">
                  <i class="bi bi-file-earmark-check dropzone-icon text-success"></i>
                  <div class="dropzone-text fw-semibold">{{ sheetFileName }}</div>
                  <div class="small text-muted mt-1">Toque para trocar o arquivo</div>
                </div>
              </div>
            </div>

            <!-- PDF -->
            <div v-if="method === 'pdf'">
              <label class="form-label fw-semibold">PDF com ingredientes</label>
              <div
                class="dropzone"
                :class="{ 'drag-over': dragging, 'has-file': pdfFileName }"
                @dragover.prevent="dragging = true"
                @dragleave="dragging = false"
                @drop.prevent="handleDrop($event, 'pdf')"
                @click="$refs.pdfInput.click()"
                role="button"
                tabindex="0"
              >
                <input
                  ref="pdfInput"
                  type="file"
                  accept=".pdf"
                  class="d-none"
                  @change="handleFileChange($event, 'pdf')"
                />
                <div v-if="!pdfFileName" class="dropzone-inner">
                  <i class="bi bi-file-earmark-pdf dropzone-icon text-muted"></i>
                  <div class="dropzone-text">Arraste o PDF aqui ou toque para selecionar</div>
                  <div class="small text-muted mt-1">.pdf</div>
                </div>
                <div v-else class="dropzone-inner">
                  <i class="bi bi-file-earmark-check dropzone-icon text-success"></i>
                  <div class="dropzone-text fw-semibold">{{ pdfFileName }}</div>
                  <div class="small text-muted mt-1">Toque para trocar o arquivo</div>
                </div>
              </div>
            </div>

            <!-- DOCX -->
            <div v-if="method === 'docx'">
              <label class="form-label fw-semibold">Documento Word com ingredientes</label>
              <div
                class="dropzone"
                :class="{ 'drag-over': dragging, 'has-file': docxFileName }"
                @dragover.prevent="dragging = true"
                @dragleave="dragging = false"
                @drop.prevent="handleDrop($event, 'docx')"
                @click="$refs.docxInput.click()"
                role="button"
                tabindex="0"
              >
                <input
                  ref="docxInput"
                  type="file"
                  accept=".docx,.doc"
                  class="d-none"
                  @change="handleFileChange($event, 'docx')"
                />
                <div v-if="!docxFileName" class="dropzone-inner">
                  <i class="bi bi-file-earmark-word dropzone-icon text-muted"></i>
                  <div class="dropzone-text">Arraste o documento aqui ou toque para selecionar</div>
                  <div class="small text-muted mt-1">.docx, .doc</div>
                </div>
                <div v-else class="dropzone-inner">
                  <i class="bi bi-file-earmark-check dropzone-icon text-success"></i>
                  <div class="dropzone-text fw-semibold">{{ docxFileName }}</div>
                  <div class="small text-muted mt-1">Toque para trocar o arquivo</div>
                </div>
              </div>
            </div>

            <!-- Parse Error -->
            <div v-if="parseError" class="alert alert-danger mt-3">
              <i class="bi bi-exclamation-triangle me-2"></i>{{ parseError }}
            </div>

          </div>

          <!-- STEP 3: Revisao -->
          <div v-if="step === 3">
            <div class="d-flex align-items-center justify-content-between mb-3">
              <div>
                <span class="badge bg-success me-2">{{ ingredients.length }} ingrediente(s)</span>
              </div>
              <button class="btn btn-sm btn-outline-secondary" @click="step = 2">
                <i class="bi bi-arrow-left me-1"></i>Voltar
              </button>
            </div>

            <!-- Estimativa de creditos -->
            <div v-if="creditEstimate" class="alert d-flex align-items-start gap-2 mb-3"
              :class="canImport ? 'alert-info' : 'alert-danger'" role="alert">
              <i class="bi bi-stars mt-1" style="font-size:1.1rem;flex-shrink:0"></i>
              <div class="flex-grow-1">
                <div>
                  Esta operacao consumira <strong>{{ creditEstimate.totalCost }} credito(s)</strong>
                  <small class="text-muted ms-1">({{ creditEstimate.itemCount }} ingredientes x {{ creditEstimate.costPerUnit }} credito cada)</small>
                </div>
                <div v-if="!canImport" class="mt-1 fw-semibold">
                  <i class="bi bi-lock me-1"></i>Saldo atual: {{ aiCreditsStore.balance ?? '—' }} credito(s).
                  <span v-if="aiCreditsStore.nextResetFormatted()">Renova em {{ aiCreditsStore.nextResetFormatted() }}.</span>
                </div>
              </div>
            </div>

            <div v-if="ingredients.length === 0" class="alert alert-warning">
              A IA nao encontrou ingredientes no conteudo fornecido. Tente com outro metodo ou conteudo.
            </div>

            <!-- Ingredients table -->
            <div class="table-responsive">
              <table class="table table-sm table-hover mb-0 align-middle">
                <thead>
                  <tr>
                    <th style="min-width:200px">Descricao</th>
                    <th style="width:100px">Unidade</th>
                    <th style="width:120px">Custo Medio</th>
                    <th style="min-width:180px">Grupo</th>
                    <th style="width:80px" class="text-center">Estoque</th>
                    <th style="width:70px" class="text-center">CMV</th>
                    <th style="width:100px">Est. Min.</th>
                    <th style="width:50px"></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(ing, i) in ingredients" :key="i">
                    <!-- Description -->
                    <td>
                      <input
                        v-model="ing.description"
                        class="form-control form-control-sm"
                        placeholder="Nome do ingrediente"
                      />
                    </td>
                    <!-- Unit -->
                    <td>
                      <select v-model="ing.unit" class="form-select form-select-sm">
                        <option value="UN">UN</option>
                        <option value="GR">GR</option>
                        <option value="KG">KG</option>
                        <option value="ML">ML</option>
                        <option value="L">L</option>
                      </select>
                    </td>
                    <!-- Avg Cost -->
                    <td>
                      <input
                        v-model.number="ing.avgCost"
                        type="number"
                        step="0.01"
                        min="0"
                        class="form-control form-control-sm"
                        placeholder="R$"
                      />
                    </td>
                    <!-- Group -->
                    <td>
                      <template v-if="ing.newGroup && !ing._selectGroupMode">
                        <div class="d-flex align-items-center gap-1">
                          <span class="badge bg-warning text-dark small">
                            <i class="bi bi-plus-circle me-1"></i>{{ ing.groupName }}
                          </span>
                          <button
                            class="btn btn-sm btn-outline-secondary py-0 px-1"
                            @click="ing._selectGroupMode = true"
                            title="Selecionar grupo existente"
                          >
                            <i class="bi bi-search" style="font-size:11px"></i>
                          </button>
                        </div>
                      </template>
                      <template v-else>
                        <select
                          v-model="ing.groupId"
                          class="form-select form-select-sm"
                          @change="onGroupSelect(ing)"
                        >
                          <option :value="null">-- Sem grupo --</option>
                          <option
                            v-for="g in existingGroups"
                            :key="g.id"
                            :value="g.id"
                          >
                            {{ g.name }}
                          </option>
                        </select>
                      </template>
                    </td>
                    <!-- Controls Stock -->
                    <td class="text-center">
                      <input type="checkbox" class="form-check-input" v-model="ing.controlsStock" />
                    </td>
                    <!-- Composes CMV -->
                    <td class="text-center">
                      <input type="checkbox" class="form-check-input" v-model="ing.composesCmv" />
                    </td>
                    <!-- Min Stock -->
                    <td>
                      <input
                        v-model.number="ing.minStock"
                        type="number"
                        step="0.01"
                        min="0"
                        class="form-control form-control-sm"
                        placeholder="-"
                        :disabled="!ing.controlsStock"
                      />
                    </td>
                    <!-- Remove -->
                    <td class="text-center">
                      <button class="btn btn-sm btn-outline-danger py-0 px-1" @click="removeIngredient(i)" title="Remover">
                        <i class="bi bi-x-lg" style="font-size:11px"></i>
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <!-- Loading overlay -->
          <div v-if="parsing" class="parsing-overlay">
            <div class="text-center px-3">
              <div class="spinner-border text-primary mb-3" role="status">
                <span class="visually-hidden">Analisando...</span>
              </div>
              <div class="fw-semibold">{{ parsingStageLabel }}</div>
              <div class="small text-muted mt-1">{{ parsingStageHint }}</div>
              <div class="progress mt-3" style="height:4px;width:220px;margin:0 auto">
                <div class="progress-bar progress-bar-striped progress-bar-animated w-100"></div>
              </div>
              <div v-if="parsingElapsed > 20" class="small text-muted mt-2">
                {{ parsingElapsed }}s aguardando...
              </div>
            </div>
          </div>

        </div>

        <!-- Footer -->
        <div class="modal-footer">

          <template v-if="step === 1">
            <button class="btn btn-outline-secondary" @click="$emit('close')">Cancelar</button>
            <button
              class="btn btn-primary"
              :disabled="!method"
              @click="step = 2"
            >
              Continuar <i class="bi bi-arrow-right ms-1"></i>
            </button>
          </template>

          <template v-if="step === 2">
            <button class="btn btn-outline-secondary" @click="step = 1" :disabled="parsing">Voltar</button>
            <button
              class="btn btn-primary"
              :disabled="!canParse || parsing"
              @click="parseContent"
            >
              <span v-if="parsing">
                <span class="spinner-border spinner-border-sm me-1"></span>Analisando...
              </span>
              <span v-else>
                <i class="bi bi-stars me-1"></i>Analisar com IA
              </span>
            </button>
          </template>

          <template v-if="step === 3">
            <button class="btn btn-outline-secondary" @click="$emit('close')" :disabled="applying">Cancelar</button>
            <button
              class="btn btn-success"
              :disabled="!canImport || applying"
              @click="doImport"
            >
              <span v-if="applying">
                <span class="spinner-border spinner-border-sm me-1"></span>Importando...
              </span>
              <span v-else-if="!canImport">
                <i class="bi bi-lock me-1"></i>Creditos insuficientes
              </span>
              <span v-else>
                <i class="bi bi-check-circle me-1"></i>Importar {{ ingredients.length }} ingrediente(s)
                <small v-if="creditEstimate" class="opacity-75 ms-1">(-{{ creditEstimate.totalCost }} creditos)</small>
              </span>
            </button>
          </template>

        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import api from '../api'
import Swal from 'sweetalert2'
import { useAiCreditsStore } from '../stores/aiCredits.js'

const emit = defineEmits(['close', 'imported'])

const aiCreditsStore = useAiCreditsStore()

const creditEstimate = ref(null)
const existingGroups = ref([])

onMounted(async () => {
  aiCreditsStore.fetch()
  try {
    const { data } = await api.get('/ingredient-groups')
    existingGroups.value = data || []
  } catch (_) {}
})

// -- State --
const steps = ['Metodo', 'Arquivo', 'Revisao']
const step = ref(1)
const method = ref('')
const parsing = ref(false)
const applying = ref(false)
const parseError = ref('')
const dragging = ref(false)

// Photo
const photoBase64Array = ref([])
const photoPreviews = ref([])

// Spreadsheet
const sheetFileName = ref('')
const sheetBase64 = ref('')

// PDF
const pdfFileName = ref('')
const pdfFile = ref(null)

// DOCX
const docxFileName = ref('')
const docxFile = ref(null)

// Review
const ingredients = ref([])

// Reset file state when method changes
watch(method, () => {
  photoBase64Array.value = []
  photoPreviews.value = []
  sheetFileName.value = ''
  sheetBase64.value = ''
  pdfFileName.value = ''
  pdfFile.value = null
  docxFileName.value = ''
  docxFile.value = null
  parseError.value = ''
})

// -- Computed --
const canParse = computed(() => {
  if (method.value === 'photo') return photoBase64Array.value.length > 0
  if (method.value === 'spreadsheet') return !!sheetBase64.value
  if (method.value === 'pdf') return !!pdfFile.value
  if (method.value === 'docx') return !!docxFile.value
  return false
})

const canImport = computed(() => {
  if (ingredients.value.length === 0) return false
  if (!creditEstimate.value) return true
  return aiCreditsStore.hasCredits(creditEstimate.value.totalCost)
})

// -- File Handling --
function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => resolve(e.target.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => resolve(e.target.result)
    reader.onerror = reject
    reader.readAsArrayBuffer(file)
  })
}

async function handleFileChange(event, type) {
  const files = Array.from(event.target.files || [])
  event.target.value = ''
  for (const file of files) await processFile(file, type)
}

async function handleDrop(event, type) {
  dragging.value = false
  const files = Array.from(event.dataTransfer.files || [])
  for (const file of files) await processFile(file, type)
}

async function processFile(file, type) {
  try {
    if (type === 'photo') {
      const base64 = await readFileAsBase64(file)
      photoBase64Array.value.push(base64)
      photoPreviews.value.push(base64)
    } else if (type === 'spreadsheet') {
      const base64 = await readFileAsBase64(file)
      sheetBase64.value = base64
      sheetFileName.value = file.name
    } else if (type === 'pdf') {
      pdfFile.value = file
      pdfFileName.value = file.name
    } else if (type === 'docx') {
      docxFile.value = file
      docxFileName.value = file.name
    }
  } catch (e) {
    console.error('File read error', e)
  }
}

function removePhoto(index) {
  photoBase64Array.value.splice(index, 1)
  photoPreviews.value.splice(index, 1)
}

// -- PDF to images --
async function convertPdfToImages(file) {
  const pdfjsLib = await import('pdfjs-dist')
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`
  const arrayBuffer = await readFileAsArrayBuffer(file)
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
  const images = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const viewport = page.getViewport({ scale: 2.0 })
    const canvas = document.createElement('canvas')
    canvas.width = viewport.width
    canvas.height = viewport.height
    const ctx = canvas.getContext('2d')
    await page.render({ canvasContext: ctx, viewport }).promise
    images.push(canvas.toDataURL('image/png'))
  }
  return images
}

// -- DOCX text extraction --
async function extractDocxText(file) {
  const mammoth = await import('mammoth')
  const arrayBuffer = await readFileAsArrayBuffer(file)
  const result = await mammoth.extractRawText({ arrayBuffer })
  return result.value
}

// -- Parse --
const jobStage = ref('pending')
const _stageLabelMap = {
  pending:              { label: 'Iniciando...', hint: 'Preparando o processamento' },
  loading_ingredients:  { label: 'Carregando dados...', hint: 'Buscando ingredientes e grupos cadastrados' },
  parsing_file:         { label: 'Processando arquivo...', hint: 'Lendo e preparando o conteudo do arquivo' },
  processing:           { label: 'Processando...', hint: 'Preparando dados para analise' },
  ai_analyzing:         { label: 'Analisando com IA...', hint: 'Extraindo ingredientes do conteudo' },
}
const parsingStageLabel = computed(() =>
  _stageLabelMap[jobStage.value]?.label || 'Analisando com IA...'
)
const parsingStageHint = computed(() =>
  _stageLabelMap[jobStage.value]?.hint || 'Aguarde...'
)
const parsingElapsed = ref(0)
let _elapsedTimer = null
let _pollTimer = null

async function parseContent() {
  parseError.value = ''
  parsing.value = true
  parsingElapsed.value = 0
  jobStage.value = 'pending'

  _elapsedTimer = setInterval(() => { parsingElapsed.value++ }, 1000)

  try {
    let sendMethod = method.value
    let files = []

    if (method.value === 'photo') {
      files = photoBase64Array.value
    } else if (method.value === 'spreadsheet') {
      files = [sheetBase64.value]
    } else if (method.value === 'pdf') {
      jobStage.value = 'pending'
      const images = await convertPdfToImages(pdfFile.value)
      files = images
      sendMethod = 'photo'
    } else if (method.value === 'docx') {
      const text = await extractDocxText(docxFile.value)
      files = [text]
      sendMethod = 'docx'
    }

    const res = await api.post('/ingredients/ai-import/parse', { method: sendMethod, files }, { timeout: 30000 })
    const { jobId } = res.data

    await new Promise((resolve, reject) => {
      function poll() {
        _pollTimer = setTimeout(async () => {
          try {
            const { data } = await api.get(`/ingredients/ai-import/parse/${jobId}`, { timeout: 8000 })
            if (data.stage) jobStage.value = data.stage
            if (data.done) {
              if (data.error) reject(new Error(data.error))
              else resolve(data)
            } else {
              poll()
            }
          } catch (e) {
            reject(e)
          }
        }, 1500)
      }
      poll()
    }).then(data => {
      ingredients.value = (data.ingredients || []).map(ing => ({
        description: ing.description || '',
        unit: ing.unit || 'UN',
        avgCost: ing.avgCost,
        groupId: ing.groupId || null,
        groupName: ing.groupName || null,
        newGroup: !ing.groupId && !!ing.groupName,
        _selectGroupMode: !!ing.groupId,
        controlsStock: ing.controlsStock !== false,
        composesCmv: ing.composesCmv !== false,
        minStock: ing.minStock,
      }))

      // Merge server groups with groups from job
      if (data.existingGroups) {
        existingGroups.value = data.existingGroups
      }

      if (data.creditEstimate) creditEstimate.value = data.creditEstimate

      if (ingredients.value.length === 0) {
        parseError.value = 'A IA nao encontrou ingredientes no conteudo. Tente com outro formato.'
        return
      }
      step.value = 3
    })

  } catch (e) {
    if (e.response?.status === 402) {
      parseError.value = e.response.data?.message || 'Creditos de IA insuficientes.'
    } else {
      parseError.value = e.response?.data?.message || e.message || 'Erro ao processar com IA'
    }
  } finally {
    parsing.value = false
    clearInterval(_elapsedTimer)
    clearTimeout(_pollTimer)
  }
}

// -- Review editing --
function removeIngredient(i) {
  ingredients.value.splice(i, 1)
}

function onGroupSelect(ing) {
  if (ing.groupId) {
    ing.newGroup = false
    ing._selectGroupMode = true
  } else {
    ing.newGroup = false
    ing._selectGroupMode = true
  }
}

// -- Import --
async function doImport() {
  applying.value = true
  try {
    const cleanIngredients = ingredients.value.map(ing => ({
      description: ing.description,
      unit: ing.unit,
      avgCost: ing.avgCost,
      groupId: ing.newGroup ? null : ing.groupId,
      groupName: ing.groupName,
      newGroup: ing.newGroup,
      controlsStock: ing.controlsStock,
      composesCmv: ing.composesCmv,
      minStock: ing.controlsStock ? ing.minStock : null,
    }))

    const { data: result } = await api.post('/ingredients/ai-import/apply', { ingredients: cleanIngredients })

    aiCreditsStore.fetch()

    const groupText = result?.created?.groups ? ` | ${result.created.groups} grupo(s) criado(s)` : ''

    Swal.fire({
      toast: true,
      position: 'top-end',
      showConfirmButton: false,
      timer: 4000,
      icon: 'success',
      title: `${result?.created?.ingredients || 0} ingrediente(s) importado(s)!${groupText}`,
    })

    emit('imported')
    emit('close')
  } catch (e) {
    if (e.response?.status === 402) {
      Swal.fire({
        icon: 'warning',
        title: 'Creditos de IA insuficientes',
        html: e.response.data?.message || 'Voce nao possui creditos suficientes para esta operacao.',
        footer: aiCreditsStore.nextResetFormatted()
          ? `Seus creditos renovam em ${aiCreditsStore.nextResetFormatted()}`
          : '',
      })
    } else {
      Swal.fire({
        icon: 'error',
        title: 'Erro ao importar',
        text: e.response?.data?.message || e.message || 'Falha ao importar ingredientes',
      })
    }
  } finally {
    applying.value = false
  }
}

// -- Backdrop --
function handleBackdropClick() {
  if (!parsing.value && !applying.value) emit('close')
}
</script>

<style scoped>
.ai-import-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 1055;
  display: flex;
  align-items: center;
  justify-content: center;
}

.step-progress { gap: 0; }
.step-item { display: flex; align-items: center; flex: 1; }
.step-circle {
  width: 28px; height: 28px; border-radius: 50%;
  background: #dee2e6; color: #6c757d; font-size: 12px; font-weight: 600;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  transition: background 0.2s, color 0.2s;
}
.step-item.active .step-circle { background: #0d6efd; color: #fff; }
.step-item.done .step-circle { background: #198754; color: #fff; }
.step-label { font-size: 13px; color: #6c757d; white-space: nowrap; }
.step-item.active .step-label { color: #0d6efd; font-weight: 600; }
.step-item.done .step-label { color: #198754; }
.step-line { flex: 1; height: 2px; background: #dee2e6; margin: 0 6px; }

.method-card {
  border: 2px solid #dee2e6; border-radius: 12px; padding: 20px 16px;
  text-align: center; cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s, background 0.15s; user-select: none;
}
.method-card:hover { border-color: #0d6efd; box-shadow: 0 2px 8px rgba(13, 110, 253, 0.12); }
.method-card.selected { border-color: #0d6efd; background: #f0f5ff; }
.method-icon { font-size: 2rem; display: block; margin-bottom: 8px; }
.method-title { font-weight: 600; font-size: 15px; }
.method-desc { font-size: 12px; margin-top: 4px; }

.dropzone {
  border: 2px dashed #ced4da; border-radius: 12px; padding: 32px 16px; cursor: pointer;
  transition: border-color 0.15s, background 0.15s; background: #fff;
  position: relative; overflow: hidden; min-height: 160px;
  display: flex; align-items: center; justify-content: center;
}
.dropzone:hover, .dropzone.drag-over { border-color: #0d6efd; background: #f0f5ff; }
.dropzone.has-file { border-color: #198754; background: #f0fff4; }
.dropzone-inner { text-align: center; }
.dropzone-icon { font-size: 2.5rem; display: block; margin-bottom: 8px; }
.dropzone-text { font-size: 14px; font-weight: 500; }

.photo-grid {
  display: flex; flex-wrap: wrap; gap: 8px; padding: 12px;
  border: 2px dashed #ced4da; border-radius: 12px; background: #f8f9fa;
  min-height: 120px; transition: border-color 0.15s, background 0.15s;
}
.photo-grid.drag-over { border-color: #0d6efd; background: #f0f5ff; }
.photo-thumb {
  position: relative; width: 96px; height: 96px; border-radius: 8px;
  overflow: hidden; border: 1px solid #dee2e6; flex-shrink: 0;
}
.photo-thumb img { width: 100%; height: 100%; object-fit: cover; }
.photo-remove-btn {
  position: absolute; top: 4px; right: 4px; width: 22px; height: 22px;
  border-radius: 50%; background: rgba(220, 53, 69, 0.88); color: #fff;
  border: none; cursor: pointer; display: flex; align-items: center;
  justify-content: center; font-size: 10px; padding: 0; line-height: 1;
}
.photo-remove-btn:hover { background: #dc3545; }
.photo-add-btn {
  width: 96px; height: 96px; border-radius: 8px; border: 2px dashed #ced4da;
  display: flex; align-items: center; justify-content: center; cursor: pointer;
  color: #6c757d; font-size: 1.5rem; flex-shrink: 0;
  transition: border-color 0.15s, color 0.15s, background 0.15s;
}
.photo-add-btn:hover { border-color: #0d6efd; color: #0d6efd; background: #f0f5ff; }
.photo-add-btn--camera:hover { border-color: #198754; color: #198754; background: #f0fff4; }

.parsing-overlay {
  position: absolute; inset: 0; background: rgba(255,255,255,0.92);
  display: flex; align-items: center; justify-content: center; z-index: 10;
  border-radius: 0 0 .5rem .5rem;
}
</style>
