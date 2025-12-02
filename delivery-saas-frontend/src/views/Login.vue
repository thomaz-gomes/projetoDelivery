<script setup>
import { ref } from 'vue';
import { useAuthStore } from '../stores/auth';
import { useRoute, useRouter } from 'vue-router';

const email = ref('admin@example.com');
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
      await auth.login(email.value, password.value);
    }
  // redirect: affiliates -> /affiliate, riders -> /rider, otherwise redirect param or /orders
  let destination = route.query.redirect || '/orders';
  if (auth.user?.affiliateId) destination = '/affiliate';
  else if (auth.user?.role === 'RIDER') destination = '/rider';
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
            <input
              id="email"
              v-model="email"
              type="email"
              class="form-control"
              placeholder="admin@example.com"
              required
            />
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

/* Custom radio card selector */
.radio-list { display: grid; gap: 10px; }
.radio-card { display: block; cursor: pointer; }
.radio-card input { position: absolute; opacity: 0; pointer-events: none; }
.radio-card .card-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border: 1px solid #e6eef6;
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 4px 8px rgba(18, 38, 63, 0.04);
  transition: all 160ms ease;
}
.radio-card .card-content .left { display:flex; align-items:center; gap:10px; }
.radio-card .indicator {
  width:18px; height:18px; border-radius:50%;
  background: #f1f5f9; border: 2px solid #e6eef6; display:inline-block; box-sizing:border-box;
}
.radio-card .label-text { font-weight:500; color:#0f1724; }
.radio-card .label-text .muted { font-weight:400; color:#6b7280; font-size:12px; margin-left:6px; }
.radio-card .right { color:#374151; font-size:13px; }

/* Selected state */
.radio-card input:checked + .card-content {
  border-color: #3b82f6; /* blue */
  box-shadow: 0 6px 16px rgba(59,130,246,0.14);
}
.radio-card input:checked + .card-content .indicator {
  background: linear-gradient(180deg,#fff,#3b82f6);
  border-color: #3b82f6;
}

/* Hover */
.radio-card:hover .card-content { transform: translateY(-1px); }

</style>