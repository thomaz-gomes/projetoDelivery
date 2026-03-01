<script setup>
import { ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { useSaasStore } from '../stores/saas'
import api from '../api'
import MediaField from '../components/MediaLibrary/MediaField.vue'

const router = useRouter()
const auth = useAuthStore()
const saas = useSaasStore()

const STEPS = ['Empresa', 'Primeiro produto']

const step    = ref(0)
const saving  = ref(false)
const error   = ref('')

const createdStoreId = ref(null)
const createdMenuId  = ref(null)

// ── Step 1 form ──────────────────────────────
const form = ref({
  name:               '',
  slug:               '',
  street:             '',
  addressNumber:      '',
  addressNeighborhood:'',
  city:               '',
  state:              '',
  postalCode:         '',
  whatsapp:           '',
})

const UF_LIST = [
  'AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT',
  'PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO'
]

function formatCep(e) {
  let raw = (e.target.value || '').replace(/\D/g, '').slice(0, 8)
  if (raw.length > 5) raw = raw.slice(0, 5) + '-' + raw.slice(5)
  form.value.postalCode = raw
  e.target.value = raw
}

// Slug availability
const slugStatus = ref('')  // '' | 'checking' | 'available' | 'unavailable' | 'invalid'
let slugCheckTimer = null
let slugManuallyEdited = false

function autoSlug(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function onNameInput() {
  if (!slugManuallyEdited) {
    form.value.slug = autoSlug(form.value.name)
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
  const slug = form.value.slug.trim()
  if (!slug) { slugStatus.value = ''; return }
  try {
    const { data } = await api.get('/menu/menus/check-slug', { params: { slug } })
    slugStatus.value = data.reason === 'invalid' ? 'invalid' : (data.available ? 'available' : 'unavailable')
  } catch {
    slugStatus.value = ''
  }
}

const canProceed = computed(() =>
  form.value.name.trim().length > 0 &&
  slugStatus.value !== 'unavailable' &&
  slugStatus.value !== 'checking'
)

// ── Step 2 form ──────────────────────────────
const itemForm = ref({
  categoryName: '',
  name:         '',
  price:        '',
  description:  '',
  image:        null,
})

const generatingDesc = ref(false)
const canGenerateDesc = computed(() =>
  !!itemForm.value.name?.trim() && !!itemForm.value.image
)

// ── Save step 1 ──────────────────────────────
async function saveCompany() {
  error.value = ''
  if (!form.value.name.trim()) { error.value = 'Informe o nome da empresa.'; return }
  if (slugStatus.value === 'unavailable') { error.value = 'O slug escolhido já está em uso.'; return }
  saving.value = true
  try {
    // 1. Create company + default store via setup-company
    const { data } = await api.post('/auth/setup-company', {
      name:                form.value.name.trim(),
      slug:                form.value.slug || undefined,
      street:              form.value.street || undefined,
      addressNumber:       form.value.addressNumber || undefined,
      addressNeighborhood: form.value.addressNeighborhood || undefined,
      city:                form.value.city || undefined,
      state:               form.value.state || undefined,
      postalCode:          form.value.postalCode || undefined,
    })

    // Update auth token (now contains companyId)
    auth.token = data.token
    auth.user  = data.user
    localStorage.setItem('token', data.token)
    localStorage.setItem('user', JSON.stringify(data.user))
    createdStoreId.value = data.store?.id

    // Build full address string for menu
    const fullAddress = [
      form.value.street,
      form.value.addressNumber,
      form.value.addressNeighborhood,
      form.value.city,
      form.value.state,
    ].filter(Boolean).join(', ') || undefined

    // 2. Create menu linked to the store
    await saas.fetchMySubscription().catch(() => {})
    const isCatalogOnly = saas.isCardapioSimplesOnly
    const menuRes = await api.post('/menu/menus', {
      name:     form.value.name.trim(),
      storeId:  createdStoreId.value,
      address:  fullAddress,
      whatsapp: form.value.whatsapp || undefined,
      slug:     form.value.slug || undefined,
      ...(isCatalogOnly ? { catalogMode: true, allowDelivery: false, allowPickup: false } : {}),
    })
    createdMenuId.value = menuRes.data.id

    step.value = 1
  } catch (e) {
    error.value = e?.response?.data?.message || 'Erro ao criar empresa.'
  } finally {
    saving.value = false
  }
}

// ── Save step 2 ──────────────────────────────
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
    router.push('/orders')
  } catch (e) {
    error.value = e?.response?.data?.message || 'Erro ao criar o produto.'
  } finally {
    saving.value = false
  }
}

function skipProduct() {
  router.push('/orders')
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
    // silent
  } finally {
    generatingDesc.value = false
  }
}
</script>

