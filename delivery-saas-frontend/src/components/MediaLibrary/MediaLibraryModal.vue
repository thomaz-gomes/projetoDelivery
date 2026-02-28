<template>
  <Teleport to="body">
    <div v-if="isOpen" class="media-library-overlay" @click.self="close">
      <div class="media-library-dialog">

        <div class="media-library-header">
          <h5>Biblioteca de Mídia</h5>
          <button type="button" class="btn-close-ml" @click="close">
            <i class="bi bi-x-lg"></i>
          </button>
        </div>

        <div class="media-library-tabs">
          <button :class="{ active: activeTab === 'upload' }" @click="activeTab = 'upload'">
            <i class="bi bi-cloud-arrow-up me-1"></i>Upload
          </button>
          <button :class="{ active: activeTab === 'library' }" @click="activeTab = 'library'">
            <i class="bi bi-grid-3x3-gap me-1"></i>Biblioteca
          </button>
          <button :class="{ active: activeTab === 'generate' }" @click="activeTab = 'generate'">
            <i class="bi bi-stars me-1"></i>Criar com IA
          </button>
        </div>

        <div class="media-library-body">

          <!-- ── Aba Upload ── -->
          <div v-if="activeTab === 'upload'">
            <div
              class="media-library-dropzone"
              :class="{ 'drag-over': isDragOver }"
              @click="triggerFileInput"
              @dragover.prevent="isDragOver = true"
              @dragleave.prevent="isDragOver = false"
              @drop.prevent="onDrop"
            >
              <div class="media-library-dropzone__icon">
                <i class="bi bi-cloud-arrow-up"></i>
              </div>
              <div class="media-library-dropzone__text">
                Arraste uma imagem ou clique para selecionar
              </div>
              <div class="media-library-dropzone__hint">JPG, PNG — máximo 2 MB</div>
            </div>

            <div v-if="stagedFile" class="media-library-upload-preview">
              <img :src="stagedPreview" alt="" />
              <div class="media-library-upload-preview__info">
                <div class="media-library-upload-preview__name">{{ stagedFile.name }}</div>
                <div class="media-library-upload-preview__size">{{ formatSize(stagedFile.size) }}</div>
              </div>
              <button type="button" class="btn btn-sm btn-outline-danger" @click="clearStaged">
                <i class="bi bi-x-lg"></i>
              </button>
            </div>

            <div v-if="uploadError" class="alert alert-danger mt-3 mb-0 py-2 small">{{ uploadError }}</div>
          </div>

          <!-- ── Aba Biblioteca ── -->
          <div v-if="activeTab === 'library'">
            <div v-if="loading" class="media-library-empty">
              <div class="spinner-border spinner-border-sm text-primary" role="status"></div>
              <span class="ms-2">Carregando...</span>
            </div>
            <div v-else-if="libraryItems.length" class="media-library-grid">
              <div
                v-for="item in libraryItems"
                :key="item.id"
                class="media-library-grid__item"
                :class="{ selected: selectedUrl === item.url }"
                @click="selectedUrl = item.url"
              >
                <img :src="assetUrl(item.url)" :alt="item.filename" />
                <span class="check-badge"><i class="bi bi-check"></i></span>
                <span v-if="item.aiEnhanced" class="ai-badge" title="Editada por IA">
                  <i class="bi bi-stars"></i>
                </span>
                <button
                  type="button"
                  class="ai-studio-trigger"
                  title="Aprimorar no AI Studio"
                  @click.stop="openStudio(item, (newItem) => { libraryItems.unshift(newItem); selectedUrl = newItem.url })"
                >
                  <i class="bi bi-stars"></i>
                </button>
              </div>
            </div>
            <div v-else class="media-library-empty">
              <i class="bi bi-images d-block mb-2" style="font-size:2rem"></i>
              Nenhuma imagem na biblioteca
            </div>
          </div>

          <!-- ── Aba Criar com IA ── -->
          <div v-if="activeTab === 'generate'">

            <!-- Descrição -->
            <div class="mb-3">
              <label class="form-label small fw-semibold">
                <i class="bi bi-pencil me-1"></i>Descreva o produto
              </label>
              <textarea
                class="form-control"
                rows="3"
                v-model="genDescription"
                :disabled="genLoading"
                placeholder="Ex: Pizza margherita com queijo mozzarella derretido e manjericão fresco sobre molho de tomate artesanal, borda dourada e crocante"
              ></textarea>
              <div class="form-text">Descreva ingredientes, textura e aparência do prato com detalhes</div>
            </div>

            <!-- Seletor de Estilo -->
            <div class="mb-3">
              <label class="form-label small fw-semibold">
                <i class="bi bi-palette me-1"></i>Estilo Fotográfico
              </label>
              <div class="ml-gen-style-grid">
                <label
                  v-for="s in GEN_STYLES"
                  :key="s.key"
                  :class="['ml-gen-style-card', { active: genStyle === s.key }]"
                >
                  <input type="radio" :value="s.key" v-model="genStyle" class="d-none" :disabled="genLoading" />
                  <span class="ml-gen-style-icon">{{ s.emoji }}</span>
                  <span class="ml-gen-style-name">{{ s.name }}</span>
                  <span class="ml-gen-style-desc">{{ s.desc }}</span>
                </label>
              </div>
            </div>

            <!-- Seletor de Ângulo -->
            <div class="mb-3">
              <label class="form-label small fw-semibold">
                <i class="bi bi-camera me-1"></i>Ângulo de Câmera
              </label>
              <div class="ml-gen-angle-grid">
                <label
                  v-for="a in GEN_ANGLES"
                  :key="a.key"
                  :class="['ml-gen-angle-card', { active: genAngle === a.key }]"
                >
                  <input type="radio" :value="a.key" v-model="genAngle" class="d-none" :disabled="genLoading" />
                  <span class="ml-gen-angle-icon">{{ a.emoji }}</span>
                  <span class="ml-gen-angle-name">{{ a.name }}</span>
                  <span class="ml-gen-angle-sub">{{ a.sub }}</span>
                </label>
              </div>
            </div>

            <!-- Créditos + Botão Gerar -->
            <div class="d-flex align-items-center gap-2 mb-3 flex-wrap">
              <span class="badge bg-warning text-dark px-3 py-2">
                <i class="bi bi-lightning-charge-fill me-1"></i>Custo: <strong>10</strong> créditos
              </span>
              <button
                type="button"
                class="btn btn-warning btn-sm fw-bold ms-auto"
                :disabled="!genDescription.trim() || genLoading"
                @click="generateImage"
              >
                <span v-if="genLoading" class="spinner-border spinner-border-sm me-1" role="status"></span>
                <i v-else class="bi bi-stars me-1"></i>
                {{ genLoading ? 'Gerando...' : 'Gerar Imagem' }}
              </button>
            </div>

            <!-- Loading -->
            <div v-if="genLoading" class="text-center py-4">
              <div class="spinner-border text-warning" style="width:2.5rem;height:2.5rem" role="status"></div>
              <p class="text-muted small mt-2 mb-0">Gerando imagem com IA...<br>Isso pode levar até 2 minutos.</p>
            </div>

            <!-- Erro -->
            <div v-if="genError" class="alert alert-danger py-2 small mb-0">
              <i class="bi bi-exclamation-triangle me-1"></i>{{ genError }}
            </div>

            <!-- Preview do resultado -->
            <div v-if="genMedia && !genLoading" class="ml-gen-preview">
              <img :src="assetUrl(genMedia.url)" :alt="genMedia.filename" />
              <div class="ml-gen-preview-info">
                <i class="bi bi-stars text-warning me-1"></i>
                <span class="small">Imagem gerada — clique <strong>Usar imagem</strong> para selecionar</span>
                <button type="button" class="btn btn-link btn-sm p-0 ms-2 text-muted" @click="genMedia = null; genError = null">
                  Gerar novamente
                </button>
              </div>
            </div>

          </div>

        </div>

        <div class="media-library-footer">
          <button type="button" class="btn btn-secondary btn-sm" @click="close">Cancelar</button>
          <button
            type="button"
            class="btn btn-primary btn-sm"
            :disabled="!canConfirm || uploading"
            @click="confirm"
          >
            <span v-if="uploading" class="spinner-border spinner-border-sm me-1" role="status"></span>
            Usar imagem
          </button>
        </div>

      </div>
    </div>
  </Teleport>

  <input ref="fileInput" type="file" accept="image/jpeg,image/png" style="display:none" @change="onFileChange" />
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { useMediaLibrary } from '../../composables/useMediaLibrary.js'
import { useAiStudio } from '../../composables/useAiStudio.js'
import { assetUrl } from '../../utils/assetUrl.js'
import api from '../../api.js'

