<template>
  <Teleport to="body">
    <div v-if="isOpen" class="ai-studio-overlay" @click.self="closeStudio">
      <div class="ai-studio-dialog">

        <!-- ── Cabeçalho ── -->
        <div class="ai-studio-header">
          <div class="d-flex align-items-center gap-2">
            <span class="ai-studio-badge"><i class="bi bi-stars"></i></span>
            <div>
              <h5 class="mb-0">AI Studio</h5>
              <small class="text-muted">Aprimoramento profissional de fotos de comida</small>
            </div>
          </div>
          <button type="button" class="btn-close-studio" @click="closeStudio">
            <i class="bi bi-x-lg"></i>
          </button>
        </div>

        <!-- ── Corpo ── -->
        <div class="ai-studio-body">

          <!-- FASE 1: Configuração -->
          <template v-if="phase === 'config'">
            <div class="row g-3">

              <!-- Coluna esquerda: imagem original -->
              <div class="col-12 col-md-4">
                <div class="ai-studio-original-wrap">
                  <div class="ai-studio-original-label">
                    <i class="bi bi-image me-1"></i>Imagem Original
                  </div>
                  <img
                    :src="assetUrl(mediaItem.url)"
                    :alt="mediaItem.filename"
                    class="ai-studio-original-img"
                  />
                  <div class="ai-studio-original-name text-truncate">{{ mediaItem.filename }}</div>
                </div>
              </div>

              <!-- Coluna direita: controles -->
              <div class="col-12 col-md-8">

                <!-- Seletor de Estilo -->
                <div class="mb-3">
                  <label class="ai-studio-section-label">
                    <i class="bi bi-palette me-1"></i>Estilo Fotográfico
                  </label>
                  <div class="ai-studio-style-grid">
                    <label
                      v-for="s in STYLES"
                      :key="s.key"
                      :class="['ai-studio-style-card', { active: selectedStyle === s.key }]"
                    >
                      <input type="radio" :value="s.key" v-model="selectedStyle" class="d-none" />
                      <span class="ai-studio-style-icon">{{ s.emoji }}</span>
                      <span class="ai-studio-style-name">{{ s.name }}</span>
                      <span class="ai-studio-style-desc">{{ s.desc }}</span>
                      <span v-if="selectedStyle === s.key" class="ai-studio-check">
                        <i class="bi bi-check-circle-fill"></i>
                      </span>
                    </label>
                  </div>
                </div>

                <!-- Seletor de Ângulo -->
                <div class="mb-3">
                  <label class="ai-studio-section-label">
                    <i class="bi bi-camera me-1"></i>Ângulo de Câmera
                  </label>
                  <div class="ai-studio-angle-grid">
                    <label
                      v-for="a in ANGLES"
                      :key="a.key"
                      :class="['ai-studio-angle-card', { active: selectedAngle === a.key }]"
                    >
                      <input type="radio" :value="a.key" v-model="selectedAngle" class="d-none" />
                      <span class="ai-studio-angle-icon">{{ a.emoji }}</span>
                      <span class="ai-studio-angle-name">{{ a.name }}</span>
                      <span class="ai-studio-angle-sub">{{ a.sub }}</span>
                    </label>
                  </div>
                </div>

                <!-- Créditos + Aviso de saldo insuficiente -->
                <div class="ai-studio-credits-row">
                  <div class="d-flex align-items-center gap-2 flex-wrap">
                    <span class="badge bg-warning text-dark fs-6 px-3 py-2">
                      <i class="bi bi-lightning-charge-fill me-1"></i>
                      Custo: <strong>{{ cost }}</strong> créditos
                    </span>
                    <span v-if="creditsOk === true" class="badge bg-success-subtle text-success">
                      <i class="bi bi-check-circle me-1"></i>Saldo: {{ balance }} créditos
                    </span>
                    <span v-else-if="creditsOk === false" class="badge bg-danger text-white">
                      <i class="bi bi-exclamation-triangle me-1"></i>Saldo: {{ balance }} créditos
                    </span>
                  </div>
                </div>

                <div v-if="creditsOk === false" class="alert alert-danger py-2 mt-2 mb-0 small">
                  <i class="bi bi-exclamation-triangle-fill me-1"></i>
                  Créditos de IA insuficientes para aprimorar esta imagem.
                  Necessário: <strong>{{ cost }}</strong>, Disponível: <strong>{{ balance }}</strong>.
                  Acesse o painel de Plano para adicionar mais créditos.
                </div>

              </div>
            </div>
          </template>

          <!-- FASE 2: Gerando imagem -->
          <template v-else-if="phase === 'generating'">
            <div class="ai-studio-generating">
              <div class="ai-studio-generating-anim">
                <div class="ai-studio-spinner-wrap">
                  <div class="spinner-border text-warning" style="width:3rem;height:3rem" role="status"></div>
                  <i class="bi bi-stars ai-studio-spinner-icon"></i>
                </div>
              </div>
              <h5 class="mt-3 mb-1">Aprimorando no AI Studio...</h5>
              <p class="text-muted mb-0">
                Analisando o alimento e gerando imagem profissional.<br>
                Isso pode levar até 30 segundos.
              </p>
              <div class="ai-studio-generating-steps mt-3">
                <div :class="['step', { done: genStep > 0, active: genStep === 0 }]">
                  <i class="bi bi-eye me-1"></i>Analisando ingredientes com IA
                </div>
                <div :class="['step', { done: genStep > 1, active: genStep === 1 }]">
                  <i class="bi bi-brush me-1"></i>Gerando imagem profissional
                </div>
                <div :class="['step', { done: genStep > 2, active: genStep === 2 }]">
                  <i class="bi bi-cloud-arrow-up me-1"></i>Salvando na biblioteca
                </div>
              </div>
            </div>
          </template>

          <!-- FASE 3: Resultado com slider Antes/Depois -->
          <template v-else-if="phase === 'result'">
            <div class="row g-3 align-items-start">

              <!-- Slider Antes/Depois -->
              <div class="col-12 col-md-7">
                <div class="ai-studio-section-label mb-2">
                  <i class="bi bi-arrow-left-right me-1"></i>Comparar Antes / Depois
                </div>
                <div class="ai-studio-compare-wrap" ref="compareWrap">
                  <!-- Imagem DEPOIS (fundo) -->
                  <img
                    :src="assetUrl(resultMedia.url)"
                    alt="Aprimorada"
                    class="ai-studio-compare-img"
                    draggable="false"
                  />
                  <!-- Imagem ANTES (recortada via clip) -->
                  <div
                    class="ai-studio-compare-before"
                    :style="{ clipPath: `inset(0 ${100 - sliderPct}% 0 0)` }"
                  >
                    <img
                      :src="assetUrl(mediaItem.url)"
                      alt="Original"
                      class="ai-studio-compare-img"
                      draggable="false"
                    />
                  </div>
                  <!-- Divisor -->
                  <div class="ai-studio-compare-divider" :style="{ left: sliderPct + '%' }">
                    <div class="ai-studio-compare-handle">
                      <i class="bi bi-chevron-left"></i>
                      <i class="bi bi-chevron-right"></i>
                    </div>
                  </div>
                  <!-- Labels -->
                  <span class="ai-studio-compare-label left">Original</span>
                  <span class="ai-studio-compare-label right">AI Studio</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  v-model.number="sliderPct"
                  class="form-range mt-2"
                  aria-label="Comparar antes e depois"
                />
              </div>

              <!-- Ações de salvamento -->
              <div class="col-12 col-md-5">
                <div class="ai-studio-section-label mb-2">
                  <i class="bi bi-floppy me-1"></i>Salvar Resultado
                </div>

                <div v-if="saveError" class="alert alert-danger py-2 small mb-2">
                  <i class="bi bi-exclamation-triangle me-1"></i>{{ saveError }}
                </div>

                <div class="d-grid gap-2">
                  <button
                    class="btn btn-success"
                    :disabled="saving"
                    @click="saveAs('new')"
                  >
                    <span v-if="saving && saveMode === 'new'" class="spinner-border spinner-border-sm me-1" role="status"></span>
                    <i v-else class="bi bi-plus-circle me-1"></i>
                    Salvar como Nova Imagem
                    <small class="d-block opacity-75" style="font-size:0.72rem">Preserva a original na biblioteca</small>
                  </button>

                  <button
                    class="btn btn-outline-warning"
                    :disabled="saving"
                    @click="saveAs('replace')"
                  >
                    <span v-if="saving && saveMode === 'replace'" class="spinner-border spinner-border-sm me-1" role="status"></span>
                    <i v-else class="bi bi-arrow-repeat me-1"></i>
                    Substituir Original
                    <small class="d-block opacity-75" style="font-size:0.72rem">Remove a imagem anterior</small>
                  </button>

                  <button
                    class="btn btn-outline-secondary"
                    @click="downloadResult"
                  >
                    <i class="bi bi-download me-1"></i>
                    Download HD
                    <small class="d-block opacity-75" style="font-size:0.72rem">.jpg otimizado para web</small>
                  </button>
                </div>

                <div class="ai-studio-result-meta mt-3">
                  <div class="small text-muted">
                    <i class="bi bi-stars me-1 text-warning"></i>
                    <strong>Estilo:</strong> {{ selectedStyleLabel }}
                    &nbsp;·&nbsp;
                    <strong>Ângulo:</strong> {{ selectedAngleLabel }}
                  </div>
                  <div class="small text-muted mt-1">
                    <i class="bi bi-lightning-charge me-1 text-warning"></i>
                    <strong>{{ cost }} créditos</strong> utilizados
                  </div>
                </div>

                <button class="btn btn-link btn-sm text-muted mt-2 px-0" @click="backToConfig">
                  <i class="bi bi-arrow-left me-1"></i>Gerar nova versão
                </button>
              </div>

            </div>
          </template>

          <!-- Erro geral -->
          <div v-if="enhanceError && phase === 'config'" class="alert alert-danger mt-3 mb-0 small">
            <i class="bi bi-exclamation-triangle-fill me-1"></i>{{ enhanceError }}
          </div>

        </div>

        <!-- ── Rodapé ── -->
        <div class="ai-studio-footer">
          <button type="button" class="btn btn-secondary btn-sm" @click="closeStudio">
            Fechar
          </button>

          <button
            v-if="phase === 'config'"
            type="button"
            class="btn btn-warning btn-sm fw-bold"
            :disabled="!canGenerate || generating"
            @click="generate"
          >
            <i class="bi bi-stars me-1"></i>
            Aprimorar Imagem
          </button>
        </div>

      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useAiStudio } from '../../composables/useAiStudio.js'