<template>
  <div class="d-flex align-items-center justify-content-center min-vh-100 bg-light py-4">
    <div class="setup-card">

      <!-- Brand -->
      <div class="text-center mb-4">
        <img src="/core.png" alt="Logo" style="max-width:120px" />
      </div>

      <!-- Step indicator -->
      <div class="step-track mb-4">
        <template v-for="(label, i) in STEPS" :key="i">
          <div class="step-item">
            <div class="step-dot" :class="{ active: step === i, done: step > i }">
              <i v-if="step > i" class="bi bi-check-lg"></i>
              <span v-else>{{ i + 1 }}</span>
            </div>
            <div class="step-label" :class="{ 'fw-semibold': step === i }">{{ label }}</div>
          </div>
          <div v-if="i < STEPS.length - 1" class="step-line" :class="{ done: step > i }"></div>
        </template>
      </div>

      <!-- ── PASSO 1: Empresa ── -->
      <div v-if="step === 0">
        <h4 class="text-center mb-1">Bem-vindo! Configure sua empresa</h4>
        <p class="text-muted small text-center mb-4">Preencha os dados básicos para começar.</p>

        <div class="mb-3">
          <label class="form-label">Nome da empresa *</label>
          <input
            v-model="form.name"
            type="text"
            class="form-control"
            placeholder="Ex: Pizzaria do João"
            @input="onNameInput"
            @keyup.enter="canProceed && saveCompany()"
          />
        </div>

        <div class="mb-3">
          <label class="form-label">
            Slug <small class="text-muted fw-normal">(link do cardápio)</small>
          </label>
          <div class="input-group">
            <span class="input-group-text small">/public/</span>
            <input
              v-model="form.slug"
              type="text"
              class="form-control"
              placeholder="pizzaria-do-joao"
              @input="onSlugInput"
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
          <div v-else class="small text-muted mt-1">Usado como link para o cardápio digital</div>
        </div>

        <div class="mb-2">
          <label class="form-label">Endereço</label>
          <div class="row g-2">
            <div class="col-8">
              <input
                v-model="form.street"
                type="text"
                class="form-control"
                placeholder="Rua / Avenida"
              />
            </div>
            <div class="col-4">
              <input
                v-model="form.addressNumber"
                type="text"
                class="form-control"
                placeholder="Número"
              />
            </div>
            <div class="col-12">
              <input
                v-model="form.addressNeighborhood"
                type="text"
                class="form-control"
                placeholder="Bairro"
              />
            </div>
            <div class="col-5">
              <input
                v-model="form.city"
                type="text"
                class="form-control"
                placeholder="Cidade"
              />
            </div>
            <div class="col-3">
              <select v-model="form.state" class="form-select">
                <option value="">UF</option>
                <option v-for="uf in UF_LIST" :key="uf" :value="uf">{{ uf }}</option>
              </select>
            </div>
            <div class="col-4">
              <input
                :value="form.postalCode"
                @input="formatCep"
                type="text"
                class="form-control"
                placeholder="CEP"
                maxlength="9"
              />
            </div>
          </div>
        </div>

        <div class="mb-3">
          <label class="form-label">WhatsApp</label>
          <input
            v-model="form.whatsapp"
            type="text"
            class="form-control"
            placeholder="(00) 00000-0000"
            maxlength="20"
          />
        </div>

        <div v-if="error" class="alert alert-danger py-2 small">{{ error }}</div>

        <div class="d-grid mt-4">
          <button
            class="btn btn-primary"
            :disabled="!canProceed || saving"
            @click="saveCompany"
          >
            <span v-if="saving" class="spinner-border spinner-border-sm me-2" role="status"></span>
            Próximo <i class="bi bi-arrow-right ms-1"></i>
          </button>
        </div>
        <div class="text-center mt-2">
          <button type="button" class="btn btn-link text-muted small p-0" @click="router.push('/orders')">
            Pular configuração
          </button>
        </div>
      </div>

      <!-- ── PASSO 2: Primeiro produto ── -->
      <div v-if="step === 1">
        <h4 class="text-center mb-1">Adicione seu primeiro produto</h4>
        <p class="text-muted small text-center mb-4">
          Cadastre uma categoria e um produto para começar.
        </p>

        <div class="mb-3">
          <label class="form-label">Categoria *</label>
          <input
            v-model="itemForm.categoryName"
            type="text"
            class="form-control"
            placeholder="Ex: Lanches, Pizzas, Bebidas..."
          />
        </div>

        <div class="mb-3">
          <label class="form-label">Nome do produto *</label>
          <input
            v-model="itemForm.name"
            type="text"
            class="form-control"
            placeholder="Ex: X-Burguer, Pizza Margherita..."
          />
        </div>

        <div class="mb-3">
          <label class="form-label">Preço (R$) *</label>
          <input
            v-model="itemForm.price"
            type="number"
            class="form-control"
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
            v-model="itemForm.description"
            class="form-control"
            rows="2"
            placeholder="Descreva os ingredientes..."
          ></textarea>
        </div>

        <div class="mb-3">
          <MediaField
            label="Foto do produto"
            fieldId="setup-product-image"
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

        <div v-if="error" class="alert alert-danger py-2 small">{{ error }}</div>

        <div class="d-flex gap-2 mt-4">
          <button class="btn btn-outline-secondary" @click="step = 0" :disabled="saving">
            <i class="bi bi-arrow-left me-1"></i>Voltar
          </button>
          <button class="btn btn-success flex-fill" @click="saveItem" :disabled="saving">
            <span v-if="saving" class="spinner-border spinner-border-sm me-2" role="status"></span>
            <i v-else class="bi bi-check-lg me-1"></i>Concluir
          </button>
          <button class="btn btn-link text-muted" @click="skipProduct" :disabled="saving" type="button">
            Pular
          </button>
        </div>
      </div>

    </div>
  </div>
</template>

<style scoped>
.setup-card {
  background: #fff;
  border-radius: 20px;
  padding: 2rem;
  width: 100%;
  max-width: 520px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.08);
}

.form-label {
  font-weight: 600;
  font-size: 0.85rem;
  margin-bottom: 4px;
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
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 600;
  background: #e6eef6;
  color: #6b7280;
  transition: all 200ms ease;
  flex-shrink: 0;
}
.step-dot.active { background: #3b82f6; color: #fff; }
.step-dot.done   { background: #198754; color: #fff; }
.step-label {
  font-size: 0.75rem;
  color: #6c757d;
  white-space: nowrap;
}
.step-line {
  width: 64px;
  height: 3px;
  background: #e6eef6;
  border-radius: 2px;
  margin-bottom: 20px;
  transition: all 200ms ease;
}
.step-line.done { background: #198754; }
</style>
