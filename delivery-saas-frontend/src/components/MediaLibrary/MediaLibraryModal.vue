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
        </div>

        <div class="media-library-body">

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
              </div>
            </div>
            <div v-else class="media-library-empty">
              <i class="bi bi-images d-block mb-2" style="font-size:2rem"></i>
              Nenhuma imagem na biblioteca
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
import { assetUrl } from '../../utils/assetUrl.js'
import api from '../../api.js'

const MAX_SIZE = 2 * 1024 * 1024

const { isOpen, activeTab, select, close } = useMediaLibrary()

const fileInput = ref(null)
const isDragOver = ref(false)
const stagedFile = ref(null)
const stagedPreview = ref(null)
const uploadError = ref(null)
const selectedUrl = ref(null)
const uploading = ref(false)
const loading = ref(false)

const libraryItems = ref([])

const canConfirm = computed(() => {
  if (activeTab.value === 'upload') return !!stagedFile.value
  return !!selectedUrl.value
})

watch(isOpen, (open) => {
  if (open) {
    stagedFile.value = null
    stagedPreview.value = null
    uploadError.value = null
    selectedUrl.value = null
    uploading.value = false
    loadLibrary()
  }
})

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
  }
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}
</script>