import { useAiCreditsStore } from '../../stores/aiCredits.js'
import { assetUrl } from '../../utils/assetUrl.js'
import api from '../../api.js'

const { isOpen, mediaItem, closeStudio, notifyEnhanced } = useAiStudio()
const creditsStore = useAiCreditsStore()

// ── Opções de estilo ──────────────────────────────────────────
const STYLES = [
  {
    key: 'minimal',
    name: 'Minimalista',
    emoji: '🤍',
    desc: 'Fundo branco, luz de estúdio',
  },
  {
    key: 'rustic',
    name: 'Rústico',
    emoji: '🪵',
    desc: 'Madeira escura, luz quente artesanal',
  },
  {
    key: 'dark',
    name: 'Dark Mood',
    emoji: '🖤',
    desc: 'Fundo preto, luz lateral dramática',
  },
  {
    key: 'vibrant',
    name: 'Vibrante',
    emoji: '🌈',
    desc: 'Cores saturadas, estilo delivery pop',
  },
]

const ANGLES = [
  {
    key: 'top',
    name: 'Top View (90°)',
    emoji: '⬆️',
    sub: 'Pizzas, Bowls, Marmitas',
  },
  {
    key: 'standard',
    name: 'Standard (45°)',
    emoji: '↗️',
    sub: 'Pratos, Hambúrgueres',
  },
  {
    key: 'hero',
    name: 'Hero (0°)',
    emoji: '➡️',
    sub: 'Sanduíches, Bolos',
  },
]

