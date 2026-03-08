<template>
  <div class="modal d-block ai-import-backdrop" tabindex="-1" role="dialog" @click.self="handleBackdropClick">
    <div class="modal-dialog modal-xl modal-dialog-scrollable modal-fullscreen-sm-down" role="document">
      <div class="modal-content">

        <!-- Header -->
        <div class="modal-header">
          <div>
            <h5 class="modal-title mb-0">
              <i class="bi bi-stars me-2 text-warning"></i>Importar Fichas Tecnicas com IA
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
            <p class="text-muted mb-3">Como deseja importar as fichas tecnicas?</p>
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
                  <div class="method-desc text-muted small">Fotos ou screenshots das fichas</div>
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
                  <div class="method-desc text-muted small">Arquivo .pdf com fichas tecnicas</div>
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
              <label class="form-label fw-semibold">Fotos das fichas tecnicas</label>
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
              <!-- Sem fotos: dropzone vazio -->
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
                  <div class="dropzone-text mb-3">Selecione as fotos das fichas tecnicas</div>
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
              <!-- Com fotos: grid de miniaturas -->
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
                  @keydown.enter="$refs.photoInput.click()"
                  title="Adicionar da galeria"
                >
                  <i class="bi bi-plus-lg"></i>
                </div>
                <div
                  class="photo-add-btn photo-add-btn--camera"
                  @click="$refs.cameraInput.click()"
                  role="button"
                  tabindex="0"
                  @keydown.enter="$refs.cameraInput.click()"
                  title="Tirar foto"
                >
                  <i class="bi bi-camera"></i>
                </div>
              </div>
              <div class="form-text mt-2">
                {{ photoPreviews.length ? `${photoPreviews.length} foto(s) selecionada(s) — adicione mais pela galeria ou camera` : 'Adicione fotos de diferentes paginas das fichas tecnicas' }}
              </div>
            </div>

            <!-- Spreadsheet -->
            <div v-if="method === 'spreadsheet'">
              <label class="form-label fw-semibold">Planilha de fichas tecnicas</label>
              <div
                class="dropzone"
                :class="{ 'drag-over': dragging, 'has-file': sheetFileName }"
                @dragover.prevent="dragging = true"
                @dragleave="dragging = false"
                @drop.prevent="handleDrop($event, 'spreadsheet')"
                @click="$refs.sheetInput.click()"
                role="button"
                tabindex="0"
                @keydown.enter="$refs.sheetInput.click()"
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
              <label class="form-label fw-semibold">PDF das fichas tecnicas</label>
              <div
                class="dropzone"
                :class="{ 'drag-over': dragging, 'has-file': pdfFileName }"
                @dragover.prevent="dragging = true"
                @dragleave="dragging = false"
                @drop.prevent="handleDrop($event, 'pdf')"
                @click="$refs.pdfInput.click()"
                role="button"
                tabindex="0"
                @keydown.enter="$refs.pdfInput.click()"
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
              <label class="form-label fw-semibold">Documento Word das fichas tecnicas</label>
              <div
                class="dropzone"
                :class="{ 'drag-over': dragging, 'has-file': docxFileName }"
                @dragover.prevent="dragging = true"
                @dragleave="dragging = false"
                @drop.prevent="handleDrop($event, 'docx')"
                @click="$refs.docxInput.click()"
                role="button"
                tabindex="0"
                @keydown.enter="$refs.docxInput.click()"
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
                <span class="badge bg-success me-2">{{ sheets.length }} ficha(s)</span>
                <span class="badge bg-secondary">{{ totalIngredients }} ingredientes</span>
              </div>
              <button class="btn btn-sm btn-outline-secondary" @click="step = 2">
                <i class="bi bi-arrow-left me-1"></i>Voltar
              </button>
            </div>

            <!-- Estimativa e validacao de creditos -->
            <div v-if="creditEstimate" class="alert d-flex align-items-start gap-2 mb-3"
              :class="canImport ? 'alert-info' : 'alert-danger'" role="alert">
              <i class="bi bi-stars mt-1" style="font-size:1.1rem;flex-shrink:0"></i>
              <div class="flex-grow-1">
                <div>
                  Esta operacao consumira <strong>{{ creditEstimate.totalCost }} credito(s)</strong>
                  <small class="text-muted ms-1">({{ creditEstimate.itemCount }} fichas x {{ creditEstimate.costPerUnit }} credito cada)</small>
                </div>
                <div v-if="!canImport" class="mt-1 fw-semibold">
                  <i class="bi bi-lock me-1"></i>Saldo atual: {{ aiCreditsStore.balance ?? '—' }} credito(s).
                  <span v-if="aiCreditsStore.nextResetFormatted()">Renova em {{ aiCreditsStore.nextResetFormatted() }}.</span>
                </div>
              </div>
            </div>

            <div v-if="sheets.length === 0" class="alert alert-warning">
              A IA nao encontrou fichas tecnicas no conteudo fornecido. Tente com outro metodo ou conteudo.
            </div>

            <!-- Sheets accordion -->
            <div v-for="(sheet, si) in sheets" :key="si" class="review-sheet mb-3">
              <!-- Sheet header -->
              <div class="review-sheet-header d-flex align-items-center justify-content-between">
                <div class="d-flex align-items-center gap-2 flex-grow-1">
                  <button
                    class="btn btn-sm btn-link p-0 text-decoration-none"
                    @click="toggleSheetCollapse(si)"
                  >
                    <i class="bi" :class="sheetCollapsed[si] ? 'bi-chevron-right' : 'bi-chevron-down'"></i>
                  </button>
                  <input
                    v-model="sheet.name"
                    class="form-control form-control-sm review-sheet-name"
                    placeholder="Nome da ficha"
                  />
                </div>
                <div class="d-flex align-items-center gap-2">
                  <div class="input-group input-group-sm" style="width: 160px;">
                    <span class="input-group-text">Rend.</span>
                    <input
                      v-model="sheet.yield"
                      type="text"
                      class="form-control"
                      placeholder="Ex: 10 porções"
                    />
                  </div>
                  <span class="badge bg-light text-dark border">{{ sheet.items.length }}</span>
                  <button class="btn btn-sm btn-outline-danger" @click="removeSheet(si)" title="Remover ficha">
                    <i class="bi bi-trash"></i>
                  </button>
                </div>
              </div>

              <!-- Ingredients table -->
              <div v-if="!sheetCollapsed[si]" class="review-ingredients mt-2">
                <div class="table-responsive">
                  <table class="table table-sm table-hover mb-0 align-middle">
                    <thead>
                      <tr>
                        <th style="min-width:180px">Ingrediente Extraido</th>
                        <th style="min-width:200px">Match</th>
                        <th style="width:90px" class="text-center">Confianca</th>
                        <th style="width:100px">Qtd</th>
                        <th style="width:100px">Unidade</th>
                        <th style="width:50px"></th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="(ing, ii) in sheet.items" :key="ii">
                        <!-- Extracted name -->
                        <td>
                          <span class="small text-muted">{{ ing.description }}</span>
                        </td>
                        <!-- Match select -->
                        <td>
                          <template v-if="ing.newIngredient && !ing._selectMode">
                            <span class="badge bg-warning text-dark me-1">
                              <i class="bi bi-plus-circle me-1"></i>Criar novo
                            </span>
                            <button
                              class="btn btn-sm btn-outline-secondary py-0 px-1"
                              @click="ing._selectMode = true"
                              title="Selecionar ingrediente existente"
                            >
                              <i class="bi bi-search" style="font-size:11px"></i>
                            </button>
                          </template>
                          <template v-else>
                            <select
                              v-model="ing.ingredientId"
                              class="form-select form-select-sm"
                              @change="onIngredientSelect(ing)"
                            >
                              <option :value="null">-- Criar novo --</option>
                              <option
                                v-for="existIng in existingIngredients"
                                :key="existIng.id"
                                :value="existIng.id"
                              >
                                {{ existIng.description }}
                              </option>
                            </select>
                          </template>
                        </td>
                        <!-- Confidence badge -->
                        <td class="text-center">
                          <span
                            class="badge"
                            :class="ing.confidence >= 70 ? 'bg-success' : 'bg-warning text-dark'"
                          >
                            {{ ing.confidence ?? 0 }}%
                          </span>
                        </td>
                        <!-- Quantity -->
                        <td>
                          <input
                            v-model.number="ing.quantity"
                            type="number"
                            step="0.001"
                            min="0"
                            class="form-control form-control-sm"
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
                        <!-- Remove -->
                        <td class="text-center">
                          <button class="btn btn-sm btn-outline-danger py-0 px-1" @click="removeIngredient(si, ii)" title="Remover">
                            <i class="bi bi-x-lg" style="font-size:11px"></i>
                          </button>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>

          <!-- Loading overlay para parse (job assincrono) -->
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

          <!-- Step 1 footer -->
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

          <!-- Step 2 footer -->
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

          <!-- Step 3 footer -->
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
                <i class="bi bi-check-circle me-1"></i>Importar {{ sheets.length }} ficha(s)
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
import { ref, computed, reactive, watch, onMounted } from 'vue'
import api from '../api'
import Swal from 'sweetalert2'
import { useAiCreditsStore } from '../stores/aiCredits.js'

