<template>
  <div class="studio-ia-page">

    <!-- Header -->
    <div class="studio-ia-hero">
      <div class="studio-ia-hero-content">
        <div class="d-flex align-items-center justify-content-between gap-3 mb-2">
          <div>
            <h4 class="mb-0 fw-bold text-white">Studio IA</h4>
            <small class="text-white-50">Crie e aprimore fotos profissionais com inteligência artificial</small>
          </div>
          <span class="badge bg-warning text-dark px-3 py-2">
            <i class="bi bi-lightning-charge-fill me-1"></i>
            Saldo: <strong>{{ balance ?? '...' }}</strong> creditos
          </span>
        </div>
      </div>
    </div>

    <!-- Tabs -->
    <ul class="nav nav-tabs studio-ia-nav mt-3 mb-4">
      <li class="nav-item">
        <a class="nav-link" :class="{ active: tab === 'create' }" href="#" @click.prevent="tab = 'create'">
          <i class="bi bi-plus-circle me-1"></i>Criar do Zero
        </a>
      </li>
      <li class="nav-item">
        <a class="nav-link" :class="{ active: tab === 'pack' }" href="#" @click.prevent="tab = 'pack'">
          <i class="bi bi-grid-3x3-gap me-1"></i>Pack Social
        </a>
      </li>
      <li class="nav-item">
        <a class="nav-link" :class="{ active: tab === 'enhance' }" href="#" @click.prevent="tab = 'enhance'">
          <i class="bi bi-magic me-1"></i>Otimizar Foto
        </a>
      </li>
      <li class="nav-item">
        <a class="nav-link" :class="{ active: tab === 'gallery' }" href="#" @click.prevent="tab = 'gallery'; loadGallery()">
          <i class="bi bi-images me-1"></i>Galeria
        </a>
      </li>
    </ul>

    <div class="studio-ia-body">

      <!-- ── Tab: Criar do Zero ── -->
      <div v-if="tab === 'create'" class="studio-ia-panel">
        <div class="row g-4">
          <div class="col-12 col-lg-5">
            <!-- Imagem de referencia (opcional) -->
            <div class="mb-3">
              <label class="form-label small fw-semibold">
                <i class="bi bi-image me-1"></i>Imagem de referencia <span class="fw-normal text-muted">(opcional)</span>
              </label>
              <div
                class="sia-ref-dropzone"
                :class="{ 'drag-over': refDragOver }"
                @click="$refs.refFileInput.click()"
                @dragover.prevent="refDragOver = true"
                @dragleave.prevent="refDragOver = false"
                @drop.prevent="onRefDrop"
              >
                <div v-if="genRefPreview" class="sia-ref-preview">
                  <img :src="genRefPreview" alt="Referencia" />
                  <button type="button" class="btn btn-sm btn-outline-danger sia-ref-clear" @click.stop="clearGenRef">
                    <i class="bi bi-x-lg"></i>
                  </button>
                </div>
                <template v-else>
                  <i class="bi bi-image-alt" style="font-size:1.5rem;opacity:.35"></i>
                  <span class="small text-muted mt-1">Arraste ou clique para enviar uma foto de referencia</span>
                </template>
              </div>
              <div class="form-text">A IA usara esta foto como base para gerar a imagem no estilo escolhido</div>
              <input ref="refFileInput" type="file" accept="image/jpeg,image/png,image/webp" style="display:none" @change="onRefFileChange" />
            </div>

            <!-- Descricao -->
            <div class="mb-3">
              <label class="form-label small fw-semibold">
                <i class="bi bi-pencil me-1"></i>Descreva a imagem
              </label>
              <textarea
                class="form-control"
                rows="3"
                v-model="genDescription"
                :disabled="genLoading"
                placeholder="Ex: Pizza margherita com queijo mozzarella derretido e manjericao fresco sobre molho de tomate artesanal, borda dourada e crocante"
              ></textarea>
              <div class="form-text">{{ genRefFile ? 'Descreva o que deseja manter ou alterar na imagem de referencia' : 'Descreva ingredientes, textura e aparencia do prato com detalhes' }}</div>
            </div>

            <!-- Estilo -->
            <div class="mb-3">
              <label class="form-label small fw-semibold">
                <i class="bi bi-palette me-1"></i>Estilo Fotografico
              </label>
              <div class="sia-style-grid">
                <label
                  v-for="s in STYLES"
                  :key="s.key"
                  :class="['sia-style-card', { active: genStyle === s.key }]"
                >
                  <input type="radio" :value="s.key" v-model="genStyle" class="d-none" :disabled="genLoading" />
                  <span class="sia-style-icon">{{ s.emoji }}</span>
                  <span class="sia-style-name">{{ s.name }}</span>
                  <span class="sia-style-desc">{{ s.desc }}</span>
                </label>
              </div>
            </div>

            <!-- Angulo -->
            <div class="mb-3">
              <label class="form-label small fw-semibold">
                <i class="bi bi-camera me-1"></i>Angulo de Camera
              </label>
              <div class="sia-angle-grid">
                <label
                  v-for="a in ANGLES"
                  :key="a.key"
                  :class="['sia-angle-card', { active: genAngle === a.key }]"
                >
                  <input type="radio" :value="a.key" v-model="genAngle" class="d-none" :disabled="genLoading" />
                  <span class="sia-angle-icon">{{ a.emoji }}</span>
                  <span class="sia-angle-name">{{ a.name }}</span>
                  <span class="sia-angle-sub">{{ a.sub }}</span>
                </label>
              </div>
            </div>

            <!-- Formato -->
            <div class="mb-3">
              <label class="form-label small fw-semibold">
                <i class="bi bi-aspect-ratio me-1"></i>Formato
              </label>
              <div class="sia-ratio-grid">
                <label
                  v-for="r in RATIOS"
                  :key="r.key"
                  :class="['sia-ratio-card', { active: genRatio === r.key }]"
                >
                  <input type="radio" :value="r.key" v-model="genRatio" class="d-none" :disabled="genLoading" />
                  <span class="sia-ratio-icon" :style="{ aspectRatio: r.preview }"><i class="bi bi-image"></i></span>
                  <span class="sia-ratio-name">{{ r.name }}</span>
                  <span class="sia-ratio-sub">{{ r.sub }}</span>
                </label>
              </div>
            </div>

           

            <div v-if="genError" class="alert alert-danger py-2 small mt-3 mb-0">
              <i class="bi bi-exclamation-triangle me-1"></i>{{ genError }}
            </div>
          </div>

          <!-- Preview -->
          <div class="col-12 col-lg-7">
             <!-- Gerar -->
            <div class="d-flex align-items-center gap-2 flex-wrap mb-4">
              <span class="badge bg-warning text-dark px-3 py-2">
                <i class="bi bi-lightning-charge-fill me-1"></i>Custo: <strong>{{ creditCost ?? '...' }}</strong> creditos
              </span>
              <button
                type="button"
                class="btn btn-warning fw-bold ms-auto"
                :disabled="!genDescription.trim() || genLoading"
                @click="generateFromText"
              >
                <span v-if="genLoading" class="spinner-border spinner-border-sm me-1" role="status"></span>
                <i v-else class="bi bi-stars me-1"></i>
                {{ genLoading ? 'Gerando...' : 'Gerar Imagem' }}
              </button>
            </div>
            <div v-if="genLoading" class="sia-preview-placeholder">
              <div class="spinner-border text-warning" style="width:3rem;height:3rem" role="status"></div>
              <p class="text-muted small mt-3 mb-0">Gerando imagem com IA...<br>Isso pode levar ate 2 minutos.</p>
            </div>
            <div v-else-if="genResult" class="sia-preview-result">
              <img :src="assetUrl(genResult.url)" :alt="genResult.filename" class="sia-preview-img" />
              <div class="sia-preview-actions">
                <button class="btn btn-outline-secondary btn-sm" @click="downloadMedia(genResult)">
                  <i class="bi bi-download me-1"></i>Download
                </button>
                <button class="btn btn-link btn-sm text-muted" @click="genResult = null">
                  <i class="bi bi-arrow-counterclockwise me-1"></i>Gerar outra
                </button>
              </div>
            </div>
            <div v-else class="sia-preview-placeholder">
              <i class="bi bi-image" style="font-size:3rem;opacity:.2"></i>
              <p class="text-muted small mt-2 mb-0">A imagem gerada aparecera aqui</p>
            </div>
          </div>
        </div>
      </div>

      <!-- ── Tab: Pack Social ── -->
      <div v-if="tab === 'pack'" class="studio-ia-panel">
        <div class="row g-4">
          <div class="col-12 col-lg-5">

            <!-- Upload foto do produto (obrigatorio) -->
            <div class="mb-3">
              <label class="form-label small fw-semibold">
                <i class="bi bi-cloud-arrow-up me-1"></i>Foto do produto <span class="fw-normal text-danger">(obrigatorio)</span>
              </label>
              <div
                class="sia-dropzone"
                :class="{ 'drag-over': packDragOver }"
                @click="$refs.packFileInput.click()"
                @dragover.prevent="packDragOver = true"
                @dragleave.prevent="packDragOver = false"
                @drop.prevent="onPackDrop"
              >
                <div v-if="packPreview" class="sia-dropzone-preview">
                  <img :src="packPreview" alt="Produto" />
                  <button type="button" class="btn btn-sm btn-outline-danger sia-dropzone-clear" @click.stop="clearPack">
                    <i class="bi bi-x-lg"></i>
                  </button>
                </div>
                <template v-else>
                  <i class="bi bi-cloud-arrow-up" style="font-size:2rem;opacity:.4"></i>
                  <span class="small text-muted mt-1">Arraste ou clique para enviar</span>
                  <span class="small text-muted" style="font-size:.75rem">JPG, PNG ou WebP — maximo 5 MB</span>
                </template>
              </div>
              <input ref="packFileInput" type="file" accept="image/jpeg,image/png,image/webp" style="display:none" @change="onPackFileChange" />
            </div>

            <!-- Quantidade -->
            <div class="mb-3">
              <label class="form-label small fw-semibold">
                <i class="bi bi-collection me-1"></i>Quantidade de fotos
              </label>
              <div class="sia-qty-grid">
                <label
                  v-for="n in 5"
                  :key="n"
                  :class="['sia-qty-card', { active: packQuantity === n }]"
                >
                  <input type="radio" :value="n" v-model="packQuantity" class="d-none" :disabled="packLoading" />
                  <span class="sia-qty-number">{{ n }}</span>
                  <span class="sia-qty-cost">{{ n }} cred.</span>
                </label>
              </div>
            </div>

            <!-- Formato -->
            <div class="mb-3">
              <label class="form-label small fw-semibold">
                <i class="bi bi-aspect-ratio me-1"></i>Formato
              </label>
              <div class="sia-ratio-grid">
                <label
                  v-for="r in RATIOS"
                  :key="r.key"
                  :class="['sia-ratio-card', { active: packRatio === r.key }]"
                >
                  <input type="radio" :value="r.key" v-model="packRatio" class="d-none" :disabled="packLoading" />
                  <span class="sia-ratio-icon" :style="{ aspectRatio: r.preview }"><i class="bi bi-image"></i></span>
                  <span class="sia-ratio-name">{{ r.name }}</span>
                  <span class="sia-ratio-sub">{{ r.sub }}</span>
                </label>
              </div>
            </div>

            <div v-if="packError" class="alert alert-danger py-2 small mt-3 mb-0">
              <i class="bi bi-exclamation-triangle me-1"></i>{{ packError }}
            </div>
          </div>

          <!-- Preview / Resultado -->
          <div class="col-12 col-lg-7">
            <div class="d-flex align-items-center gap-2 flex-wrap mb-4">
              <span class="badge bg-warning text-dark px-3 py-2">
                <i class="bi bi-lightning-charge-fill me-1"></i>Custo: <strong>{{ packQuantity }}</strong> creditos
              </span>
              <button
                type="button"
                class="btn btn-warning fw-bold ms-auto"
                :disabled="!packFile || packLoading"
                @click="generatePack"
              >
                <span v-if="packLoading" class="spinner-border spinner-border-sm me-1" role="status"></span>
                <i v-else class="bi bi-stars me-1"></i>
                {{ packLoading ? 'Gerando...' : `Gerar ${packQuantity} Fotos` }}
              </button>
            </div>

            <div v-if="packLoading" class="sia-preview-placeholder">
              <div class="spinner-border text-warning" style="width:3rem;height:3rem" role="status"></div>
              <p class="text-muted small mt-3 mb-0">Gerando pack de {{ packQuantity }} fotos com IA...<br>Isso pode levar alguns minutos.</p>
            </div>
            <div v-else-if="packResults.length" class="sia-preview-result">
              <div v-if="packAnalysis" class="mb-3 text-start">
                <span class="badge bg-secondary me-1" v-if="packAnalysis.cuisineType">
                  <i class="bi bi-tag me-1"></i>{{ packAnalysis.cuisineType }}
                </span>
                <span class="badge bg-secondary" v-if="packAnalysis.productName">
                  <i class="bi bi-box me-1"></i>{{ packAnalysis.productName }}
                </span>
              </div>
              <div class="sia-pack-grid" :class="{ 'pack-single': packResults.length === 1 }">
                <div
                  v-for="(item, idx) in packResults"
                  :key="idx"
                  class="sia-pack-item"
                >
                  <img :src="assetUrl(item.url)" :alt="item.filename" />
                  <div class="sia-pack-item-overlay">
                    <button class="btn btn-sm btn-light" @click="downloadMedia(item)" title="Download">
                      <i class="bi bi-download"></i>
                    </button>
                  </div>
                  <span class="sia-pack-badge">{{ idx + 1 }}</span>
                </div>
              </div>
              <div class="sia-preview-actions mt-3">
                <button class="btn btn-outline-secondary btn-sm" @click="downloadAllPack">
                  <i class="bi bi-download me-1"></i>Baixar todas
                </button>
                <button class="btn btn-link btn-sm text-muted" @click="resetPack">
                  <i class="bi bi-arrow-counterclockwise me-1"></i>Gerar outro pack
                </button>
              </div>
            </div>
            <div v-else class="sia-preview-placeholder">
              <i class="bi bi-grid-3x3-gap" style="font-size:3rem;opacity:.2"></i>
              <p class="text-muted small mt-2 mb-0">Envie uma foto e gere seu pack de imagens</p>
            </div>
          </div>
        </div>
      </div>

      <!-- ── Tab: Otimizar Foto ── -->
      <div v-if="tab === 'enhance'" class="studio-ia-panel">
        <div class="row g-4">
          <div class="col-12 col-lg-5">

            <!-- Upload area -->
            <div v-if="!enhancePhase || enhancePhase === 'upload'" class="mb-3">
              <label class="form-label small fw-semibold">
                <i class="bi bi-cloud-arrow-up me-1"></i>Envie a foto para otimizar
              </label>
              <div
                class="sia-dropzone"
                :class="{ 'drag-over': isDragOver }"
                @click="$refs.fileInput.click()"
                @dragover.prevent="isDragOver = true"
                @dragleave.prevent="isDragOver = false"
                @drop.prevent="onDrop"
              >
                <div v-if="enhancePreview" class="sia-dropzone-preview">
                  <img :src="enhancePreview" alt="" />
                  <button type="button" class="btn btn-sm btn-outline-danger sia-dropzone-clear" @click.stop="clearEnhance">
                    <i class="bi bi-x-lg"></i>
                  </button>
                </div>
                <template v-else>
                  <i class="bi bi-cloud-arrow-up" style="font-size:2rem;opacity:.4"></i>
                  <span class="small text-muted mt-1">Arraste ou clique para enviar</span>
                  <span class="small text-muted" style="font-size:.75rem">JPG, PNG — maximo 5 MB</span>
                </template>
              </div>
              <input ref="fileInput" type="file" accept="image/jpeg,image/png,image/webp" style="display:none" @change="onFileChange" />
            </div>

            <!-- Estilo -->
            <div class="mb-3">
              <label class="form-label small fw-semibold">
                <i class="bi bi-palette me-1"></i>Estilo Fotografico
              </label>
              <div class="sia-style-grid">
                <label
                  v-for="s in STYLES"
                  :key="s.key"
                  :class="['sia-style-card', { active: enhanceStyle === s.key }]"
                >
                  <input type="radio" :value="s.key" v-model="enhanceStyle" class="d-none" :disabled="enhanceLoading" />
                  <span class="sia-style-icon">{{ s.emoji }}</span>
                  <span class="sia-style-name">{{ s.name }}</span>
                  <span class="sia-style-desc">{{ s.desc }}</span>
                </label>
              </div>
            </div>

            <!-- Angulo -->
            <div class="mb-3">
              <label class="form-label small fw-semibold">
                <i class="bi bi-camera me-1"></i>Angulo de Camera
              </label>
              <div class="sia-angle-grid">
                <label
                  v-for="a in ANGLES"
                  :key="a.key"
                  :class="['sia-angle-card', { active: enhanceAngle === a.key }]"
                >
                  <input type="radio" :value="a.key" v-model="enhanceAngle" class="d-none" :disabled="enhanceLoading" />
                  <span class="sia-angle-icon">{{ a.emoji }}</span>
                  <span class="sia-angle-name">{{ a.name }}</span>
                  <span class="sia-angle-sub">{{ a.sub }}</span>
                </label>
              </div>
            </div>

            <!-- Formato -->
            <div class="mb-3">
              <label class="form-label small fw-semibold">
                <i class="bi bi-aspect-ratio me-1"></i>Formato
              </label>
              <div class="sia-ratio-grid">
                <label
                  v-for="r in RATIOS"
                  :key="r.key"
                  :class="['sia-ratio-card', { active: enhanceRatio === r.key }]"
                >
                  <input type="radio" :value="r.key" v-model="enhanceRatio" class="d-none" :disabled="enhanceLoading" />
                  <span class="sia-ratio-icon" :style="{ aspectRatio: r.preview }"><i class="bi bi-image"></i></span>
                  <span class="sia-ratio-name">{{ r.name }}</span>
                  <span class="sia-ratio-sub">{{ r.sub }}</span>
                </label>
              </div>
            </div>

            
            <div v-if="enhanceError" class="alert alert-danger py-2 small mt-3 mb-0">
              <i class="bi bi-exclamation-triangle me-1"></i>{{ enhanceError }}
            </div>
          </div>

          <!-- Preview / Resultado -->
          <div class="col-12 col-lg-7">
            <!-- Botao -->
            <div class="d-flex align-items-center gap-2 flex-wrap mb-4">
              <span class="badge bg-warning text-dark px-3 py-2">
                <i class="bi bi-lightning-charge-fill me-1"></i>Custo: <strong>{{ creditCost ?? '...' }}</strong> creditos
              </span>
              <button
                type="button"
                class="btn btn-warning fw-bold ms-auto"
                :disabled="!enhanceFile || enhanceLoading"
                @click="enhanceImage"
              >
                <span v-if="enhanceLoading" class="spinner-border spinner-border-sm me-1" role="status"></span>
                <i v-else class="bi bi-stars me-1"></i>
                {{ enhanceLoading ? 'Otimizando...' : 'Otimizar Foto' }}
              </button>
            </div>

            <div v-if="enhanceLoading" class="sia-preview-placeholder">
              <div class="spinner-border text-warning" style="width:3rem;height:3rem" role="status"></div>
              <p class="text-muted small mt-3 mb-0">Otimizando imagem com IA...<br>Isso pode levar ate 2 minutos.</p>
            </div>
            <div v-else-if="enhanceResult" class="sia-preview-result">
              <div class="sia-compare-wrap">
                <img :src="assetUrl(enhanceResult.url)" alt="Otimizada" class="sia-compare-img" />
                <div class="sia-compare-before" :style="{ clipPath: `inset(0 ${100 - sliderPct}% 0 0)` }">
                  <img :src="enhancePreview" alt="Original" class="sia-compare-img" />
                </div>
                <div class="sia-compare-divider" :style="{ left: sliderPct + '%' }">
                  <div class="sia-compare-handle">
                    <i class="bi bi-chevron-left"></i>
                    <i class="bi bi-chevron-right"></i>
                  </div>
                </div>
                <span class="sia-compare-label left">Original</span>
                <span class="sia-compare-label right">AI Studio</span>
              </div>
              <input type="range" min="0" max="100" v-model.number="sliderPct" class="form-range mt-2" />
              <div class="sia-preview-actions mt-2">
                <button class="btn btn-outline-secondary btn-sm" @click="downloadMedia(enhanceResult)">
                  <i class="bi bi-download me-1"></i>Download
                </button>
                <button class="btn btn-link btn-sm text-muted" @click="resetEnhance">
                  <i class="bi bi-arrow-counterclockwise me-1"></i>Otimizar outra
                </button>
              </div>
            </div>
            <div v-else-if="enhancePreview" class="sia-preview-result">
              <img :src="enhancePreview" alt="Preview" class="sia-preview-img" />
            </div>
            <div v-else class="sia-preview-placeholder">
              <i class="bi bi-image" style="font-size:3rem;opacity:.2"></i>
              <p class="text-muted small mt-2 mb-0">Envie uma foto para otimizar</p>
            </div>
          </div>
        </div>
      </div>

      <!-- ── Tab: Galeria ── -->
      <div v-if="tab === 'gallery'" class="studio-ia-panel">
        <div v-if="galleryLoading" class="text-center py-5">
          <div class="spinner-border text-primary" role="status"></div>
          <p class="text-muted small mt-2">Carregando biblioteca...</p>
        </div>
        <div v-else-if="galleryItems.length" class="sia-gallery-grid">
          <div
            v-for="item in galleryItems"
            :key="item.id"
            class="sia-gallery-item"
          >
            <img :src="assetUrl(item.url)" :alt="item.filename" />
            <div class="sia-gallery-item-overlay">
              <button class="btn btn-sm btn-light" @click="downloadMedia(item)" title="Download">
                <i class="bi bi-download"></i>
              </button>
              <button class="btn btn-sm btn-light" @click="deleteMedia(item)" title="Apagar">
                <i class="bi bi-trash text-danger"></i>
              </button>
            </div>
            <span v-if="item.aiEnhanced" class="sia-gallery-ai-badge" title="Gerada/Otimizada por IA">
              <i class="bi bi-stars"></i>
            </span>
          </div>
        </div>
        <div v-else class="text-center py-5 text-muted">
          <i class="bi bi-images d-block mb-2" style="font-size:2.5rem"></i>
          Nenhuma imagem na biblioteca
        </div>
      </div>

    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useAiCreditsStore } from '../stores/aiCredits.js'