// ── Estado ────────────────────────────────────────────────────
const selectedStyle = ref('minimal')
const selectedAngle = ref('standard')
const phase = ref('config')  // 'config' | 'generating' | 'result'
const genStep = ref(0)
const generating = ref(false)
const enhanceError = ref(null)

const resultMedia = ref(null)
const sliderPct = ref(50)

const saving = ref(false)
const saveMode = ref(null)
const saveError = ref(null)

const cost = ref(10)
const balance = ref(null)
const creditsOk = ref(null)

// ── Computed ──────────────────────────────────────────────────
const canGenerate = computed(() => creditsOk.value !== false)

const selectedStyleLabel = computed(
  () => STYLES.find((s) => s.key === selectedStyle.value)?.name || selectedStyle.value,
)
const selectedAngleLabel = computed(
  () => ANGLES.find((a) => a.key === selectedAngle.value)?.name || selectedAngle.value,
)

// ── Lifecycle ─────────────────────────────────────────────────
watch(isOpen, (open) => {
  if (open) {
    phase.value = 'config'
    selectedStyle.value = 'minimal'
    selectedAngle.value = 'standard'
    enhanceError.value = null
    resultMedia.value = null
    sliderPct.value = 50
    saving.value = false
    saveError.value = null
    loadCost()
  }
})

