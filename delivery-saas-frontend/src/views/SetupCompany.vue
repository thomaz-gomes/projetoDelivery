<script setup>
import { ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import api from '../api'

const router = useRouter()
const auth = useAuthStore()

const step = ref(1)
const loading = ref(false)
const error = ref('')

const form = ref({
  name: '',
  slug: '',
  street: '',
  addressNumber: '',
  addressNeighborhood: '',
  city: '',
  state: '',
  postalCode: '',
})

const UF_LIST = [
  'AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT',
  'PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO'
]

// Auto-generate slug from company name
watch(() => form.value.name, (name) => {
  if (!form.value.slug || form.value.slug === autoSlug(form.value.name)) {
    // only auto-generate if user hasn't manually edited the slug
  }
})

function autoSlug(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function generateSlug() {
  form.value.slug = autoSlug(form.value.name)
}

const canProceedStep1 = computed(() => form.value.name.trim().length > 0)

const canProceedStep2 = computed(() =>
  form.value.street.trim() &&
  form.value.city.trim() &&
  form.value.state.trim()
)

function nextStep() {
  error.value = ''
  if (step.value === 1 && canProceedStep1.value) {
    if (!form.value.slug) generateSlug()
    step.value = 2
  } else if (step.value === 2 && canProceedStep2.value) {
    step.value = 3
  }
}

function prevStep() {
  error.value = ''
  if (step.value > 1) step.value--
}

function formatCep(e) {
  let raw = (e.target.value || '').replace(/\D/g, '').slice(0, 8)
  if (raw.length > 5) {
    raw = raw.slice(0, 5) + '-' + raw.slice(5)
  }
  form.value.postalCode = raw
  e.target.value = raw
}

async function submit() {
  error.value = ''
  loading.value = true

  try {
    const { data } = await api.post('/auth/setup-company', {
      name: form.value.name.trim(),
      slug: form.value.slug || null,
      street: form.value.street.trim(),
      addressNumber: form.value.addressNumber.trim() || null,
      addressNeighborhood: form.value.addressNeighborhood.trim() || null,
      city: form.value.city.trim(),
      state: form.value.state,
      postalCode: form.value.postalCode.replace(/\D/g, '') || null,
    })

    // Update auth with new token and user data (now has companyId)
    auth.token = data.token
    auth.user = data.user
    localStorage.setItem('token', data.token)
    localStorage.setItem('user', JSON.stringify(data.user))

    router.push('/orders')
  } catch (e) {
    error.value = e?.response?.data?.message || 'Erro ao criar empresa'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="d-flex align-items-center justify-content-center min-vh-100 bg-light py-4">
    <div class="card" style="width: 520px; border: none; border-radius: 36px; padding: 8px;">
      <div class="card-body">
        <!-- Progress indicator -->
        <div class="d-flex justify-content-center mb-4">
          <div class="d-flex align-items-center gap-2">
            <span class="step-dot" :class="{ active: step >= 1 }">1</span>
            <span class="step-line" :class="{ active: step >= 2 }"></span>
            <span class="step-dot" :class="{ active: step >= 2 }">2</span>
            <span class="step-line" :class="{ active: step >= 3 }"></span>
            <span class="step-dot" :class="{ active: step >= 3 }">3</span>
          </div>
        </div>

        <!-- Step 1: Company Name -->
        <div v-if="step === 1">
          <h4 class="text-center mb-1">Cadastrar Empresa</h4>
          <p class="text-muted small text-center mb-4">Informe os dados da sua empresa para começar</p>

          <div class="mb-3">
            <label for="companyName" class="form-label">Nome da Empresa *</label>
            <input
              v-model="form.name"
              id="companyName"
              type="text"
              class="form-control"
              placeholder="Ex: Pizzaria do João"
              required
              @keyup.enter="nextStep"
            />
          </div>

          <div class="mb-3">
            <label for="slug" class="form-label">
              Slug (link do cardápio)
              <small class="text-muted fw-normal">- opcional</small>
            </label>
            <div class="input-group">
              <span class="input-group-text small">/public/</span>
              <input
                v-model="form.slug"
                id="slug"
                type="text"
                class="form-control"
                placeholder="pizzaria-do-joao"
              />
            </div>
            <small class="text-muted">Usado como link para o cardápio digital</small>
          </div>

          <div class="d-grid mt-4">
            <button class="btn btn-primary" :disabled="!canProceedStep1" @click="nextStep">
              Próximo
            </button>
          </div>
        </div>

        <!-- Step 2: Address -->
        <div v-if="step === 2">
          <h4 class="text-center mb-1">Endereço da Empresa</h4>
          <p class="text-muted small text-center mb-4">Este endereço será usado como padrão para seus clientes</p>

          <div class="row g-2">
            <div class="col-12">
              <label for="street" class="form-label">Rua *</label>
              <input
                v-model="form.street"
                id="street"
                type="text"
                class="form-control"
                placeholder="Ex: Rua das Flores"
                required
              />
            </div>

            <div class="col-md-4">
              <label for="addressNumber" class="form-label">Número</label>
              <input
                v-model="form.addressNumber"
                id="addressNumber"
                type="text"
                class="form-control"
                placeholder="123"
              />
            </div>

            <div class="col-md-8">
              <label for="addressNeighborhood" class="form-label">Bairro</label>
              <input
                v-model="form.addressNeighborhood"
                id="addressNeighborhood"
                type="text"
                class="form-control"
                placeholder="Centro"
              />
            </div>

            <div class="col-md-5">
              <label for="city" class="form-label">Cidade *</label>
              <input
                v-model="form.city"
                id="city"
                type="text"
                class="form-control"
                placeholder="Ex: São Paulo"
                required
              />
            </div>

            <div class="col-md-3">
              <label for="state" class="form-label">Estado *</label>
              <select v-model="form.state" id="state" class="form-select" required>
                <option value="">UF</option>
                <option v-for="uf in UF_LIST" :key="uf" :value="uf">{{ uf }}</option>
              </select>
            </div>

            <div class="col-md-4">
              <label for="postalCode" class="form-label">CEP</label>
              <input
                :value="form.postalCode"
                @input="formatCep"
                id="postalCode"
                type="text"
                class="form-control"
                placeholder="00000-000"
                maxlength="9"
              />
            </div>
          </div>

          <div class="d-flex gap-2 mt-4">
            <button class="btn btn-outline-secondary flex-fill" @click="prevStep">Voltar</button>
            <button class="btn btn-primary flex-fill" :disabled="!canProceedStep2" @click="nextStep">Próximo</button>
          </div>
        </div>

        <!-- Step 3: Confirmation -->
        <div v-if="step === 3">
          <h4 class="text-center mb-1">Confirmar Dados</h4>
          <p class="text-muted small text-center mb-4">Revise os dados antes de criar sua empresa</p>

          <div class="bg-light rounded-3 p-3 mb-3">
            <div class="mb-2">
              <small class="text-muted d-block">Empresa</small>
              <strong>{{ form.name }}</strong>
              <span v-if="form.slug" class="text-muted ms-2 small">({{ form.slug }})</span>
            </div>
            <hr class="my-2">
            <div>
              <small class="text-muted d-block">Endereço</small>
              <strong>
                {{ form.street }}<template v-if="form.addressNumber">, {{ form.addressNumber }}</template>
              </strong>
              <br>
              <span v-if="form.addressNeighborhood">{{ form.addressNeighborhood }} - </span>
              {{ form.city }}/{{ form.state }}
              <span v-if="form.postalCode"> - CEP: {{ form.postalCode }}</span>
            </div>
          </div>

          <div v-if="error" class="alert alert-danger py-2 small">
            {{ error }}
          </div>

          <div class="d-flex gap-2">
            <button class="btn btn-outline-secondary flex-fill" @click="prevStep" :disabled="loading">Voltar</button>
            <button class="btn btn-primary flex-fill" :disabled="loading" @click="submit">
              <span v-if="loading" class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
              Criar Empresa
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.form-label {
  font-weight: bold;
  font-size: 0.85rem;
  margin-bottom: 0px;
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
}

.step-dot.active {
  background: #3b82f6;
  color: #fff;
}

.step-line {
  width: 40px;
  height: 3px;
  background: #e6eef6;
  border-radius: 2px;
  transition: all 200ms ease;
}

.step-line.active {
  background: #3b82f6;
}
</style>
