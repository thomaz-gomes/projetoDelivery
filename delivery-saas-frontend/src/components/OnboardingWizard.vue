<template>
  <div v-if="visible" class="onboarding-backdrop">
    <div class="onboarding-card">

      <!-- Brand -->
      <div class="text-center mb-4">
        <img src="/core.png" alt="Logo" style="max-width:130px" />
      </div>

      <!-- Step indicator: 2 passos -->
      <div class="step-track mb-4">
        <template v-for="(label, i) in STEPS" :key="i">
          <div class="step-item">
            <div class="step-dot" :class="{ active: step === i, done: step > i }">
              <i v-if="step > i" class="bi bi-check-lg"></i>
              <span v-else>{{ i + 1 }}</span>
            </div>
            <div class="step-label" :class="{ 'text-success': step > i, 'fw-semibold': step === i }">
              {{ label }}
            </div>
          </div>
          <div v-if="i < STEPS.length - 1" class="step-line" :class="{ done: step > i }"></div>
        </template>
      </div>

      <!-- ── PASSO 1: Empresa ── -->
      <template v-if="step === 0">
        <h5 class="text-center mb-1">Bem-vindo! Configure sua empresa</h5>
        <p class="text-center text-muted small mb-4">Preencha os dados básicos e avance.</p>

        <div class="mb-3">
          <label class="form-label">Nome da empresa *</label>
          <input
            type="text"
            class="form-control"
            v-model="storeForm.name"
            @input="onNameInput"
            placeholder="Ex: Hamburgeria do João"
          />
        </div>

        <div class="mb-3">
          <label class="form-label">Slug <small class="text-muted fw-normal">(link do cardápio)</small></label>
          <div class="input-group">
            <span class="input-group-text small text-muted">/public/</span>
            <input
              type="text"
              class="form-control"
              v-model="storeForm.slug"
              @input="onSlugInput"
              placeholder="hamburgeria-do-joao"
            />
          </div>
          <div v-if="slugStatus === 'checking'" class="small text-muted mt-1">
            <span class="spinner-border spinner-border-sm me-1"></span>Verificando...
          </div>
          <div v-else-if="slugStatus === 'available'" class="small text-success mt-1">
            <i class="bi bi-check-circle me-1"></i>Disponível
          </div>
          <div v-else-if="slugStatus === 'unavailable'" class="small text-danger mt-1">
            <i class="bi bi-x-circle me-1"></i>Já em uso, escolha outro
          </div>
          <div v-else-if="slugStatus === 'invalid'" class="small text-danger mt-1">
            <i class="bi bi-exclamation-circle me-1"></i>Slug inválido (apenas letras, números e traços)
          </div>
        </div>

        <div class="mb-3">
          <label class="form-label">Endereço</label>
          <input
            type="text"
            class="form-control"
            v-model="storeForm.address"
            placeholder="Rua, número, bairro, cidade..."
          />
        </div>

        <div class="mb-3">
          <label class="form-label">WhatsApp</label>
          <input
            type="text"
            class="form-control"
            v-model="storeForm.whatsapp"
            placeholder="(00) 00000-0000"
            maxlength="20"
          />
        </div>

        <div v-if="error" class="alert alert-danger py-2 small mb-3">{{ error }}</div>

        <div class="d-flex justify-content-between align-items-center mt-2">
          <button class="btn btn-link text-muted small p-0" @click="skip" type="button">Pular por agora</button>
          <button
            class="btn btn-primary"
            @click="saveStore"
            :disabled="saving || slugStatus === 'checking' || slugStatus === 'unavailable'"
            type="button"
          >
            <span v-if="saving" class="spinner-border spinner-border-sm me-1" role="status"></span>
            Próximo <i class="bi bi-arrow-right ms-1"></i>
          </button>
        </div>
      </template>

      <!-- ── PASSO 2: Primeiro produto ── -->
      <template v-if="step === 1">
        <h5 class="text-center mb-1">Adicione seu primeiro produto</h5>
        <p class="text-center text-muted small mb-4">
          Cadastre uma categoria e um produto para começar.
        </p>

        <div class="mb-3">
          <label class="form-label">Categoria *</label>
          <input
            type="text"
            class="form-control"
            v-model="itemForm.categoryName"
            placeholder="Ex: Lanches, Pizzas, Bebidas..."
          />
        </div>

        <div class="mb-3">
          <label class="form-label">Nome do produto *</label>
          <input
            type="text"
            class="form-control"
            v-model="itemForm.name"
            placeholder="Ex: X-Burguer, Pizza Margherita..."
          />
        </div>

        <div class="mb-3">
          <label class="form-label">Preço (R$) *</label>
          <input
            type="number"
            class="form-control"
            v-model="itemForm.price"
            placeholder="0,00"
            min="0"
            step="0.01"
          />
        </div>

        <div class="mb-3">
          <div class="d-flex align-items-center justify-content-between mb-1">
            <label class="form-label mb-0">Descrição</label>
            <button
              type="button"
              class="btn btn-sm btn-outline-primary py-0 px-2"
              :disabled="!canGenerateDesc || generatingDesc"
              :title="canGenerateDesc ? 'Descrever com IA' : 'Preencha o nome e a foto para usar a IA'"
              @click="generateDescription"
            >
              <span v-if="generatingDesc" class="spinner-border spinner-border-sm me-1"></span>
              <i v-else class="bi bi-stars me-1"></i>
              {{ generatingDesc ? 'Gerando...' : 'Descrever com IA' }}
            </button>
          </div>
          <textarea
            class="form-control"
            v-model="itemForm.description"
            rows="2"
            placeholder="Descreva os ingredientes..."
          ></textarea>
        </div>

        <div class="mb-3">
          <MediaField
            label="Foto do produto"
            fieldId="onboarding-product-image"
            v-model="itemForm.image"
            :crop-aspect="1"
            :target-width="600"
            :target-height="600"
          />
          <div v-if="itemForm.image" class="ai-photo-cta mt-2">
            <i class="bi bi-stars me-1"></i>
            Otimize sua foto com IA — cardápios com fotos chamativas convertem até 60% a mais
          </div>
        </div>

        <div v-if="error" class="alert alert-danger py-2 small mb-3">{{ error }}</div>

        <div class="d-flex justify-content-between align-items-center mt-2">
          <button class="btn btn-outline-secondary" @click="step = 0" type="button">
            <i class="bi bi-arrow-left me-1"></i>Voltar
          </button>
          <div class="d-flex align-items-center gap-2">
            <button class="btn btn-link text-muted small p-0" @click="skip" type="button">Pular</button>
            <button class="btn btn-success" @click="saveItem" :disabled="saving" type="button">
              <span v-if="saving" class="spinner-border spinner-border-sm me-1" role="status"></span>
              <i v-else class="bi bi-check-lg me-1"></i>Concluir
            </button>
          </div>
        </div>
      </template>

    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import api from '../api.js'