async function loadCost() {
  try {
    const res = await api.get('/ai-studio/cost')
    cost.value = res.data.cost ?? 10
    balance.value = res.data.balance ?? 0
    creditsOk.value = res.data.ok
  } catch {
    // Fallback: ler do store de créditos
    await creditsStore.fetch()
    // Só atualiza se o fetch funcionou (balance !== null); se não, mantém creditsOk = null
    // para não desabilitar o botão quando o token ainda não está disponível.
    // O backend valida os créditos reais ao processar o enhance.
    if (creditsStore.balance !== null) {
      balance.value = creditsStore.balance
      creditsOk.value = creditsStore.hasCredits(cost.value)
    }
  }
}

// ── Ações ─────────────────────────────────────────────────────
async function generate() {
  if (!canGenerate.value || generating.value) return
  enhanceError.value = null
  generating.value = true
  phase.value = 'generating'
  genStep.value = 0

  // Simula progresso visual nos steps
  const stepTimer = setInterval(() => {
    if (genStep.value < 2) genStep.value++
  }, 8000)

  try {
    const res = await api.post('/ai-studio/enhance', {
      mediaId: mediaItem.value.id,
      style: selectedStyle.value,
      angle: selectedAngle.value,
      mode: 'preview',  // Backend trata como 'new' mas não notifica callback ainda
    }, { timeout: 300000 })  // 5 minutos — Vision (90s) + DALL-E 3 (120s) + download (90s)
    genStep.value = 2
    resultMedia.value = res.data.media
    phase.value = 'result'
    sliderPct.value = 50
    // Atualiza saldo exibido
    await creditsStore.fetch()
    balance.value = creditsStore.balance
  } catch (e) {
    phase.value = 'config'
    const msg = e?.response?.data?.message || 'Erro ao gerar imagem. Tente novamente.'
    enhanceError.value = msg
    // Atualiza saldo (pode ter caído para zero)
    await loadCost()
  } finally {
    clearInterval(stepTimer)
    generating.value = false
  }
}

async function saveAs(mode) {
  if (saving.value || !resultMedia.value) return
  saveError.value = null
  saving.value = true
  saveMode.value = mode

  if (mode === 'replace') {
    // Troca arquivo/registro no banco sem re-executar IA (imagem já foi gerada no preview)
    try {
      const res = await api.post('/ai-studio/apply-replace', {
        originalMediaId: mediaItem.value.id,
        resultMediaId:   resultMedia.value.id,
      })
      notifyEnhanced(res.data.media)
    } catch (e) {
      saveError.value = e?.response?.data?.message || 'Erro ao substituir imagem.'
    }
  } else {
    // 'new' — resultado já foi salvo como novo durante generate(), apenas notifica
    notifyEnhanced(resultMedia.value)
  }

  saving.value = false
  saveMode.value = null
}