const emit = defineEmits(['close', 'imported'])

const aiCreditsStore = useAiCreditsStore()

// Credit estimate returned by job after parse
const creditEstimate = ref(null)

// Existing ingredients for matching
const existingIngredients = ref([])

onMounted(async () => {
  aiCreditsStore.fetch()

  // Load existing ingredients
  try {
    const { data } = await api.get('/ingredients')
    existingIngredients.value = data || []
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

// Photo (multiple images)
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
const sheets = ref([])
const sheetCollapsed = reactive({})

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

const totalIngredients = computed(() =>
  sheets.value.reduce((acc, s) => acc + (s.items?.length || 0), 0)
)

const canImport = computed(() => {
  if (sheets.value.length === 0) return false
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

// -- PDF to images conversion using pdfjs-dist --
async function convertPdfToImages(file) {
  const pdfjsLib = await import('pdfjs-dist')
  // Set worker source
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

// -- DOCX text extraction using mammoth --
async function extractDocxText(file) {
  const mammoth = await import('mammoth')
  const arrayBuffer = await readFileAsArrayBuffer(file)
  const result = await mammoth.extractRawText({ arrayBuffer })
  return result.value
}

// -- Parse (async job + polling) --
const jobStage = ref('pending')
const _stageLabelMap = {
  pending:              { label: 'Iniciando...', hint: 'Preparando o processamento' },
  loading_ingredients:  { label: 'Carregando ingredientes...', hint: 'Buscando ingredientes cadastrados para matching' },
  parsing_file:         { label: 'Processando arquivo...', hint: 'Lendo e preparando o conteúdo do arquivo' },
  processing:           { label: 'Processando...', hint: 'Preparando dados para análise' },
  ai_analyzing:         { label: 'Analisando com IA...', hint: 'Extraindo fichas técnicas e ingredientes' },
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
      // Convert PDF pages to images, send as method='photo'
      jobStage.value = 'pending'
      const images = await convertPdfToImages(pdfFile.value)
      files = images
      sendMethod = 'photo'
    } else if (method.value === 'docx') {
      // Extract text from DOCX, send as method='docx' with text array
      const text = await extractDocxText(docxFile.value)
      files = [text]
      sendMethod = 'docx'
    }

    // Start job
    const res = await api.post('/technical-sheets/ai-import/parse', { method: sendMethod, files }, { timeout: 30000 })
    const { jobId } = res.data

    // Poll status
    await new Promise((resolve, reject) => {
      function poll() {
        _pollTimer = setTimeout(async () => {
          try {
            const { data } = await api.get(`/technical-sheets/ai-import/parse/${jobId}`, { timeout: 8000 })
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
      sheets.value = (data.sheets || []).map(s => ({
        name: s.name || '',
        yield: s.yield ?? null,
        items: (s.items || []).map(item => ({
          description: item.description || '',
          ingredientId: item.matchedIngredientId || null,
          newIngredient: !item.matchedIngredientId,
          _selectMode: !!item.matchedIngredientId,
          confidence: item.confidence ?? 0,
          quantity: item.quantity ?? 0,
          unit: item.unit || 'UN',
        })),
      }))
      sheets.value.forEach((_, i) => { sheetCollapsed[i] = false })

      if (data.creditEstimate) creditEstimate.value = data.creditEstimate

      if (sheets.value.length === 0) {
        parseError.value = 'A IA nao encontrou fichas tecnicas no conteudo. Tente com outro formato.'
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
function toggleSheetCollapse(si) {
  sheetCollapsed[si] = !sheetCollapsed[si]
}

function removeSheet(si) {
  sheets.value.splice(si, 1)
}

function removeIngredient(si, ii) {
  sheets.value[si].items.splice(ii, 1)
}

function onIngredientSelect(ing) {
  if (ing.ingredientId) {
    ing.newIngredient = false
    ing._selectMode = true
  } else {
    ing.newIngredient = true
    ing._selectMode = false
  }
}

// -- Import --
async function doImport() {
  applying.value = true
  try {
    const cleanSheets = sheets.value.map(s => ({
      name: s.name,
      yield: s.yield,
      items: s.items.map(item => ({
        description: item.description,
        ingredientId: item.newIngredient ? null : item.ingredientId,
        newIngredient: item.newIngredient,
        quantity: item.quantity,
        unit: item.unit,
      })),
    }))

    await api.post('/technical-sheets/ai-import/apply', { sheets: cleanSheets })

    aiCreditsStore.fetch()

    Swal.fire({
      toast: true,
      position: 'top-end',
      showConfirmButton: false,
      timer: 3000,
      icon: 'success',
      title: `${sheets.value.length} ficha(s) tecnica(s) importada(s) com sucesso!`,
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
        text: e.response?.data?.message || e.message || 'Falha ao importar fichas tecnicas',
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
.dropzone.has-file {
  border-color: #198754;
  background: #f0fff4;
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

/* Grid de multiplas fotos */
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

/* Review sheets */
.review-sheet {
  background: #f8f9fa;
  border-radius: 10px;
  padding: 12px;
  border: 1px solid #e9ecef;
}
.review-sheet-header {
  padding-bottom: 8px;
}
.review-sheet-name {
  font-weight: 600;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  padding: 2px 6px;
  transition: border-color 0.15s;
}
.review-sheet-name:focus {
  border-color: #86b7fe;
  background: #fff;
  outline: none;
  box-shadow: 0 0 0 3px rgba(13, 110, 253, 0.15);
}
.review-ingredients {
  padding-left: 8px;
}
.review-ingredients .table {
  font-size: 13px;
}
.review-ingredients .table th {
  font-weight: 600;
  font-size: 12px;
  text-transform: uppercase;
  color: #6c757d;
  border-bottom-width: 2px;
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

/* Gap utility fallback */
.gap-2 { gap: 0.5rem; }
</style>