const MAX_SIZE = 2 * 1024 * 1024

const { isOpen, activeTab, select, close } = useMediaLibrary()
const { openStudio } = useAiStudio()

// ── Upload state ──
const fileInput = ref(null)
const isDragOver = ref(false)
const stagedFile = ref(null)
const stagedPreview = ref(null)
const uploadError = ref(null)
const uploading = ref(false)

// ── Library state ──
const selectedUrl = ref(null)
const loading = ref(false)
const libraryItems = ref([])

// ── Generate (Criar com IA) state ──
const genDescription = ref('')
const genStyle = ref('minimal')
const genAngle = ref('standard')
const genMedia = ref(null)
const genError = ref(null)
const genLoading = ref(false)

const GEN_STYLES = [
  { key: 'minimal', name: 'Minimalista', emoji: '🤍', desc: 'Fundo branco, luz estúdio' },
  { key: 'rustic',  name: 'Rústico',     emoji: '🪵', desc: 'Madeira escura, luz quente' },
  { key: 'dark',    name: 'Dark Mood',   emoji: '🖤', desc: 'Fundo preto, luz lateral' },
  { key: 'vibrant', name: 'Vibrante',    emoji: '🌈', desc: 'Cores vivas, estilo delivery' },
]

const GEN_ANGLES = [
  { key: 'top',      name: 'Top (90°)',      emoji: '⬆️', sub: 'Pizzas, Bowls' },
  { key: 'standard', name: 'Standard (45°)', emoji: '↗️', sub: 'Pratos, Burgers' },
  { key: 'hero',     name: 'Hero (0°)',      emoji: '➡️', sub: 'Sanduíches, Bolos' },
]

