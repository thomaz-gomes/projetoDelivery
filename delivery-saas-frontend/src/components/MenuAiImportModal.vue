<template>
  <!-- Modal fullscreen em mobile, centrado em desktop -->
  <div class="modal d-block ai-import-backdrop" tabindex="-1" role="dialog" @click.self="handleBackdropClick">
    <div class="modal-dialog modal-lg modal-dialog-scrollable modal-fullscreen-sm-down" role="document">
      <div class="modal-content">

        <!-- Header -->
        <div class="modal-header">
          <div>
            <h5 class="modal-title mb-0">
              <i class="bi bi-stars me-2 text-warning"></i>Importar Cardápio com IA
            </h5>
            <div v-if="menuName" class="small text-muted mt-1">{{ menuName }}</div>
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

          <!-- STEP 1: Escolher Método -->
          <div v-if="step === 1">
            <p class="text-muted mb-3">Como deseja importar o cardápio?</p>
            <div class="row g-3">
              <div class="col-12 col-sm-4">
                <div
                  class="method-card"
                  :class="{ selected: method === 'link' }"
                  @click="method = 'link'"
                  role="button"
                  tabindex="0"
                  @keydown.enter="method = 'link'"
                >
                  <i class="bi bi-link-45deg method-icon text-primary"></i>
                  <div class="method-title">Por Link</div>
                  <div class="method-desc text-muted small">Cole a URL de um site ou marketplace</div>
                  <div class="text-primary-emphasis small mt-1 fw-semibold">~1 crédito / item</div>
                </div>
              </div>
              <div class="col-12 col-sm-4">
                <div
                  class="method-card"
                  :class="{ selected: method === 'photo' }"
                  @click="method = 'photo'"
                  role="button"
                  tabindex="0"
                  @keydown.enter="method = 'photo'"
                >
                  <i class="bi bi-camera method-icon text-success"></i>
                  <div class="method-title">Por Foto</div>
                  <div class="method-desc text-muted small">Fotos ou screenshots do cardápio</div>
                  <div class="text-primary-emphasis small mt-1 fw-semibold">5 créditos / foto</div>
                </div>
              </div>
              <div class="col-12 col-sm-4">
                <div
                  class="method-card"
                  :class="{ selected: method === 'spreadsheet' }"
                  @click="method = 'spreadsheet'"
                  role="button"
                  tabindex="0"
                  @keydown.enter="method = 'spreadsheet'"
                >
                  <i class="bi bi-file-earmark-spreadsheet method-icon text-warning"></i>
                  <div class="method-title">Por Planilha</div>
                  <div class="method-desc text-muted small">Arquivo .xlsx ou .csv</div>
                  <div class="text-primary-emphasis small mt-1 fw-semibold">~1 crédito / item</div>
                </div>
              </div>
            </div>
          </div>

          <!-- STEP 2: Input -->
          <div v-if="step === 2">

            <!-- Link -->
            <div v-if="method === 'link'">
              <label class="form-label fw-semibold">URL do cardápio</label>
              <input
                v-model="linkUrl"
                type="url"
                class="form-control form-control-lg"
                placeholder="https://exemplo.com/cardapio"
                autofocus
                @keydown.enter="parseContent"
              />
              <div class="form-text">Cole o link do site, cardápio próprio ou página de marketplace.</div>
            </div>

            <!-- Photo -->
            <div v-if="method === 'photo'">
              <label class="form-label fw-semibold">Fotos do cardápio</label>
              <!-- Galeria: seleção múltipla -->
              <input
                ref="photoInput"
                type="file"
                accept="image/*"
                multiple
                class="d-none"
                @change="handleFileChange($event, 'photo')"
              />
              <!-- Câmera: captura direta (mobile) -->
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
                  <div class="dropzone-text mb-3">Selecione as fotos do cardápio</div>
                  <div class="d-flex gap-2 justify-content-center flex-wrap">
                    <button type="button" class="btn btn-outline-primary btn-sm px-3" @click="$refs.photoInput.click()">
                      <i class="bi bi-folder2-open me-1"></i>Galeria
                    </button>
                    <button type="button" class="btn btn-outline-success btn-sm px-3" @click="$refs.cameraInput.click()">
                      <i class="bi bi-camera me-1"></i>Câmera
                    </button>
                  </div>
                  <div class="small text-muted mt-2">Ou arraste as fotos aqui · JPG, PNG, WEBP</div>
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
                <!-- Adicionar da galeria -->
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
                <!-- Tirar foto com câmera -->
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
                {{ photoPreviews.length ? `${photoPreviews.length} foto(s) selecionada(s) — adicione mais pela galeria ou câmera` : 'Adicione fotos de diferentes páginas do cardápio' }}
              </div>
            </div>

            <!-- Spreadsheet -->
            <div v-if="method === 'spreadsheet'">
              <label class="form-label fw-semibold">Planilha de cardápio</label>
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
                  <div class="small text-muted mt-1">.xlsx, .xls, .csv — Colunas: Nome, Descrição, Preço, Categoria</div>
                </div>
                <div v-else class="dropzone-inner">
                  <i class="bi bi-file-earmark-check dropzone-icon text-success"></i>
                  <div class="dropzone-text fw-semibold">{{ sheetFileName }}</div>
                  <div class="small text-muted mt-1">Toque para trocar o arquivo</div>
                </div>
              </div>
            </div>

            <!-- Parse Error -->
            <div v-if="parseError" class="alert alert-danger mt-3">
              <i class="bi bi-exclamation-triangle me-2"></i>{{ parseError }}
            </div>

          </div>

          <!-- STEP 3: Revisão -->
          <div v-if="step === 3">
            <div class="d-flex align-items-center justify-content-between mb-3">
              <div>
                <span class="badge bg-success me-2">{{ totalItems }} itens</span>
                <span class="badge bg-secondary">{{ categories.length }} categorias</span>
              </div>
              <button class="btn btn-sm btn-outline-secondary" @click="step = 2">
                <i class="bi bi-arrow-left me-1"></i>Voltar
              </button>
            </div>

            <!-- Estimativa e validação de créditos -->
            <div v-if="creditEstimate" class="alert d-flex align-items-start gap-2 mb-3"
              :class="canImport ? 'alert-info' : 'alert-danger'" role="alert">
              <i class="bi bi-stars mt-1" style="font-size:1.1rem;flex-shrink:0"></i>
              <div class="flex-grow-1">
                <div>
                  Esta operação consumirá <strong>{{ creditEstimate.totalCost }} crédito(s)</strong>
                  <small class="text-muted ms-1">({{ creditEstimate.itemCount }} itens × {{ creditEstimate.costPerUnit }} crédito cada)</small>
                </div>
                <div v-if="!canImport" class="mt-1 fw-semibold">
                  <i class="bi bi-lock me-1"></i>Saldo atual: {{ aiCreditsStore.balance ?? '—' }} crédito(s).
                  <span v-if="aiCreditsStore.nextResetFormatted()">Renova em {{ aiCreditsStore.nextResetFormatted() }}.</span>
                </div>
              </div>
            </div>

            <div v-if="categories.length === 0" class="alert alert-warning">
              A IA não encontrou itens no conteúdo fornecido. Tente com outro método ou conteúdo.
            </div>

            <div v-for="(cat, ci) in categories" :key="ci" class="review-category mb-3">
              <!-- Category header -->
              <div class="review-cat-header d-flex align-items-center justify-content-between">
                <div class="d-flex align-items-center gap-2">
                  <button
                    class="btn btn-sm btn-link p-0 text-decoration-none"
                    @click="toggleCatCollapse(ci)"
                  >
                    <i class="bi" :class="catCollapsed[ci] ? 'bi-chevron-right' : 'bi-chevron-down'"></i>
                  </button>
                  <input
                    v-model="cat.name"
                    class="form-control form-control-sm review-cat-name"
                    placeholder="Nome da categoria"
                  />
                </div>
                <div class="d-flex align-items-center gap-2">
                  <span class="badge bg-light text-dark border">{{ cat.items.length }}</span>
                  <button class="btn btn-sm btn-outline-danger" @click="removeCategory(ci)" title="Remover categoria">
                    <i class="bi bi-trash"></i>
                  </button>
                </div>
              </div>

              <!-- Items list -->
              <div v-if="!catCollapsed[ci]" class="review-items mt-2">
                <div v-for="(item, ii) in cat.items" :key="ii" class="review-item">
                  <div class="row g-2 align-items-start">
                    <div class="col-12 col-sm-5">
                      <input
                        v-model="item.name"
                        class="form-control form-control-sm"
                        placeholder="Nome do item"
                      />
                    </div>
                    <div class="col-6 col-sm-2">
                      <div class="input-group input-group-sm">
                        <span class="input-group-text">R$</span>
                        <input
                          v-model.number="item.price"
                          type="number"
                          step="0.01"
                          min="0"
                          class="form-control"
                          placeholder="0,00"
                        />
                      </div>
                    </div>
                    <div class="col-6 col-sm-4">
                      <input
                        v-model="item.description"
                        class="form-control form-control-sm"
                        placeholder="Descrição (opcional)"
                      />
                    </div>
                    <div class="col-12 col-sm-1 d-flex justify-content-end">
                      <button class="btn btn-sm btn-outline-danger" @click="removeItem(ci, ii)" title="Remover item">
                        <i class="bi bi-x-lg"></i>
                      </button>
                    </div>
                  </div>
                  <!-- Option groups badges (read-only preview) -->
                  <div v-if="item.optionGroups && item.optionGroups.length" class="mt-1 d-flex flex-wrap gap-1">
                    <span
                      v-for="(og, ogi) in item.optionGroups"
                      :key="ogi"
                      class="badge rounded-pill bg-primary-subtle text-primary-emphasis border border-primary-subtle"
                    >
                      <i class="bi bi-list-check me-1"></i>{{ og.name }}
                      <span class="opacity-75">({{ og.options?.length || 0 }})</span>
                    </span>
                  </div>
                  <hr class="review-item-divider" />
                </div>

                <!-- Add item inline -->
                <button class="btn btn-sm btn-outline-secondary mt-1" @click="addItem(ci)">
                  <i class="bi bi-plus-circle me-1"></i>Adicionar item
                </button>
              </div>
            </div>

            <!-- Add category -->
            <button class="btn btn-outline-secondary btn-sm" @click="addCategory">
              <i class="bi bi-folder-plus me-1"></i>Adicionar categoria
            </button>
          </div>

          <!-- Loading overlay para parse (job assíncrono) -->
          <div v-if="parsing" class="parsing-overlay">
            <div class="text-center px-3">
              <div class="spinner-border text-primary mb-3" role="status">
                <span class="visually-hidden">Analisando...</span>
              </div>
              <div class="fw-semibold">{{ parsingStageLabel }}</div>
              <div class="small text-muted mt-1">{{ parsingStageHint }}</div>
              <!-- Barra de progresso animada (indeterminada) -->
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
                <i class="bi bi-lock me-1"></i>Créditos insuficientes
              </span>
              <span v-else>
                <i class="bi bi-check-circle me-1"></i>Importar {{ totalItems }} itens
                <small v-if="creditEstimate" class="opacity-75 ms-1">(−{{ creditEstimate.totalCost }} créditos)</small>
              </span>
            </button>
          </template>

        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, reactive, onMounted } from 'vue'
