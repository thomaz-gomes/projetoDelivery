<script setup>
import { ref, onMounted } from 'vue';
import { useAuthStore } from '../stores/auth';
import { useSaasStore } from '../stores/saas';
import { useRoute, useRouter } from 'vue-router';
import api from '../api';

const email = ref('admin@demo.local');
const password = ref('admin123');
const loading = ref(false);
const error = ref('');

const loginOptions = ref({ rider: true, affiliate: true });

onMounted(async () => {
  try {
    const { data } = await api.get('/auth/login-options');
    loginOptions.value = data;
  } catch {
    // mantém opções visíveis se a requisição falhar
  }
});

const auth = useAuthStore();
const saas = useSaasStore();
const route = useRoute();
const router = useRouter();

async function onSubmit() {
  loading.value = true;
  error.value = '';
  try {
    const data = await auth.login(email.value, password.value);
    if (data?.needsVerification) {
      router.push({ path: '/verify-email', query: { email: email.value } });
      return;
    }
    if (data?.needsSetup) {
      router.push('/setup');
      return;
    }
    let destination = route.query.redirect || '/orders';
    if (auth.user?.affiliateId) destination = '/affiliate';
    else if (auth.user?.role === 'RIDER') destination = '/rider';
    else if (auth.user?.role === 'SUPER_ADMIN') destination = '/saas';
    else if (auth.user?.role === 'ADMIN') {
      await saas.fetchMySubscription();
      if (saas.isCardapioSimplesOnly) destination = '/menu/menus';
    }
    router.push(destination);
  } catch (e) {
    error.value = e?.response?.data?.message || 'Falha ao entrar';
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="login-page d-flex align-items-center justify-content-center vh-100">
    <div class="card login-card">
      <div class="card-body">
        <div class="text-center mb-4">
          <div class="login-logo mb-2"><img src="/core.png" alt="Logo" class="logo"></div>
          <p class="text-muted small mb-0">Acesso do Operador</p>
        </div>

        <form @submit.prevent="onSubmit" class="needs-validation">
          <div class="mb-3">
            <label for="email" class="form-label">E-mail</label>
            <TextInput v-model="email" id="email" placeholder="admin@example.com" inputClass="form-control" required />
          </div>

          <div class="mb-3">
            <label for="password" class="form-label">Senha</label>
            <TextInput v-model="password" id="password" type="password" placeholder="Digite sua senha" inputClass="form-control" required />
          </div>

          <div v-if="error" class="alert alert-danger py-2 small">{{ error }}</div>

          <div class="d-grid">
            <button type="submit" class="btn btn-primary" :disabled="loading">
              <span v-if="loading" class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
              Entrar
            </button>
          </div>

          <div class="text-center mt-3">
            <router-link to="/register" class="text-decoration-none small">Não tem conta? Cadastre-se</router-link>
          </div>
        </form>

        <template v-if="loginOptions.rider || loginOptions.affiliate">
          <hr class="my-3" />
          <div class="text-center small text-muted mb-2">Outro tipo de acesso</div>
          <div class="d-flex justify-content-center gap-2">
            <router-link v-if="loginOptions.rider" to="/login/rider" class="btn btn-sm btn-outline-secondary">
              <i class="bi bi-bicycle me-1"></i>Motoboy
            </router-link>
            <router-link v-if="loginOptions.affiliate" to="/login/affiliate" class="btn btn-sm btn-outline-secondary">
              <i class="bi bi-people me-1"></i>Afiliado
            </router-link>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.login-page {
  background: linear-gradient(135deg, #8cbe1f 0%, #89d136 60%, #8cbe1f 100%);
  min-height: 100vh;
}
.login-card {
  width: 380px;
  border: none;
  border-radius: var(--border-radius, 0.75rem);
  padding: 2rem 1.5rem;
  box-shadow: 0 1rem 3rem rgba(0, 0, 0, 0.2);
}
.login-logo {
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
}
.form-label {
  font-weight: 600;
  font-size: 0.85rem;
  margin-bottom: 0.25rem;
  color: var(--text-secondary, #6C757D);
}
.login-card .btn-primary {
  padding: 0.6rem;
  font-weight: 600;
  font-size: 0.95rem;
}
</style>
