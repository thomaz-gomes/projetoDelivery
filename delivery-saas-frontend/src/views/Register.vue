<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import api from '../api'

const router = useRouter()
const form = ref({ name: '', email: '', password: '', confirmPassword: '' })
const loading = ref(false)
const error = ref('')

async function onSubmit() {
  error.value = ''

  if (!form.value.name || !form.value.email || !form.value.password) {
    error.value = 'Preencha todos os campos'
    return
  }
  if (form.value.password.length < 6) {
    error.value = 'Senha deve ter no mínimo 6 caracteres'
    return
  }
  if (form.value.password !== form.value.confirmPassword) {
    error.value = 'As senhas não conferem'
    return
  }

  loading.value = true
  try {
    await api.post('/auth/register', {
      name: form.value.name,
      email: form.value.email,
      password: form.value.password,
    })
    router.push({ path: '/verify-email', query: { email: form.value.email } })
  } catch (e) {
    error.value = e?.response?.data?.message || 'Erro ao criar conta'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="register-page d-flex align-items-center justify-content-center vh-100">
    <div class="card register-card">
      <div class="card-body">
        <div class="text-center mb-4">
          <div class="register-logo mb-2"><img src="/core.png" alt="Logo" class="logo"></div>
          <h4 class="card-title mb-1">Criar Conta</h4>
          <p class="text-muted small mb-0">Preencha seus dados para começar</p>
        </div>

        <form @submit.prevent="onSubmit" class="needs-validation">
          <div class="mb-3">
            <label for="name" class="form-label">Nome</label>
            <input
              v-model="form.name"
              id="name"
              type="text"
              class="form-control"
              placeholder="Seu nome completo"
              required
            />
          </div>

          <div class="mb-3">
            <label for="email" class="form-label">E-mail</label>
            <input
              v-model="form.email"
              id="email"
              type="email"
              class="form-control"
              placeholder="seu@email.com"
              required
            />
          </div>

          <div class="mb-3">
            <label for="password" class="form-label">Senha</label>
            <input
              v-model="form.password"
              id="password"
              type="password"
              class="form-control"
              placeholder="Mínimo 6 caracteres"
              required
              minlength="6"
            />
          </div>

          <div class="mb-3">
            <label for="confirmPassword" class="form-label">Confirmar Senha</label>
            <input
              v-model="form.confirmPassword"
              id="confirmPassword"
              type="password"
              class="form-control"
              placeholder="Repita a senha"
              required
            />
          </div>

          <div v-if="error" class="alert alert-danger py-2 small">
            {{ error }}
          </div>

          <div class="d-grid">
            <button type="submit" class="btn btn-primary" :disabled="loading">
              <span v-if="loading" class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
              Cadastrar
            </button>
          </div>

          <div class="text-center mt-3">
            <router-link to="/login" class="text-decoration-none small">
              Já tem conta? Faça login
            </router-link>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<style scoped>
.register-page {
  background: linear-gradient(135deg, #8cbe1f 0%, #89d136 60%, #8cbe1f 100%);
  min-height: 100vh;
}
.register-card {
  width: 400px;
  border: none;
  border-radius: var(--border-radius, 0.75rem);
  padding: 2rem 1.5rem;
  box-shadow: 0 1rem 3rem rgba(0, 0, 0, 0.2);
}
.register-logo {
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 1.5rem;
}
.card-title {
  font-weight: 700;
  color: var(--text-primary, #212529);
}
.form-label {
  font-weight: 600;
  font-size: 0.85rem;
  margin-bottom: 0.25rem;
  color: var(--text-secondary, #6C757D);
}
.register-card .btn-primary {
  padding: 0.6rem;
  font-weight: 600;
  font-size: 0.95rem;
}
</style>