import api from '../api'
import Swal from 'sweetalert2'
import { useAiCreditsStore } from '../stores/aiCredits.js'

const props = defineProps({
  menuId: { type: String, required: true },
  menuName: { type: String, default: '' },
})
const emit = defineEmits(['close', 'imported'])

const aiCreditsStore = useAiCreditsStore()

// Estimativa de créditos retornada pelo job após o parse
const creditEstimate = ref(null) // { itemCount, serviceKey, costPerUnit, totalCost }

// Checagem de sobrescrita logo ao abrir o modal
const hasExistingItems = ref(false)

onMounted(async () => {
  // Carrega saldo de créditos para exibir estimativa e bloquear se necessário
  aiCreditsStore.fetch()

  try {
    const res = await api.get('/menu/products', { params: { menuId: props.menuId } })
    hasExistingItems.value = (res.data || []).length > 0
  } catch (_) {}

  if (hasExistingItems.value) {
    const confirm = await Swal.fire({
      title: 'Atenção: Sobrescrever cardápio?',
      html: 'Este cardápio já possui itens cadastrados.<br>Ao importar, <strong>todos os itens existentes serão substituídos</strong>.<br><br>Deseja continuar?',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sim, continuar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#d33',
    })
    if (!confirm.isConfirmed) {
      emit('close')
    }
  }
})

