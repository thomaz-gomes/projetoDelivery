<script setup>
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import api from '../api'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const email = ref('')
const code = ref('')
const loading = ref(false)
const resending = ref(false)
const error = ref('')
const success = ref('')
const cooldown = ref(0)
let cooldownTimer = null

onMounted(() => {
  email.value = route.query.email || ''
  if (!email.value) {
    router.replace('/register')
  }
})

async function onSubmit() {
  error.value = ''
  success.value = ''

  if (!code.value || code.value.length !== 6) {
    error.value = 'Digite o código de 6 dígitos'
    return
  }

  loading.value = true
  try {
    const { data } = await api.post('/auth/verify-email', {
      email: email.value,
      code: code.value,
    })

    // Save token and user to auth store
    auth.token = data.token
    auth.user = data.user
    localStorage.setItem('token', data.token)
    localStorage.setItem('user', JSON.stringify(data.user))

    if (data.needsSetup) {
      router.push('/setup')
    } else {
      router.push('/orders')
    }
  } catch (e) {
    error.value = e?.response?.data?.message || 'Código inválido'
  } finally {
    loading.value = false
  }
}

async function resendCode() {
  if (cooldown.value > 0) return

  resending.value = true
  error.value = ''
  try {
    await api.post('/auth/resend-code', { email: email.value })
    success.value = 'Código reenviado para seu email'

    // Start cooldown
    cooldown.value = 60
    cooldownTimer = setInterval(() => {
      cooldown.value--
      if (cooldown.value <= 0) {
        clearInterval(cooldownTimer)
        cooldownTimer = null
      }
    }, 1000)
  } catch (e) {
    error.value = e?.response?.data?.message || 'Erro ao reenviar código'
  } finally {
    resending.value = false
  }
}

function onCodeInput(e) {
  // Allow only digits, max 6
  code.value = (e.target.value || '').replace(/\D/g, '').slice(0, 6)
  e.target.value = code.value
}
</script>

<template>
  <div class="d-flex align-items-center justify-content-center vh-100 bg-light">
    <div class="card" style="width: 400px; border: none; border-radius: 36px; padding: 8px;">
      <div class="card-body text-center">
        <div class="mb-3">
          <i class="bi bi-envelope-check" style="font-size: 48px; color: #3b82f6;"></i>
        </div>
        <h4 class="card-title mb-2">Verificar Email</h4>
        <p class="text-muted small mb-4">
          Enviamos um código de 6 dígitos para<br>
          <strong>{{ email }}</strong>
        </p>

        <form @submit.prevent="onSubmit">
          <div class="mb-3">
            <input
              :value="code"
              @input="onCodeInput"
              type="text"
              class="form-control form-control-lg text-center code-input"
              placeholder="000000"
              maxlength="6"
              inputmode="numeric"
              autocomplete="one-time-code"
              required
            />
          </div>

          <div v-if="error" class="alert alert-danger py-2 small">
            {{ error }}
          </div>

          <div v-if="success" class="alert alert-success py-2 small">
            {{ success }}
          </div>

          <div class="d-grid mb-3">
            <button type="submit" class="btn btn-primary" :disabled="loading || code.length !== 6">
              <span v-if="loading" class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
              Verificar
            </button>
          </div>

          <div class="small">
            <button
              type="button"
              class="btn btn-link text-decoration-none p-0"
              :disabled="resending || cooldown > 0"
              @click="resendCode"
            >
              <template v-if="cooldown > 0">
                Reenviar código em {{ cooldown }}s
              </template>
              <template v-else>
                Reenviar código
              </template>
            </button>
          </div>

          <div class="mt-3">
            <router-link to="/register" class="text-decoration-none small text-muted">
              Voltar ao cadastro
            </router-link>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<style scoped>
.code-input {
  font-size: 28px;
  letter-spacing: 8px;
  font-weight: bold;
}
.form-label {
  font-weight: bold;
  font-size: 0.85rem;
  margin-bottom: 0px;
}
</style>
