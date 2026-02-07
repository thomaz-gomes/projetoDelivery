<template>
  <div class="affiliate-form container py-4">
    <div class="card mx-auto" style="max-width:520px">
      <div class="card-body">
        <form @submit.prevent="handleSubmit">
      <div class="form-group">
        <label for="name">Nome do Afiliado *</label>
        <TextInput v-model="form.name" id="name" placeholder="Nome completo do afiliado" required />
      </div>

      <div class="form-group">
        <label for="email">E-mail</label>
        <TextInput v-model="form.email" id="email" placeholder="email@exemplo.com" />
      </div>

      <div class="form-group">
        <label for="whatsapp">WhatsApp</label>
        <TextInput v-model="form.whatsapp" id="whatsapp" placeholder="(00) 0 0000-0000" maxlength="16" @input="formatPhone" />
      </div>

      <div class="form-group">
        <label for="password">Senha</label>
        <TextInput v-model="form.password" id="password" placeholder="Senha para login" autocomplete="new-password" required />
        <small class="form-hint">{{ isEditing ? 'Preencha apenas para alterar a senha (opcional ao editar)' : 'Afiliado fará login com WhatsApp + senha (mínimo 6 caracteres)'}} </small>
      </div>

      <div class="form-group">
        <!-- Coupon code removed from affiliate form. Coupons should be linked when creating a coupon. -->
      </div>

      <div class="form-group">
        <label for="commissionRate">Taxa de Comissão (%)</label>
        <input 
          id="commissionRate"
          v-model.number="form.commissionRate" 
          type="number" 
          min="0" 
          max="100" 
          step="0.1"
          placeholder="0.0"
        />
        <small class="form-hint">
          Porcentagem que o afiliado receberá sobre cada venda (0-100%)
        </small>
      </div>

      <div class="form-group" v-if="isEditing">
        <label>
          <input 
            v-model="form.isActive" 
            type="checkbox"
          />
          Afiliado ativo
        </label>
        <small class="form-hint">
          Afiliados inativos não podem gerar novas comissões
        </small>
      </div>

      <div v-if="error" class="form-error">
        <i class="fas fa-exclamation-triangle"></i>
        {{ error }}
      </div>

      <div class="form-actions">
        <button type="button" @click="$emit('cancel')" class="btn btn-outline-secondary">
          Cancelar
        </button>
        <button type="submit" :disabled="loading" class="btn btn-success">
          <i v-if="loading" class="fas fa-spinner fa-spin"></i>
          {{ loading ? 'Salvando...' : (isEditing ? 'Atualizar' : 'Criar Afiliado') }}
        </button>
      </div>
      </form>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, computed, onMounted } from 'vue'
import api from '@/api.js'
import { applyPhoneMask } from '../utils/phoneMask'

export default {
  name: 'AffiliateForm',
  props: {
    affiliate: {
      type: Object,
      default: null
    }
  },
  emits: ['saved', 'cancel'],
  setup(props, { emit }) {
    const loading = ref(false)
    const error = ref('')
    
    const form = ref({
      name: '',
      email: '',
      password: '',
      whatsapp: '',
      commissionRate: 0,
      isActive: true
    })

    const isEditing = computed(() => !!props.affiliate)

    const formatPhone = (val) => {
      // TextInput emits the new value (string), not the DOM event.
      const raw = val && val.target ? val.target.value : val
      form.value.whatsapp = applyPhoneMask(raw)
    }

    const validateForm = () => {
      if (!form.value.name.trim()) {
        error.value = 'Nome é obrigatório'
        return false
      }

      if (form.value.commissionRate < 0 || form.value.commissionRate > 100) {
        error.value = 'Taxa de comissão deve estar entre 0 e 100%'
        return false
      }

      if (form.value.email && !isValidEmail(form.value.email)) {
        error.value = 'E-mail inválido'
        return false
      }

      // Password requirement on create: affiliates must have a password to allow login
      if (!isEditing.value) {
        if (!form.value.password || form.value.password.length < 6) {
          error.value = 'Senha é obrigatória (mínimo 6 caracteres)'
          return false
        }
      }

      return true
    }

    const isValidEmail = (email) => {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      return emailRegex.test(email)
    }

    const handleSubmit = async () => {
      error.value = ''
      
      if (!validateForm()) {
        return
      }

      loading.value = true

      try {
        // Normalize whatsapp: send only digits (backend expects plain digits)
        const normalizedWhats = (form.value.whatsapp || '').toString().replace(/\D/g, '')
        const payload = {
          ...form.value,
          commissionRate: form.value.commissionRate / 100, // Convert percentage to decimal
          email: form.value.email || null,
          whatsapp: normalizedWhats || null
        }
        // Only send password when provided (avoid sending empty strings when editing)
        if (form.value.password) payload.password = form.value.password

        let response
        if (isEditing.value) {
          response = await api.put(`/affiliates/${props.affiliate.id}`, payload)
        } else {
          response = await api.post('/affiliates', payload)
        }

        emit('saved', response.data)
      } catch (err) {
        error.value = err.response?.data?.message || 'Erro ao salvar afiliado'
        console.error('Error saving affiliate:', err)
      } finally {
        loading.value = false
      }
    }

    // Initialize form with existing data if editing
    onMounted(() => {
      if (props.affiliate) {
        form.value = {
          name: props.affiliate.name || '',
          email: props.affiliate.email || '',
          // show masked whatsapp in input when editing
          whatsapp: props.affiliate.whatsapp ? applyPhoneMask(props.affiliate.whatsapp) : '',
          commissionRate: (props.affiliate.commissionRate * 100) || 0, // Convert to percentage
          isActive: props.affiliate.isActive !== false
        }
      }
    })

    return {
      form,
      loading,
      error,
      isEditing,
      formatPhone,
      handleSubmit
    }
  }
}
</script>

<style scoped>
  .affiliate-form { padding: 20px }

  .form-group { margin-bottom: 12px }

.form-group label {
  display: block;
  margin-bottom: 6px;
  font-weight: 500;
  color: #333;
}

  .form-group input[type="text"],
  .form-group input[type="email"],
  .form-group input[type="tel"],
  .form-group input[type="number"],
  .form-group input[type="password"] {
    width: 100%;
    padding: 10px 12px;
    border: 1px solid #e6e6e6;
    border-radius: 6px;
    font-size: 14px;
    transition: border-color 0.15s;
  }

  .form-group input:focus {
    outline: none;
    border-color: #bcd; /* subtle focus color */
    box-shadow: none;
  }

.form-group input[type="checkbox"] {
  margin-right: 8px;
}

.form-hint {
  display: block;
  font-size: 12px;
  color: #666;
  margin-top: 4px;
}

.form-error {
  background: #fee;
  border: 1px solid #fcc;
  color: #c33;
  padding: 10px;
  border-radius: 6px;
  margin-bottom: 20px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.form-actions { margin-top: 16px; display:flex; gap:12px; justify-content:flex-end }

  /* Let project/global button styles (bootstrap) apply. Keep minimal spacing rules only. */
  .form-actions .btn { padding: 10px 18px }

/* Responsive */
@media (max-width: 480px) {
  .form-actions {
    flex-direction: column;
  }
  
  .btn-primary,
  .btn-secondary {
    width: 100%;
    justify-content: center;
  }
}
</style>