import { assetUrl } from '../utils/assetUrl.js'
import api from '../api.js'
import Swal from 'sweetalert2'

const creditsStore = useAiCreditsStore()

const STYLES = [
  { key: 'minimal', name: 'Minimalista', emoji: '\u{1F90D}', desc: 'Fundo branco, luz estudio' },
  { key: 'rustic',  name: 'Rustico',     emoji: '\u{1FAB5}', desc: 'Madeira escura, luz quente' },
  { key: 'dark',    name: 'Dark Mood',   emoji: '\u{1F5A4}', desc: 'Fundo preto, luz lateral' },
  { key: 'vibrant', name: 'Vibrante',    emoji: '\u{1F308}', desc: 'Cores vivas, estilo delivery' },
]

const ANGLES = [
  { key: 'top',      name: 'Top (90)',      emoji: '\u2B06\uFE0F', sub: 'Pizzas, Bowls' },
  { key: 'standard', name: 'Standard (45)', emoji: '\u2197\uFE0F', sub: 'Pratos, Burgers' },
  { key: 'hero',     name: 'Hero (0)',      emoji: '\u27A1\uFE0F', sub: 'Sanduiches, Bolos' },
]

const RATIOS = [
  { key: '1:1',  name: '1:1',  sub: 'Quadrado',  preview: '1/1' },
  { key: '16:9', name: '16:9', sub: 'Paisagem',   preview: '16/9' },
  { key: '9:16', name: '9:16', sub: 'Retrato',    preview: '9/16' },
]

