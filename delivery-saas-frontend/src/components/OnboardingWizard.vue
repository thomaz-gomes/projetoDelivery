<template>
  <div v-if="visible" class="onboarding-backdrop">
    <div class="onboarding-card">

      <!-- Brand -->
      <div class="text-center mb-4">
        <img src="/core.png" alt="Logo" style="max-width:130px" />
      </div>

      <!-- Step indicator: 3 passos -->
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

      <!-- ── PASSO 1: Loja ── -->
      <template v-if="step === 0">
        <h5 class="text-center mb-1">Bem-vindo! Crie sua primeira loja</h5>
        <p class="text-center text-muted small mb-4">Preencha os dados básicos e avance.</p>

        <div class="mb-3">
          <TextInput label="Nome da loja *" v-model="storeForm.name" inputClass="form-control" labelClass="form-label" placeholder="Ex: Hamburgeria do João" />
        </div>
        <div class="mb-3">
          <TextInput label="Endereço" v-model="storeForm.address" inputClass="form-control" labelClass="form-label" placeholder="Rua, número, bairro..." />
        </div>
        <div class="row g-3 mb-3">
          <div class="col-6">
            <TextInput label="Telefone" v-model="storeForm.phone" inputClass="form-control" labelClass="form-label" placeholder="(00) 0000-0000" maxlength="15" />
          </div>
          <div class="col-6">
            <TextInput label="CNPJ" v-model="storeForm.cnpj" inputClass="form-control" labelClass="form-label" placeholder="00.000.000/0000-00" />
          </div>
        </div>

        <div v-if="error" class="alert alert-danger py-2 small mb-3">{{ error }}</div>

        <div class="d-flex justify-content-between align-items-center mt-2">
          <button class="btn btn-link text-muted small p-0" @click="skip" type="button">Pular por agora</button>
          <button class="btn btn-primary" @click="saveStore" :disabled="saving" type="button">
            <span v-if="saving" class="spinner-border spinner-border-sm me-1" role="status"></span>
            Próximo <i class="bi bi-arrow-right ms-1"></i>
          </button>
        </div>
      </template>

      <!-- ── PASSO 2: Cardápio ── -->
      <template v-if="step === 1">
        <h5 class="text-center mb-1">Crie seu primeiro cardápio</h5>
        <p class="text-center text-muted small mb-4">
          O cardápio é a vitrine pública da loja.
        </p>

        <div class="mb-3">
          <TextInput label="Nome do cardápio *" v-model="menuForm.name" inputClass="form-control" labelClass="form-label" placeholder="Ex: Cardápio Principal" />
        </div>

        <div v-if="error" class="alert alert-danger py-2 small mb-3">{{ error }}</div>

        <div class="d-flex justify-content-between align-items-center mt-2">
          <button v-if="step > initialStep" class="btn btn-outline-secondary" @click="step = 0" type="button">
            <i class="bi bi-arrow-left me-1"></i>Voltar
          </button>
          <div v-else></div>
          <button class="btn btn-primary" @click="saveMenu" :disabled="saving" type="button">
            <span v-if="saving" class="spinner-border spinner-border-sm me-1" role="status"></span>
            Próximo <i class="bi bi-arrow-right ms-1"></i>
          </button>
        </div>
      </template>

      <!-- ── PASSO 3: Primeiro item ── -->
      <template v-if="step === 2">
        <h5 class="text-center mb-1">Adicione seu primeiro item</h5>
        <p class="text-center text-muted small mb-4">
          Cadastre um produto para começar a receber pedidos.
        </p>

        <div class="mb-3">
          <TextInput label="Categoria *" v-model="itemForm.categoryName" inputClass="form-control" labelClass="form-label" placeholder="Ex: Lanches, Pizzas, Bebidas..." />
        </div>
        <div class="mb-3">
          <TextInput label="Nome do produto *" v-model="itemForm.name" inputClass="form-control" labelClass="form-label" placeholder="Ex: X-Burguer, Pizza Margherita..." />
        </div>
        <div class="row g-3 mb-3">
          <div class="col-6">
            <label class="form-label">Preço (R$) *</label>
            <input type="number" class="form-control" v-model="itemForm.price" placeholder="0,00" min="0" step="0.01" />
          </div>
          <div class="col-6">
            <TextInput label="Descrição" v-model="itemForm.description" inputClass="form-control" labelClass="form-label" placeholder="Opcional" />
          </div>
        </div>

        <div v-if="error" class="alert alert-danger py-2 small mb-3">{{ error }}</div>

        <div class="d-flex justify-content-between align-items-center mt-2">
          <button v-if="step > initialStep" class="btn btn-outline-secondary" @click="step = 1" type="button">
            <i class="bi bi-arrow-left me-1"></i>Voltar
          </button>
          <div v-else></div>
          <button class="btn btn-success" @click="saveItem" :disabled="saving" type="button">
            <span v-if="saving" class="spinner-border spinner-border-sm me-1" role="status"></span>
            <i v-else class="bi bi-check-lg me-1"></i>Concluir
          </button>
        </div>
      </template>

    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import api from '../api.js'
import TextInput from './form/input/TextInput.vue'

const STEPS = ['Loja', 'Cardápio', 'Primeiro item']

const props = defineProps({
  visible:        { type: Boolean, default: false },
  initialStep:    { type: Number,  default: 0 },
  initialStoreId: { type: String,  default: null },
  initialMenuId:  { type: String,  default: null },
})

const emit = defineEmits(['done', 'skip'])

// Inicializa a partir do estado passado pelo App.vue
const step          = ref(props.initialStep)
const createdStoreId = ref(props.initialStoreId)
const createdMenuId  = ref(props.initialMenuId)

const saving = ref(false)
const error  = ref('')

const storeForm = ref({ name: '', address: '', phone: '', cnpj: '' })
const menuForm  = ref({ name: '' })
const itemForm  = ref({ categoryName: '', name: '', price: '', description: '' })

async function saveStore() {
  error.value = ''
  if (!storeForm.value.name.trim()) { error.value = 'Informe o nome da loja.'; return }
  saving.value = true
  try {
    const { data } = await api.post('/stores', {
      name:    storeForm.value.name.trim(),
      address: storeForm.value.address || undefined,
      phone:   storeForm.value.phone   || undefined,
      cnpj:    storeForm.value.cnpj    || undefined,
    })
    createdStoreId.value = data.id
    step.value = 1
  } catch (e) {
    error.value = e?.response?.data?.message || 'Erro ao criar a loja.'
  } finally {
    saving.value = false
  }
}

async function saveMenu() {
  error.value = ''
  if (!menuForm.value.name.trim()) { error.value = 'Informe o nome do cardápio.'; return }
  saving.value = true
  try {
    const { data } = await api.post('/menu/menus', {
      name:    menuForm.value.name.trim(),
      storeId: createdStoreId.value || undefined,
    })
    createdMenuId.value = data.id
    step.value = 2
  } catch (e) {
    error.value = e?.response?.data?.message || 'Erro ao criar o cardápio.'
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
    })
    emit('done')
  } catch (e) {
    error.value = e?.response?.data?.message || 'Erro ao criar o item.'
  } finally {
    saving.value = false
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
  max-width: 480px;
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
  width: 48px;
  flex-shrink: 0;
  margin-bottom: 20px; /* alinha com o centro dos dots */
  transition: background 0.2s;
}
.step-line.done { background: #198754; }
</style>