// ── State ──────────────────────────────────────────────────────────────────
const steps = ['Método', 'Conteúdo', 'Revisão']
const step = ref(1)
const method = ref('')
const parsing = ref(false)
const applying = ref(false)
const parseError = ref('')
const dragging = ref(false)

// Link
const linkUrl = ref('')

// Photo (múltiplas imagens)
const photoBase64Array = ref([])
const photoPreviews = ref([])

// Spreadsheet
const sheetFileName = ref('')
const sheetBase64 = ref('')

// Review
const categories = ref([])
const catCollapsed = reactive({})

// ── Computed ───────────────────────────────────────────────────────────────
const canParse = computed(() => {
  if (method.value === 'link') return linkUrl.value.trim().startsWith('http')
  if (method.value === 'photo') return photoBase64Array.value.length > 0
  if (method.value === 'spreadsheet') return !!sheetBase64.value
  return false
})

const totalItems = computed(() =>
  categories.value.reduce((acc, cat) => acc + (cat.items?.length || 0), 0)
)

// Verifica se há créditos suficientes para importar o número atual de itens
const canImport = computed(() => {
  if (totalItems.value === 0) return false
  if (!creditEstimate.value) return true // sem estimativa: não bloqueia (backend vai verificar)
  return aiCreditsStore.hasCredits(creditEstimate.value.totalCost)
})