// ── State ──
const tab = ref('create')
const balance = ref(null)
const creditCost = ref(null)

// Create tab
const genDescription = ref('')
const genStyle = ref('minimal')
const genAngle = ref('standard')
const genLoading = ref(false)
const genError = ref(null)
const genResult = ref(null)
const genRatio = ref('1:1')
const genRefFile = ref(null)
const genRefPreview = ref(null)
const genRefBase64 = ref(null)
const refDragOver = ref(false)

// Pack Social tab
const packFile = ref(null)
const packPreview = ref(null)
const packBase64 = ref(null)
const packQuantity = ref(3)
const packRatio = ref('1:1')
const packLoading = ref(false)
const packError = ref(null)
const packResults = ref([])
const packAnalysis = ref(null)
const packDragOver = ref(false)

// Enhance tab
const enhanceStyle = ref('minimal')
const enhanceAngle = ref('standard')
const enhanceRatio = ref('1:1')
const enhanceFile = ref(null)
const enhancePreview = ref(null)
const enhanceMediaId = ref(null)
const enhanceLoading = ref(false)
const enhanceError = ref(null)
const enhanceResult = ref(null)
const enhancePhase = ref('upload')
const isDragOver = ref(false)
const sliderPct = ref(50)

// Gallery tab
const galleryItems = ref([])
const galleryLoading = ref(false)

