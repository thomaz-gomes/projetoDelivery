<script setup>
import { ref } from 'vue';
import { useAuthStore } from '../stores/auth';
import { useRoute, useRouter } from 'vue-router';

const email = ref('admin@example.com');
const password = ref('admin123');
const whatsapp = ref('');
const loginType = ref('operator'); // 'operator' = email, 'rider' = whatsapp/affiliate
const loading = ref(false);
const error = ref('');

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();

async function onSubmit() {
  loading.value = true;
  error.value = '';
  try {
    if (loginType.value === 'rider') {
      const digits = (whatsapp.value || '').replace(/\D/g, '');
      // client-side validation: require 10 or 11 digits
      if (!(digits.length === 10 || digits.length === 11)) {
        throw { message: 'Informe um WhatsApp válido com 10 ou 11 dígitos' };
      }
      await auth.loginWhatsapp(digits.slice(-11), password.value);
    } else {
      await auth.login(email.value, password.value);
    }
  // redirect based on role
  // Riders should land on their orders page directly
  const destination = auth.user?.role === 'RIDER' ? '/rider/orders' : (route.query.redirect || '/orders');
  router.push(destination);
  } catch (e) {
    error.value = e?.response?.data?.message || 'Falha ao entrar';
  } finally {
    loading.value = false;
  }
}

function formatPhone(digits) {
  if (!digits) return '';
  // limit to 11 digits
  const d = digits.slice(0, 11);
  if (d.length <= 2) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0,2)}) ${d.slice(2)}`;
  if (d.length === 10) return `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`;
  // 11 digits
  return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`;
}

function onWhatsappInput(e) {
  const raw = (e.target.value || '').replace(/\D/g, '').slice(0, 11);
  const masked = formatPhone(raw);
  whatsapp.value = masked;
  // update the visible value in case v-model is out of sync
  e.target.value = masked;
}
</script>

<template>
  <div class="d-flex align-items-center justify-content-center vh-100 bg-light">
    <div class="card shadow-sm" style="width: 360px;">
      <div class="card-body">
        <h4 class="card-title mb-4 text-center">Login</h4>

        <form @submit.prevent="onSubmit" class="needs-validation">
          <div class="mb-3">
            <label class="form-label d-block">Tipo de login</label>
            <div class="form-check form-check-inline">
              <input class="form-check-input" type="radio" id="loginTypeOp" value="operator" v-model="loginType">
              <label class="form-check-label" for="loginTypeOp">Operador (login com email)</label>
            </div>
            <div class="form-check form-check-inline">
              <input class="form-check-input" type="radio" id="loginTypeRider" value="rider" v-model="loginType">
              <label class="form-check-label" for="loginTypeRider">Motoboy/Afiliado (login com whatsapp)</label>
            </div>
          </div>
          <div class="mb-3" v-if="loginType === 'operator'">
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

          <div class="mb-3" v-if="loginType === 'rider'">
            <label for="whatsapp" class="form-label">WhatsApp (10 ou 11 dígitos, sem DDI)</label>
            <input
              id="whatsapp"
              :value="whatsapp"
              @input="onWhatsappInput"
              type="text"
              class="form-control"
              placeholder="(73) 99141-29676"
              required
            />
            <div class="form-text small">Digite apenas números; máscara aplicada automaticamente.</div>
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