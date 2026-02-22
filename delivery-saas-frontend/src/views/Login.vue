<script setup>
import { ref } from 'vue';
import { useAuthStore } from '../stores/auth';
import { useRoute, useRouter } from 'vue-router';

// Default dev login matches the seeded demo company (see backend scripts/seed_demo_company.mjs)
const email = ref('admin@demo.local');
const password = ref('admin123');
const whatsapp = ref('');
const loginType = ref('operator'); // 'operator' = email, 'rider' = whatsapp (motoboy), 'affiliate' = whatsapp (afiliado)
const loading = ref(false);
const error = ref('');

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();

async function onSubmit() {
  loading.value = true;
  error.value = '';
  try {
    if (loginType.value === 'rider' || loginType.value === 'affiliate') {
      const digits = (whatsapp.value || '').replace(/\D/g, '');
      // client-side validation: require 10 or 11 digits
      if (!(digits.length === 10 || digits.length === 11)) {
        throw { message: 'Informe um WhatsApp válido com 10 ou 11 dígitos' };
      }
      if (loginType.value === 'rider') {
        await auth.loginWhatsapp(digits.slice(-11), password.value);
      } else {
        await auth.loginWhatsappAffiliate(digits.slice(-11), password.value);
      }
    } else {
      const data = await auth.login(email.value, password.value);
      // Handle needsVerification: redirect to verify-email
      if (data?.needsVerification) {
        router.push({ path: '/verify-email', query: { email: email.value } });
        return;
      }
      // Handle needsSetup: redirect to company wizard
      if (data?.needsSetup) {
        router.push('/setup');
        return;
      }
    }
  // redirect: affiliates -> /affiliate, riders -> /rider, super admin -> /saas, otherwise redirect param or /orders
  let destination = route.query.redirect || '/orders';
  if (auth.user?.affiliateId) destination = '/affiliate';
  else if (auth.user?.role === 'RIDER') destination = '/rider';
  else if (auth.user?.role === 'SUPER_ADMIN') destination = '/saas';
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
  <div class="login-page d-flex align-items-center justify-content-center vh-100">
    <div class="card login-card">
      <div class="card-body">
        <div class="text-center mb-4">
          <div class="login-logo mb-2"><img src="/core.png" alt="Logo" class="logo"></div>
          <h4 class="card-title mb-1">Delivery SaaS</h4>
          <p class="text-muted small mb-0">Acesse sua conta</p>
        </div>

        <form @submit.prevent="onSubmit" class="needs-validation">
          <div class="mb-3">
            <div class="radio-list">
              <label class="radio-card">
                <input type="radio" name="loginType" value="operator" v-model="loginType" />
                <div class="card-content">
                  <div class="left">
                    <span class="indicator" aria-hidden="true"></span>
                    <span class="label-text">Operador <small class="muted">(login com email)</small></span>
                  </div>
                </div>
              </label>

              <label class="radio-card">
                <input type="radio" name="loginType" value="rider" v-model="loginType" />
                <div class="card-content">
                  <div class="left">
                    <span class="indicator" aria-hidden="true"></span>
                    <span class="label-text">Motoboy <small class="muted">(login com whatsapp)</small></span>
                  </div>
                </div>
              </label>

              <label class="radio-card">
                <input type="radio" name="loginType" value="affiliate" v-model="loginType" />
                <div class="card-content">
                  <div class="left">
                    <span class="indicator" aria-hidden="true"></span>
                    <span class="label-text">Afiliado <small class="muted">(login com whatsapp)</small></span>
                  </div>
                </div>
              </label>
            </div>
          </div>
          <div class="mb-3" v-if="loginType === 'operator'">
            <label for="email" class="form-label">E-mail</label>
            <TextInput v-model="email" id="email" placeholder="admin@example.com" inputClass="form-control" required />
          </div>

          <div class="mb-3" v-if="loginType === 'rider' || loginType === 'affiliate'">
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
                </div>

          <div class="mb-3">
            <label for="password" class="form-label">Senha</label>
            <TextInput v-model="password" id="password" placeholder="Digite sua senha" inputClass="form-control" required />
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

          <div class="text-center mt-3">
            <router-link to="/register" class="text-decoration-none small">
              Não tem conta? Cadastre-se
            </router-link>
          </div>
        </form>

      </div>
    </div>
  </div>
</template>

<style scoped>
/* Login page background */
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

/* Custom radio card selector */
.radio-list { display: grid; gap: 8px; }
.radio-card { display: block; cursor: pointer; }
.radio-card input { position: absolute; opacity: 0; pointer-events: none; }
.radio-card .card-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border: 1px solid var(--border-color, #E6E6E6);
  background: #fff;
  border-radius: var(--border-radius-sm, 0.5rem);
  box-shadow: none;
  transition: all 160ms ease;
}
.radio-card .card-content .left { display:flex; align-items:center; gap:10px; }
.radio-card .indicator {
  width:18px; height:18px; border-radius:50%;
  background: var(--bg-zebra, #FAFAFA); border: 2px solid var(--border-color, #E6E6E6); display:inline-block; box-sizing:border-box;
  transition: all 160ms ease;
}
.radio-card .label-text { font-weight:500; color: var(--text-primary, #212529); }
.radio-card .label-text .muted { font-weight:400; color: var(--text-muted, #ADB5BD); font-size:12px; margin-left:6px; }
.radio-card .right { color: var(--text-secondary, #6C757D); font-size:13px; }

/* Selected state */
.radio-card input:checked + .card-content {
  border-color: var(--primary, #105784);
  background: rgba(16, 87, 132, 0.04);
  box-shadow: 0 0 0 1px var(--primary, #105784);
}
.radio-card input:checked + .card-content .indicator {
  background-color: var(--primary, #105784);
  border-color: var(--primary, #105784);
}

/* Hover */
.radio-card:hover .card-content {
  border-color: var(--primary-light, #1A6FA8);
  transform: translateY(-1px);
}

/* Button override for login */
.login-card .btn-primary {
  padding: 0.6rem;
  font-weight: 600;
  font-size: 0.95rem;
}
</style>