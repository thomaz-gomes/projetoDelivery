<script setup>
import { ref } from 'vue';
import { useAuthStore } from '../stores/auth';
import { useRoute, useRouter } from 'vue-router';

const email = ref('admin@example.com');
const password = ref('admin123');
const loading = ref(false);
const error = ref('');

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();

async function onSubmit() {
  loading.value = true;
  error.value = '';
  try {
    await auth.login(email.value, password.value);
    router.push(route.query.redirect || '/orders');
  } catch (e) {
    error.value = e?.response?.data?.message || 'Falha ao entrar';
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="d-flex align-items-center justify-content-center vh-100 bg-light">
    <div class="card shadow-sm" style="width: 360px;">
      <div class="card-body">
        <h4 class="card-title mb-4 text-center">Login</h4>

        <form @submit.prevent="onSubmit" class="needs-validation">
          <div class="mb-3">
            <label for="email" class="form-label">E-mail</label>
            <input
              id="email"
              v-model="email"
              type="email"
              class="form-control"
              placeholder="admin@example.com"
              required
            />
          </div>

          <div class="mb-3">
            <label for="password" class="form-label">Senha</label>
            <input
              id="password"
              v-model="password"
              type="password"
              class="form-control"
              placeholder="Digite sua senha"
              required
            />
          </div>

          <div v-if="error" class="alert alert-danger py-2 small">
            {{ error }}
          </div>

          <div class="d-grid">
            <button
              type="submit"
              class="btn btn-primary"
              :disabled="loading"
            >
              <span
                v-if="loading"
                class="spinner-border spinner-border-sm me-2"
                role="status"
                aria-hidden="true"
              ></span>
              Entrar
            </button>
          </div>
        </form>

        <p class="text-muted small mt-3 text-center">
          Rider para teste: <b>rider@example.com</b> / <b>rider123</b>
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page { max-width:360px; margin:60px auto; }
input { display:block; width:100%; padding:8px; margin:8px 0; }
button { padding:8px 12px; }
.err { color:crimson; }
.hint { color:#555; font-size:12px; margin-top:8px; }
</style>