// ── Lifecycle ──
onMounted(async () => {
  await creditsStore.fetch()
  balance.value = creditsStore.balance
  try {
    const res = await api.get('/ai-studio/cost')
    creditCost.value = res.data.cost
  } catch {}
})

// ── Reference image (create tab) ──
function onRefFileChange(e) {
  const f = e.target.files?.[0]
  if (f) stageRefFile(f)
  try { e.target.value = '' } catch {}
}

function onRefDrop(e) {
  refDragOver.value = false
  const f = e.dataTransfer?.files?.[0]
  if (f) stageRefFile(f)
}

function stageRefFile(file) {
  if (!file.type.startsWith('image/')) return
  if (file.size > 5 * 1024 * 1024) {
    genError.value = 'Imagem de referencia muito grande. Maximo: 5 MB.'
    return
  }
  genRefFile.value = file
  if (genRefPreview.value) URL.revokeObjectURL(genRefPreview.value)
  genRefPreview.value = URL.createObjectURL(file)
  // Convert to base64
  const reader = new FileReader()
  reader.onload = () => { genRefBase64.value = reader.result }
  reader.readAsDataURL(file)
}

function clearGenRef() {
  genRefFile.value = null
  genRefBase64.value = null
  if (genRefPreview.value) {
    URL.revokeObjectURL(genRefPreview.value)
    genRefPreview.value = null
  }
}