// ── File Handling ──────────────────────────────────────────────────────────
function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => resolve(e.target.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

async function handleFileChange(event, type) {
  const files = Array.from(event.target.files || [])
  event.target.value = '' // permite re-selecionar os mesmos arquivos
  for (const file of files) await processFile(file, type)
}

async function handleDrop(event, type) {
  dragging.value = false
  const files = Array.from(event.dataTransfer.files || [])
  for (const file of files) await processFile(file, type)
}

async function processFile(file, type) {
  try {
    const base64 = await readFileAsBase64(file)
    if (type === 'photo') {
      photoBase64Array.value.push(base64)
      photoPreviews.value.push(base64)
    } else {
      sheetBase64.value = base64
      sheetFileName.value = file.name
    }
  } catch (e) {
    console.error('File read error', e)
  }
}

function removePhoto(index) {
  photoBase64Array.value.splice(index, 1)
  photoPreviews.value.splice(index, 1)
}

// ── Parse (job assíncrono + polling — sem timeout no axios) ────────────────

// Labels contextuais por estágio do job (vindo do backend via polling)
const jobStage = ref('pending')
const _stageLabelMap = {
  pending:             { label: 'Iniciando...', hint: 'Preparando o processamento' },
  scraping:            { label: 'Carregando o site...', hint: 'Renderizando a página com browser — aguarde' },
  exploring_products:  { label: 'Explorando opcionais dos produtos...', hint: 'Abrindo cada item para capturar complementos e tamanhos' },
  ai_analyzing:        { label: 'Analisando com IA (GPT-4o)...', hint: 'Extraindo itens, categorias e opcionais do cardápio' },
}
const _methodDefaultLabel = {
  link:        { label: 'Carregando o site...', hint: 'Pode levar 30–90 segundos para sites com muitos produtos' },
  photo:       { label: 'Analisando imagem com IA...', hint: 'O GPT-4o Vision está lendo seu cardápio' },
  spreadsheet: { label: 'Processando planilha com IA...', hint: 'Normalizando colunas e extraindo itens' },
}
const parsingStageLabel = computed(() =>
  _stageLabelMap[jobStage.value]?.label || _methodDefaultLabel[method.value]?.label || 'Analisando com IA...'
)
const parsingStageHint = computed(() =>
  _stageLabelMap[jobStage.value]?.hint || _methodDefaultLabel[method.value]?.hint || 'Aguarde...'
)
const parsingElapsed = ref(0)
let _elapsedTimer = null
let _pollTimer = null

async function parseContent() {
  parseError.value = ''
  parsing.value = true
  parsingElapsed.value = 0
  jobStage.value = 'pending'

  // Contador de segundos para feedback visual
  _elapsedTimer = setInterval(() => { parsingElapsed.value++ }, 1000)

  try {
    let input = ''
    if (method.value === 'link') input = linkUrl.value.trim()
    else if (method.value === 'photo') input = photoBase64Array.value
    else if (method.value === 'spreadsheet') input = sheetBase64.value

    // Inicia o job — resposta imediata (sem timeout)
    const res = await api.post('/menu/ai-import/parse', { method: method.value, input }, { timeout: 10000 })
    const { jobId } = res.data

    // Polling do status até done=true
    await new Promise((resolve, reject) => {
      function poll() {
        _pollTimer = setTimeout(async () => {
          try {
            const { data } = await api.get(`/menu/ai-import/parse/${jobId}`, { timeout: 8000 })
            if (data.stage) jobStage.value = data.stage
            // Debug: logar dados no console do browser
            if (data.debug) console.log('[AI Import Debug]', JSON.parse(JSON.stringify(data.debug)))
            if (data.done) {
              if (data.error) reject(new Error(data.error))
              else resolve(data)
            } else {
              poll() // continua polling
            }
          } catch (e) {
            reject(e)
          }
        }, 1500) // poll a cada 1,5s
      }
      poll()
    }).then(data => {
      categories.value = (data.categories || []).map(cat => ({
        name: cat.name,
        items: (cat.items || []).map(item => ({ ...item })),
      }))
      categories.value.forEach((_, i) => { catCollapsed[i] = false })

      // Captura estimativa de créditos enviada pelo backend
      if (data.creditEstimate) creditEstimate.value = data.creditEstimate

      if (categories.value.length === 0) {
        parseError.value = 'A IA não encontrou itens no conteúdo. Tente com uma foto do cardápio.'
        return
      }
      step.value = 3
    })

  } catch (e) {
    if (e.response?.status === 402) {
      parseError.value = e.response.data?.message || 'Créditos de IA insuficientes.'
    } else {
      parseError.value = e.response?.data?.message || e.message || 'Erro ao processar com IA'
    }
  } finally {
    parsing.value = false
    clearInterval(_elapsedTimer)
    clearTimeout(_pollTimer)
  }
}

// ── Review editing ─────────────────────────────────────────────────────────
function toggleCatCollapse(ci) {
  catCollapsed[ci] = !catCollapsed[ci]
}

function removeCategory(ci) {
  categories.value.splice(ci, 1)
}

function removeItem(ci, ii) {
  categories.value[ci].items.splice(ii, 1)
}

function addItem(ci) {
  categories.value[ci].items.push({ name: '', description: '', price: 0, imageUrl: null, optionGroups: [] })
}

function addCategory() {
  const ci = categories.value.length
  categories.value.push({ name: 'Nova Categoria', items: [] })
  catCollapsed[ci] = false
}

// ── Import ─────────────────────────────────────────────────────────────────
async function doImport() {
  applying.value = true
  try {
    // Filter out items with empty names
    const cleanCategories = categories.value
      .map(cat => ({
        name: cat.name,
        items: cat.items
          .filter(item => item.name?.trim())
          .map(item => ({ ...item, optionGroups: item.optionGroups || [] })),
      }))
      .filter(cat => cat.items.length > 0)

    await api.post('/menu/ai-import/apply', {
      menuId: props.menuId,
      overwrite: hasExistingItems.value,
      categories: cleanCategories,
    })

    // Atualizar saldo de créditos após débito bem-sucedido
    aiCreditsStore.fetch()

    Swal.fire({
      toast: true,
      position: 'top-end',
      showConfirmButton: false,
      timer: 3000,
      icon: 'success',
      title: `${totalItems.value} itens importados com sucesso!`,
    })

    emit('imported')
    emit('close')
  } catch (e) {
    if (e.response?.status === 402) {
      Swal.fire({
        icon: 'warning',
        title: 'Créditos de IA insuficientes',
        html: e.response.data?.message || 'Você não possui créditos suficientes para esta operação.',
        footer: aiCreditsStore.nextResetFormatted()
          ? `Seus créditos renovam em ${aiCreditsStore.nextResetFormatted()}`
          : '',
      })
    } else {
      Swal.fire({
        icon: 'error',
        title: 'Erro ao importar',
        text: e.response?.data?.message || e.message || 'Falha ao importar cardápio',
      })
    }
  } finally {
    applying.value = false
  }
}

// ── Backdrop ───────────────────────────────────────────────────────────────
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
.dropzone-preview {
  width: 100%;
  height: 180px;
  position: relative;
}
.preview-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  border-radius: 8px;
}
.preview-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  border-radius: 8px;
  opacity: 0;
  transition: opacity 0.15s;
}
.dropzone:hover .preview-overlay {
  opacity: 1;
}

/* Grid de múltiplas fotos */
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

/* Review */
.review-category {
  background: #f8f9fa;
  border-radius: 10px;
  padding: 12px;
  border: 1px solid #e9ecef;
}
.review-cat-header {
  padding-bottom: 8px;
}
.review-cat-name {
  font-weight: 600;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  padding: 2px 6px;
  transition: border-color 0.15s;
}
.review-cat-name:focus {
  border-color: #86b7fe;
  background: #fff;
  outline: none;
  box-shadow: 0 0 0 3px rgba(13, 110, 253, 0.15);
}
.review-item {
  padding: 6px 0;
}
.review-item-divider {
  margin: 6px 0 0;
  opacity: 0.3;
}
.review-items {
  padding-left: 8px;
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