function downloadResult() {
  if (!resultMedia.value) return
  const url = assetUrl(resultMedia.value.url)
  const link = document.createElement('a')
  link.href = url
  link.download = resultMedia.value.filename || 'ai_studio_enhanced.jpg'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

function backToConfig() {
  phase.value = 'config'
  enhanceError.value = null
  resultMedia.value = null
}
</script>

<style scoped>
/* ── Overlay e Dialog ───────────────────────────────────────── */
.ai-studio-overlay {
  position: fixed;
  inset: 0;
  z-index: 1070;
  background: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  overflow-y: auto;
  padding: 1rem;
}

.ai-studio-dialog {
  background: #fff;
  border-radius: 16px;
  width: 100%;
  max-width: 900px;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.35);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  margin: auto;
}

/* ── Cabeçalho ──────────────────────────────────────────────── */
.ai-studio-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.25rem;
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
  color: #fff;
  border-bottom: 2px solid rgba(255, 215, 0, 0.3);
}

.ai-studio-badge {
  width: 40px;
  height: 40px;
  background: linear-gradient(135deg, #ffd700, #ff8c00);
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.2rem;
  flex-shrink: 0;
}

.ai-studio-header h5 {
  color: #fff;
  font-weight: 700;
  letter-spacing: 0.5px;
}

.btn-close-studio {
  background: rgba(255, 255, 255, 0.1);
  border: none;
  color: #fff;
  border-radius: 8px;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.15s;
}
.btn-close-studio:hover { background: rgba(255, 255, 255, 0.2); }

/* ── Body ───────────────────────────────────────────────────── */
.ai-studio-body {
  padding: 1.25rem;
  overflow-y: auto;
  flex: 1;
}

/* ── Seção label ────────────────────────────────────────────── */
.ai-studio-section-label {
  font-size: 0.8rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  color: #495057;
  margin-bottom: 0.5rem;
  display: block;
}

/* ── Imagem original ────────────────────────────────────────── */
.ai-studio-original-wrap {
  border: 2px solid #e9ecef;
  border-radius: 12px;
  overflow: hidden;
  background: #f8f9fa;
}
.ai-studio-original-label {
  font-size: 0.72rem;
  font-weight: 600;
  text-transform: uppercase;
  color: #6c757d;
  padding: 0.4rem 0.75rem;
  border-bottom: 1px solid #e9ecef;
  background: #f8f9fa;
}
.ai-studio-original-img {
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
  display: block;
}
.ai-studio-original-name {
  font-size: 0.75rem;
  color: #6c757d;
  padding: 0.4rem 0.75rem;
  border-top: 1px solid #e9ecef;
  background: #f8f9fa;
}

/* ── Cards de Estilo ────────────────────────────────────────── */
.ai-studio-style-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.5rem;
}