// ── Pack Social ──
function onPackFileChange(e) {
  const f = e.target.files?.[0]
  if (f) stagePackFile(f)
  try { e.target.value = '' } catch {}
}

function onPackDrop(e) {
  packDragOver.value = false
  const f = e.dataTransfer?.files?.[0]
  if (f) stagePackFile(f)
}

function stagePackFile(file) {
  packError.value = null
  if (!file.type.startsWith('image/')) {
    packError.value = 'Formato invalido. Use JPG, PNG ou WebP.'
    return
  }
  if (file.size > 5 * 1024 * 1024) {
    packError.value = 'Arquivo muito grande. Maximo: 5 MB.'
    return
  }
  packFile.value = file
  packResults.value = []
  packAnalysis.value = null
  if (packPreview.value) URL.revokeObjectURL(packPreview.value)
  packPreview.value = URL.createObjectURL(file)
  const reader = new FileReader()
  reader.onload = () => { packBase64.value = reader.result }
  reader.readAsDataURL(file)
}

function clearPack() {
  packFile.value = null
  packBase64.value = null
  packResults.value = []
  packAnalysis.value = null
  if (packPreview.value) {
    URL.revokeObjectURL(packPreview.value)
    packPreview.value = null
  }
}

function resetPack() {
  clearPack()
  packError.value = null
}

