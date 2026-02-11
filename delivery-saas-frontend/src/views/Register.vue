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
  <div class="d-flex align-items-center justify-content-center vh-100 bg-light">
    <div class="card" style="width: 400px; border: none; border-radius: 36px; padding: 8px;">
      <div class="card-body">
        <h4 class="card-title mb-4 text-center">Criar Conta</h4>

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
.form-label {
  font-weight: bold;
  font-size: 0.85rem;
  margin-bottom: 0px;
}
</style>
