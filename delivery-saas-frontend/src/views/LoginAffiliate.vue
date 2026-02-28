<script setup>
import { ref, onMounted } from 'vue';
import { useAuthStore } from '../stores/auth';
import { useRouter } from 'vue-router';
import api from '../api';

const whatsapp = ref('');
const password = ref('');
const loading = ref(false);
const error = ref('');

const auth = useAuthStore();
const router = useRouter();

onMounted(async () => {
  try {
    const { data } = await api.get('/auth/login-options');
    if (!data.affiliate) router.replace('/login');
  } catch {}
});

async function onSubmit() {
  loading.value = true;
  error.value = '';
  try {
    const digits = (whatsapp.value || '').replace(/\D/g, '');
    if (!(digits.length === 10 || digits.length === 11)) {
      throw { message: 'Informe um WhatsApp válido com 10 ou 11 dígitos' };
    }
    await auth.loginWhatsappAffiliate(digits.slice(-11), password.value);
    router.push('/affiliate');
  } catch (e) {
    error.value = e?.response?.data?.message || e?.message || 'Falha ao entrar';
  } finally {
    loading.value = false;
  }
}

function onWhatsappInput(e) {
  const raw = (e.target.value || '').replace(/\D/g, '').slice(0, 11);
  const d = raw;
  let masked = '';
  if (d.length <= 2) masked = `(${d}`;
  else if (d.length <= 6) masked = `(${d.slice(0,2)}) ${d.slice(2)}`;
  else if (d.length === 10) masked = `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`;
  else masked = `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`;
  whatsapp.value = masked;
  e.target.value = masked;
}
</script>

<template>
  <div class="login-page d-flex align-items-center justify-content-center vh-100">
    <div class="card login-card">
      <div class="card-body">
        <div class="text-center mb-4">
          <div class="login-logo mb-2"><img src="/core.png" alt="Logo" class="logo"></div>
          <p class="text-muted small mb-0"><i class="bi bi-people me-1"></i>Acesso do Afiliado</p>
        </div>

        <form @submit.prevent="onSubmit" class="needs-validation">
          <div class="mb-3">
            <label for="whatsapp" class="form-label">WhatsApp (sem DDI)</label>
            <input
              id="whatsapp"
              :value="whatsapp"
              @input="onWhatsappInput"
              type="text"
              class="form-control"
              placeholder="(00) 00000-0000"
              required
            />
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
        </form>

        <hr class="my-3" />
        <div class="text-center small text-muted mb-2">Outro tipo de acesso</div>
        <div class="d-flex justify-content-center gap-2">
          <router-link to="/login" class="btn btn-sm btn-outline-secondary">
            <i class="bi bi-person-badge me-1"></i>Operador
          </router-link>
          <router-link to="/login/rider" class="btn btn-sm btn-outline-secondary">
            <i class="bi bi-bicycle me-1"></i>Motoboy
          </router-link>
        </div>
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