async function generatePack() {
  if (!packBase64.value) return
  packError.value = null
  packResults.value = []
  packAnalysis.value = null
  packLoading.value = true
  try {
    const res = await api.post('/ai-studio/generate-pack', {
      photoBase64: packBase64.value,
      quantity: packQuantity.value,
      aspectRatio: packRatio.value,
    }, { timeout: 300000 })
    packResults.value = res.data.media || []
    packAnalysis.value = res.data.analysis || null
    await refreshBalance()
  } catch (e) {
    packError.value = e?.response?.data?.message || 'Erro ao gerar pack. Tente novamente.'
  } finally {
    packLoading.value = false
  }
}

function downloadAllPack() {
  packResults.value.forEach(item => downloadMedia(item))
}

// ── Generate from text (+ optional reference) ──
async function generateFromText() {
  genError.value = null
  genResult.value = null
  genLoading.value = true
  try {
    const payload = {
      description: genDescription.value.trim(),
      style: genStyle.value,
      angle: genAngle.value,
      aspectRatio: genRatio.value,
    }
    if (genRefBase64.value) {
      payload.referenceBase64 = genRefBase64.value
    }
    const res = await api.post('/ai-studio/generate', payload, { timeout: 300000 })
    genResult.value = res.data.media
    await refreshBalance()
  } catch (e) {
    genError.value = e?.response?.data?.message || 'Erro ao gerar imagem. Tente novamente.'
  } finally {
    genLoading.value = false
  }
}

// ── Enhance (upload + optimize) ──
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
  enhanceError.value = null
  if (!file.type.startsWith('image/')) {
    enhanceError.value = 'Formato invalido. Use JPG, PNG ou WebP.'
    return
  }
  if (file.size > 5 * 1024 * 1024) {
    enhanceError.value = 'Arquivo muito grande. Maximo: 5 MB.'
    return
  }
  enhanceFile.value = file
  enhanceResult.value = null
  enhanceMediaId.value = null
  if (enhancePreview.value) URL.revokeObjectURL(enhancePreview.value)
  enhancePreview.value = URL.createObjectURL(file)
}

function clearEnhance() {
  enhanceFile.value = null
  enhanceResult.value = null
  enhanceMediaId.value = null
  if (enhancePreview.value) {
    URL.revokeObjectURL(enhancePreview.value)
    enhancePreview.value = null
  }
}

function resetEnhance() {
  clearEnhance()
  enhancePhase.value = 'upload'
  sliderPct.value = 50
}

async function enhanceImage() {
  if (!enhanceFile.value) return
  enhanceError.value = null
  enhanceResult.value = null
  enhanceLoading.value = true

  try {
    // 1. Upload the image to the media library first
    const reader = new FileReader()
    const base64 = await new Promise((resolve, reject) => {
      reader.onload = () => resolve(reader.result)
      reader.onerror = reject
      reader.readAsDataURL(enhanceFile.value)
    })

    const uploadRes = await api.post('/media', {
      fileBase64: base64,
      filename: enhanceFile.value.name,
    })
    const media = uploadRes.data
    enhanceMediaId.value = media.id

    // 2. Enhance via AI Studio
    const res = await api.post('/ai-studio/enhance', {
      mediaId: media.id,
      style: enhanceStyle.value,
      angle: enhanceAngle.value,
      aspectRatio: enhanceRatio.value,
      mode: 'new',
    }, { timeout: 300000 })

    enhanceResult.value = res.data.media
    enhancePhase.value = 'result'
    sliderPct.value = 50
    await refreshBalance()
  } catch (e) {
    enhanceError.value = e?.response?.data?.message || 'Erro ao otimizar imagem. Tente novamente.'
  } finally {
    enhanceLoading.value = false
  }
}