// ── Computed ──
const canConfirm = computed(() => {
  if (activeTab.value === 'upload') return !!stagedFile.value
  if (activeTab.value === 'generate') return !!genMedia.value
  return !!selectedUrl.value
})

// ── Reset on open ──
watch(isOpen, (open) => {
  if (open) {
    stagedFile.value = null
    stagedPreview.value = null
    uploadError.value = null
    selectedUrl.value = null
    uploading.value = false
    genDescription.value = ''
    genStyle.value = 'minimal'
    genAngle.value = 'standard'
    genMedia.value = null
    genError.value = null
    genLoading.value = false
    loadLibrary()
  }
})

// ── Library ──
async function loadLibrary() {
  loading.value = true
  try {
    const res = await api.get('/media')
    libraryItems.value = res.data || []
  } catch (e) {
    libraryItems.value = []
  } finally {
    loading.value = false
  }
}

// ── Upload ──
function triggerFileInput() {
  fileInput.value?.click()
}

function onFileChange(e) {
  const f = e.target.files?.[0]
  if (f) stageFile(f)
  try { e.target.value = '' } catch {}
}

function onDrop(e) {
  isDragOver.value = false
  const f = e.dataTransfer?.files?.[0]
  if (f) stageFile(f)
}

function stageFile(file) {
  uploadError.value = null
  if (!file.type.startsWith('image/')) {
    uploadError.value = 'Formato inválido. Use JPG ou PNG.'
    return
  }
  if (file.size > MAX_SIZE) {
    uploadError.value = `Arquivo muito grande (${formatSize(file.size)}). Máximo: 2 MB.`
    return
  }
  stagedFile.value = file
  if (stagedPreview.value) URL.revokeObjectURL(stagedPreview.value)
  stagedPreview.value = URL.createObjectURL(file)
}

function clearStaged() {
  if (stagedPreview.value) URL.revokeObjectURL(stagedPreview.value)
  stagedFile.value = null
  stagedPreview.value = null
  uploadError.value = null
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// ── Gerar com IA ──
async function generateImage() {
  genError.value = null
  genMedia.value = null
  genLoading.value = true
  try {
    const res = await api.post('/ai-studio/generate', {
      description: genDescription.value.trim(),
      style: genStyle.value,
      angle: genAngle.value,
    }, { timeout: 300000 })  // 5 minutos
    genMedia.value = res.data.media
    // Adiciona à biblioteca local para aparecer na aba Biblioteca também
    libraryItems.value.unshift(res.data.media)
  } catch (e) {
    genError.value = e?.response?.data?.message || 'Erro ao gerar imagem. Tente novamente.'
  } finally {
    genLoading.value = false
  }
}

// ── Confirmar seleção ──
async function confirm() {
  if (activeTab.value === 'upload' && stagedFile.value) {
    uploading.value = true
    uploadError.value = null
    try {
      const base64 = await fileToBase64(stagedFile.value)
      const res = await api.post('/media', {
        fileBase64: base64,
        filename: stagedFile.value.name
      })
      const media = res.data
      select(media.url)
      clearStaged()
    } catch (e) {
      uploadError.value = e?.response?.data?.message || 'Erro ao fazer upload.'
    } finally {
      uploading.value = false
    }
  } else if (activeTab.value === 'library' && selectedUrl.value) {
    select(selectedUrl.value)
  } else if (activeTab.value === 'generate' && genMedia.value) {
    select(genMedia.value.url)
  }
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}
</script>
