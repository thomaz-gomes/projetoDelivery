<template>
  <div class="affiliate-form">
    <form @submit.prevent="handleSubmit">
      <div class="form-group">
        <label for="name">Nome do Afiliado *</label>
        <input 
          id="name"
          v-model="form.name" 
          type="text" 
          required
          placeholder="Nome completo do afiliado"
        />
      </div>

      <div class="form-group">
        <label for="email">E-mail</label>
        <input 
          id="email"
          v-model="form.email" 
          type="email" 
          placeholder="email@exemplo.com"
        />
      </div>

      <div class="form-group">
        <label for="whatsapp">WhatsApp</label>
        <input 
          id="whatsapp"
          v-model="form.whatsapp" 
          type="tel" 
          placeholder="(11) 99999-9999"
          @input="formatPhone"
        />
      </div>

      <div class="form-group">
        <label for="couponCode">Código do Cupom *</label>
        <input 
          id="couponCode"
          v-model="form.couponCode" 
          type="text" 
          required
          placeholder="CUPOM10, AFILIADO123, etc."
          @input="formatCouponCode"
        />
        <small class="form-hint">
          Código único que os clientes usarão para identificar este afiliado
        </small>
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
        <button type="button" @click="$emit('cancel')" class="btn-secondary">
          Cancelar
        </button>
        <button type="submit" :disabled="loading" class="btn-primary">
          <i v-if="loading" class="fas fa-spinner fa-spin"></i>
          {{ loading ? 'Salvando...' : (isEditing ? 'Atualizar' : 'Criar Afiliado') }}
        </button>
      </div>
    </form>
  </div>
</template>

<script>
import { ref, computed, onMounted } from 'vue'
import api from '@/api.js'

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
      whatsapp: '',
      couponCode: '',
      commissionRate: 0,
      isActive: true
    })

    const isEditing = computed(() => !!props.affiliate)

    const formatPhone = (event) => {
      const value = event.target.value.replace(/\D/g, '')
      let formatted = value

      if (value.length > 0) {
        if (value.length <= 2) {
          formatted = `(${value}`
        } else if (value.length <= 6) {
          formatted = `(${value.substring(0, 2)}) ${value.substring(2)}`
        } else if (value.length <= 10) {
          formatted = `(${value.substring(0, 2)}) ${value.substring(2, 6)}-${value.substring(6)}`
        } else {
          formatted = `(${value.substring(0, 2)}) ${value.substring(2, 7)}-${value.substring(7, 11)}`
        }
      }

      form.value.whatsapp = formatted
    }

    const formatCouponCode = (event) => {
      // Convert to uppercase and remove special characters
      const value = event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '')
      form.value.couponCode = value
    }

    const validateForm = () => {
      if (!form.value.name.trim()) {
        error.value = 'Nome é obrigatório'
        return false
      }

      if (!form.value.couponCode.trim()) {
        error.value = 'Código do cupom é obrigatório'
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
        const payload = {
          ...form.value,
          commissionRate: form.value.commissionRate / 100, // Convert percentage to decimal
          email: form.value.email || null,
          whatsapp: form.value.whatsapp || null
        }

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
          whatsapp: props.affiliate.whatsapp || '',
          couponCode: props.affiliate.couponCode || '',
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
      formatCouponCode,
      handleSubmit
    }
  }
}
</script>

<style scoped>
.affiliate-form {
  padding: 20px;
}

.form-group {
  margin-bottom: 20px;
}

.form-group label {
  display: block;
  margin-bottom: 6px;
  font-weight: 500;
  color: #333;
}

.form-group input[type="text"],
.form-group input[type="email"],
.form-group input[type="tel"],
.form-group input[type="number"] {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 14px;
  transition: border-color 0.2s;
}

.form-group input:focus {
  outline: none;
  border-color: #3498db;
  box-shadow: 0 0 0 3px rgba(52, 152, 219, 0.1);
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

.form-actions {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
  padding-top: 20px;
  border-top: 1px solid #eee;
}

.btn-primary,
.btn-secondary {
  padding: 12px 24px;
  border: none;
  border-radius: 6px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  gap: 8px;
}

.btn-primary {
  background: #3498db;
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background: #2980b9;
}

.btn-primary:disabled {
  background: #bdc3c7;
  cursor: not-allowed;
}

.btn-secondary {
  background: #f8f9fa;
  color: #666;
  border: 1px solid #ddd;
}

.btn-secondary:hover {
  background: #e9ecef;
  color: #333;
}

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