// ── Gallery ──
async function loadGallery() {
  galleryLoading.value = true
  try {
    const res = await api.get('/media')
    galleryItems.value = res.data || []
  } catch {
    galleryItems.value = []
  } finally {
    galleryLoading.value = false
  }
}

async function deleteMedia(item) {
  const res = await Swal.fire({
    title: 'Apagar imagem?',
    text: 'Esta acao e irreversivel.',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'Apagar',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#dc3545',
  })
  if (!res.isConfirmed) return
  try {
    await api.delete(`/media/${item.id}`)
    galleryItems.value = galleryItems.value.filter(i => i.id !== item.id)
  } catch (e) {
    Swal.fire({ icon: 'error', text: e?.response?.data?.message || 'Erro ao apagar imagem' })
  }
}

// ── Download ──
function downloadMedia(item) {
  const url = assetUrl(item.url)
  const link = document.createElement('a')
  link.href = url
  link.download = item.filename || 'ai_studio.jpg'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

// ── Helpers ──
async function refreshBalance() {
  await creditsStore.fetch()
  balance.value = creditsStore.balance
}
</script>

<style scoped>
/* ── Page Layout ── */
.studio-ia-page {
  max-width: 1100px;
  margin: 0 auto;
}

/* ── Hero ── */
.studio-ia-hero {
    background: #8dbf21;
    border-radius: 16px;
    padding: 1.5rem 2rem;
}

/* ── Tabs ── */
.studio-ia-nav {
  display: inline-flex;
  width: auto;
}

/* ── Panel ── */
.studio-ia-panel {
  background: var(--bg-card);
  border-radius: var(--border-radius);
  border: 1px solid var(--border-color-soft);
  box-shadow: var(--shadow-card);
  padding: 1.5rem;
}

/* ── Style Cards ── */
.sia-style-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.5rem;
}
.sia-style-card {
  border: 2px solid #e9ecef;
  border-radius: 10px;
  padding: 0.5rem 0.65rem;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s, transform 0.1s;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  background: #fff;
  user-select: none;
}
.sia-style-card:hover {
  border-color: #ffd700;
  box-shadow: 0 2px 8px rgba(255, 215, 0, 0.2);
  transform: translateY(-1px);
}
.sia-style-card.active {
  border-color: #ffc107;
  background: #fffbeb;
  box-shadow: 0 2px 12px rgba(255, 193, 7, 0.3);
}
.sia-style-icon { font-size: 1.1rem; line-height: 1; }
.sia-style-name { font-weight: 700; font-size: 0.8rem; }
.sia-style-desc { font-size: 0.68rem; color: #6c757d; }

/* ── Angle Cards ── */
.sia-angle-grid {
  display: flex;
  gap: 0.5rem;
}
.sia-angle-card {
  flex: 1;
  border: 2px solid #e9ecef;
  border-radius: 10px;
  padding: 0.45rem;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 0.1rem;
  background: #fff;
  user-select: none;
}
.sia-angle-card:hover {
  border-color: #0d6efd;
  box-shadow: 0 2px 8px rgba(13, 110, 253, 0.15);
}
.sia-angle-card.active {
  border-color: #0d6efd;
  background: #eff6ff;
}
.sia-angle-icon { font-size: 1rem; }
.sia-angle-name { font-weight: 700; font-size: 0.7rem; }
.sia-angle-sub { font-size: 0.62rem; color: #6c757d; }

/* ── Preview ── */
.sia-preview-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 350px;
  background: #f8f9fa;
  border-radius: 12px;
  border: 2px dashed #dee2e6;
}
.sia-preview-result {
  text-align: center;
}
.sia-preview-img {
  width: 100%;
  max-height: 500px;
  object-fit: contain;
  border-radius: 12px;
  border: 2px solid #e9ecef;
}
.sia-preview-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  margin-top: 0.75rem;
}