import MediaField from './MediaLibrary/MediaField.vue'
import { useSaasStore } from '../stores/saas.js'

const saas = useSaasStore()

const STEPS = ['Empresa', 'Primeiro produto']

const props = defineProps({
  visible:        { type: Boolean, default: false },
  initialStep:    { type: Number,  default: 0 },
  initialStoreId: { type: String,  default: null },
  initialMenuId:  { type: String,  default: null },
})

const emit = defineEmits(['done', 'skip'])

const step           = ref(props.initialStep > 1 ? 1 : props.initialStep)
const createdStoreId = ref(props.initialStoreId)
const createdMenuId  = ref(props.initialMenuId)

const saving = ref(false)
const error  = ref('')

// Slug availability check
const slugStatus = ref('')   // '' | 'checking' | 'available' | 'unavailable' | 'invalid'
let slugCheckTimer = null
let slugManuallyEdited = false

const storeForm = ref({ name: '', slug: '', address: '', whatsapp: '' })
const itemForm  = ref({ categoryName: '', name: '', price: '', description: '', image: null })

// AI description
const generatingDesc = ref(false)
const canGenerateDesc = computed(() => !!itemForm.value.name?.trim() && !!itemForm.value.image)

function autoSlug(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function onNameInput() {
  if (!slugManuallyEdited) {
    storeForm.value.slug = autoSlug(storeForm.value.name)
    scheduleSlugCheck()
  }
}

function onSlugInput() {
  slugManuallyEdited = true
  scheduleSlugCheck()
}

function scheduleSlugCheck() {
  slugStatus.value = 'checking'
  clearTimeout(slugCheckTimer)
  slugCheckTimer = setTimeout(checkSlug, 500)
}

async function checkSlug() {
  const slug = storeForm.value.slug.trim()
  if (!slug) { slugStatus.value = ''; return }
  try {
    const { data } = await api.get('/menu/menus/check-slug', { params: { slug } })
    if (data.reason === 'invalid') {
      slugStatus.value = 'invalid'
    } else {
      slugStatus.value = data.available ? 'available' : 'unavailable'
    }
  } catch {
    slugStatus.value = ''
  }
}

watch(() => props.visible, (v) => {
  if (v) {
    error.value = ''
    slugManuallyEdited = false
    slugStatus.value = ''
  }
})

async function saveStore() {
  error.value = ''
  if (!storeForm.value.name.trim()) { error.value = 'Informe o nome da empresa.'; return }
  if (slugStatus.value === 'unavailable') { error.value = 'O slug escolhido já está em uso.'; return }
  saving.value = true
  try {
    // 1. Create store
    const storeRes = await api.post('/stores', {
      name:    storeForm.value.name.trim(),
      address: storeForm.value.address || undefined,
    })
    createdStoreId.value = storeRes.data.id

    // 2. Create menu (same name, linked to store)
    const isCatalogOnly = saas.isCardapioSimplesOnly
    const menuRes = await api.post('/menu/menus', {
      name:     storeForm.value.name.trim(),
      storeId:  createdStoreId.value,
      address:  storeForm.value.address || undefined,
      whatsapp: storeForm.value.whatsapp || undefined,
      slug:     storeForm.value.slug || undefined,
      ...(isCatalogOnly ? { catalogMode: true, allowDelivery: false, allowPickup: false } : {}),
    })
    createdMenuId.value = menuRes.data.id

    step.value = 1
  } catch (e) {
    error.value = e?.response?.data?.message || 'Erro ao criar a empresa.'
  } finally {
    saving.value = false
  }
}

async function saveItem() {
  error.value = ''
  if (!itemForm.value.categoryName.trim()) { error.value = 'Informe o nome da categoria.'; return }
  if (!itemForm.value.name.trim())         { error.value = 'Informe o nome do produto.'; return }
  const price = parseFloat(String(itemForm.value.price).replace(',', '.'))
  if (isNaN(price) || price < 0) { error.value = 'Informe um preço válido.'; return }
  saving.value = true
  try {
    const catRes = await api.post('/menu/categories', {
      name:   itemForm.value.categoryName.trim(),
      menuId: createdMenuId.value || undefined,
    })
    await api.post('/menu/products', {
      name:        itemForm.value.name.trim(),
      description: itemForm.value.description || undefined,
      price,
      categoryId:  catRes.data.id,
      menuId:      createdMenuId.value || undefined,
      image:       itemForm.value.image || undefined,
    })
    emit('done')
  } catch (e) {
    error.value = e?.response?.data?.message || 'Erro ao criar o produto.'
  } finally {
    saving.value = false
  }
}

async function generateDescription() {
  if (!canGenerateDesc.value || generatingDesc.value) return
  generatingDesc.value = true
  try {
    const { data } = await api.post('/ai-studio/generate-description', {
      name:     itemForm.value.name.trim(),
      imageUrl: itemForm.value.image,
    })
    if (data.description) itemForm.value.description = data.description
  } catch {
    // silent fail — user can type manually
  } finally {
    generatingDesc.value = false
  }
}

function skip() {
  try { sessionStorage.setItem('onboarding_skipped', '1') } catch {}
  emit('skip')
}
</script>

<style scoped>
.onboarding-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
}
.onboarding-card {
  background: #fff;
  border-radius: 16px;
  padding: 2rem;
  width: 100%;
  max-width: 520px;
  max-height: 92vh;
  overflow-y: auto;
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.2);
}

/* Step track */
.step-track {
  display: flex;
  align-items: center;
  justify-content: center;
}
.step-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
.step-dot {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 0.85rem;
  background: #e9ecef;
  color: #6c757d;
  flex-shrink: 0;
  transition: background 0.2s, color 0.2s;
}
.step-dot.active { background: #89d136; color: #fff; }
.step-dot.done   { background: #198754; color: #fff; }
.step-label {
  font-size: 0.75rem;
  color: #6c757d;
  white-space: nowrap;
}
.step-line {
  height: 2px;
  background: #e9ecef;
  width: 64px;
  flex-shrink: 0;
  margin-bottom: 20px;
  transition: background 0.2s;
}
.step-line.done { background: #198754; }
</style>