.ai-studio-style-card {
  position: relative;
  border: 2px solid #e9ecef;
  border-radius: 10px;
  padding: 0.6rem 0.75rem;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s, transform 0.1s;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  background: #fff;
  user-select: none;
}
.ai-studio-style-card:hover {
  border-color: #ffd700;
  box-shadow: 0 2px 8px rgba(255, 215, 0, 0.2);
  transform: translateY(-1px);
}
.ai-studio-style-card.active {
  border-color: #ffc107;
  background: #fffbeb;
  box-shadow: 0 2px 12px rgba(255, 193, 7, 0.3);
}
.ai-studio-style-icon { font-size: 1.2rem; line-height: 1; }
.ai-studio-style-name { font-weight: 700; font-size: 0.82rem; }
.ai-studio-style-desc { font-size: 0.7rem; color: #6c757d; }
.ai-studio-check {
  position: absolute;
  top: 6px;
  right: 8px;
  color: #ffc107;
  font-size: 0.9rem;
}

/* ── Cards de Ângulo ────────────────────────────────────────── */
.ai-studio-angle-grid {
  display: flex;
  gap: 0.5rem;
}
.ai-studio-angle-card {
  flex: 1;
  border: 2px solid #e9ecef;
  border-radius: 10px;
  padding: 0.5rem;
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
.ai-studio-angle-card:hover {
  border-color: #0d6efd;
  box-shadow: 0 2px 8px rgba(13, 110, 253, 0.15);
}
.ai-studio-angle-card.active {
  border-color: #0d6efd;
  background: #eff6ff;
}
.ai-studio-angle-icon { font-size: 1.1rem; }
.ai-studio-angle-name { font-weight: 700; font-size: 0.72rem; }
.ai-studio-angle-sub { font-size: 0.65rem; color: #6c757d; }

/* ── Créditos ───────────────────────────────────────────────── */
.ai-studio-credits-row {
  padding: 0.75rem;
  background: #f8f9fa;
  border-radius: 10px;
  border: 1px solid #e9ecef;
}

/* ── Fase Gerando ───────────────────────────────────────────── */
.ai-studio-generating {
  text-align: center;
  padding: 2rem 1rem;
}
.ai-studio-spinner-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.ai-studio-spinner-icon {
  position: absolute;
  font-size: 1.2rem;
  color: #ffd700;
}
.ai-studio-generating-steps {
  display: inline-flex;
  flex-direction: column;
  gap: 0.5rem;
  text-align: left;
}
.ai-studio-generating-steps .step {
  padding: 0.4rem 0.75rem;
  border-radius: 6px;
  font-size: 0.82rem;
  color: #adb5bd;
  background: #f8f9fa;
  border: 1px solid transparent;
  transition: all 0.3s;
}
.ai-studio-generating-steps .step.active {
  color: #212529;
  background: #fff3cd;
  border-color: #ffc107;
  font-weight: 600;
}
.ai-studio-generating-steps .step.done {
  color: #198754;
  background: #d1e7dd;
  border-color: #a3cfbb;
}

/* ── Comparador Antes/Depois ────────────────────────────────── */
.ai-studio-compare-wrap {
  position: relative;
  width: 100%;
  aspect-ratio: 1;
  border-radius: 12px;
  overflow: hidden;
  border: 2px solid #e9ecef;
  cursor: ew-resize;
  user-select: none;
}
.ai-studio-compare-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.ai-studio-compare-before {
  position: absolute;
  inset: 0;
  overflow: hidden;
}
.ai-studio-compare-before img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.ai-studio-compare-divider {
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
.ai-studio-compare-handle {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background: #fff;
  border-radius: 50%;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  font-size: 0.75rem;
  color: #212529;
}
.ai-studio-compare-label {
  position: absolute;
  top: 10px;
  font-size: 0.68rem;
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
.ai-studio-compare-label.left { left: 10px; }
.ai-studio-compare-label.right { right: 10px; }

/* ── Resultado meta ─────────────────────────────────────────── */
.ai-studio-result-meta {
  padding: 0.75rem;
  background: #f8f9fa;
  border-radius: 8px;
  border: 1px solid #e9ecef;
}

/* ── Rodapé ─────────────────────────────────────────────────── */
.ai-studio-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.75rem;
  padding: 0.875rem 1.25rem;
  border-top: 1px solid #e9ecef;
  background: #f8f9fa;
}

/* ── Responsivo mobile ──────────────────────────────────────── */
@media (max-width: 575.98px) {
  .ai-studio-overlay { padding: 0; align-items: flex-end; }
  .ai-studio-dialog {
    max-width: 100%;
    border-radius: 16px 16px 0 0;
    max-height: 95vh;
  }
  .ai-studio-style-grid { grid-template-columns: repeat(2, 1fr); }
  .ai-studio-angle-grid { flex-direction: column; }
  .ai-studio-compare-wrap { aspect-ratio: 4/3; }
}
</style>