/* ── Ratio Cards ── */
.sia-ratio-grid {
  display: flex;
  gap: 0.5rem;
}
.sia-ratio-card {
  flex: 1;
  border: 2px solid #e9ecef;
  border-radius: 10px;
  padding: 0.45rem;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 0.15rem;
  background: #fff;
  user-select: none;
}
.sia-ratio-card:hover {
  border-color: #198754;
  box-shadow: 0 2px 8px rgba(25, 135, 84, 0.15);
}
.sia-ratio-card.active {
  border-color: #198754;
  background: #f0fdf4;
}
.sia-ratio-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  border: 1.5px solid #adb5bd;
  border-radius: 4px;
  font-size: 0.7rem;
  color: #6c757d;
  background: #f8f9fa;
}
.sia-ratio-card.active .sia-ratio-icon {
  border-color: #198754;
  color: #198754;
  background: #d1e7dd;
}
.sia-ratio-name { font-weight: 700; font-size: 0.72rem; }
.sia-ratio-sub { font-size: 0.62rem; color: #6c757d; }

/* ── Reference Dropzone (Create tab) ── */
.sia-ref-dropzone {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100px;
  border: 2px dashed #dee2e6;
  border-radius: 10px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
  background: #f8f9fa;
  position: relative;
  overflow: hidden;
  padding: 0.75rem;
}
.sia-ref-dropzone:hover, .sia-ref-dropzone.drag-over {
  border-color: #0d6efd;
  background: #eff6ff;
}
.sia-ref-preview {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}
.sia-ref-preview img {
  max-height: 120px;
  max-width: 100%;
  object-fit: contain;
  border-radius: 8px;
}
.sia-ref-clear {
  position: absolute;
  top: 2px;
  right: 2px;
}

/* ── Dropzone ── */
.sia-dropzone {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 160px;
  border: 2px dashed #dee2e6;
  border-radius: 12px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
  background: #f8f9fa;
  position: relative;
  overflow: hidden;
}
.sia-dropzone:hover, .sia-dropzone.drag-over {
  border-color: #0d6efd;
  background: #eff6ff;
}
.sia-dropzone-preview {
  position: relative;
  width: 100%;
  height: 100%;
}
.sia-dropzone-preview img {
  width: 100%;
  max-height: 200px;
  object-fit: contain;
}
.sia-dropzone-clear {
  position: absolute;
  top: 6px;
  right: 6px;
}

/* ── Compare (Before/After) ── */
.sia-compare-wrap {
  position: relative;
  width: 100%;
  aspect-ratio: 1;
  border-radius: 12px;
  overflow: hidden;
  border: 2px solid #e9ecef;
  cursor: ew-resize;
  user-select: none;
}
.sia-compare-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.sia-compare-before {
  position: absolute;
  inset: 0;
  overflow: hidden;
}
.sia-compare-before img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.sia-compare-divider {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 3px;
  background: #fff;
  transform: translateX(-50%);
  box-shadow: 0 0 8px rgba(0, 0, 0, 0.4);
  z-index: 2;
  pointer-events: none;
}
.sia-compare-handle {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background: #fff;
  border-radius: 50%;
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  font-size: 0.7rem;
  color: #212529;
}
.sia-compare-label {
  position: absolute;
  top: 10px;
  font-size: 0.66rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  padding: 2px 8px;
  border-radius: 4px;
  z-index: 3;
  pointer-events: none;
}
.sia-compare-label.left { left: 10px; }
.sia-compare-label.right { right: 10px; }

/* ── Gallery ── */
.sia-gallery-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 0.75rem;
}
.sia-gallery-item {
  position: relative;
  border-radius: 10px;
  overflow: hidden;
  border: 2px solid #e9ecef;
  cursor: default;
  aspect-ratio: 1;
}
.sia-gallery-item img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.sia-gallery-item-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  opacity: 0;
  transition: opacity 0.15s;
}
.sia-gallery-item:hover .sia-gallery-item-overlay {
  opacity: 1;
}
.sia-gallery-ai-badge {
  position: absolute;
  top: 6px;
  right: 6px;
  background: rgba(255, 193, 7, 0.9);
  color: #212529;
  border-radius: 6px;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.7rem;
}

/* ── Pack Social: Quantity Cards ── */
.sia-qty-grid {
  display: flex;
  gap: 0.5rem;
}
.sia-qty-card {
  flex: 1;
  border: 2px solid #e9ecef;
  border-radius: 10px;
  padding: 0.5rem 0.25rem;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 0.1rem;
  background: #fff;
  user-select: none;
}
.sia-qty-card:hover {
  border-color: #ffc107;
  box-shadow: 0 2px 8px rgba(255, 193, 7, 0.2);
}
.sia-qty-card.active {
  border-color: #ffc107;
  background: #fffbeb;
  box-shadow: 0 2px 12px rgba(255, 193, 7, 0.3);
}
.sia-qty-number { font-weight: 800; font-size: 1.1rem; line-height: 1.2; }
.sia-qty-cost { font-size: 0.62rem; color: #6c757d; }

/* ── Pack Social: Results Grid ── */
.sia-pack-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 0.75rem;
}
.sia-pack-grid.pack-single {
  grid-template-columns: 1fr;
  max-width: 400px;
  margin: 0 auto;
}
.sia-pack-item {
  position: relative;
  border-radius: 10px;
  overflow: hidden;
  border: 2px solid #e9ecef;
  aspect-ratio: 1;
}
.sia-pack-item img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.sia-pack-item-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  opacity: 0;
  transition: opacity 0.15s;
}
.sia-pack-item:hover .sia-pack-item-overlay {
  opacity: 1;
}
.sia-pack-badge {
  position: absolute;
  top: 6px;
  left: 6px;
  background: rgba(255, 193, 7, 0.9);
  color: #212529;
  border-radius: 50%;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.7rem;
  font-weight: 700;
}

/* ── Responsive ── */
@media (max-width: 767.98px) {
  .studio-ia-hero { padding: 1rem 1.25rem; border-radius: 0; }
  .studio-ia-panel { border-radius: 0; border-left: 0; border-right: 0; }
  .sia-style-grid { grid-template-columns: 1fr 1fr; }
  .sia-angle-grid { flex-direction: column; }
  .sia-gallery-grid { grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); }
  .sia-pack-grid { grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); }
}
</style>
