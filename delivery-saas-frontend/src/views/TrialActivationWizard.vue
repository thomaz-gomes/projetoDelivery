<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import api from '../api'
import { useSaasStore } from '../stores/saas'
import Swal from 'sweetalert2'

const router = useRouter()
const route = useRoute()
const saas = useSaasStore()

const step = ref(1)
const totalSteps = 3
const loading = ref(true)
const activating = ref(false)
const activated = ref(false)
const eligibility = ref(null)
const error = ref(null)

// Test mode: ?test=1 bypasses eligibility check
const testMode = computed(() => route.query.test === '1')

const trialDays = computed(() => eligibility.value?.trialPlan?.trialDurationDays || 7)
const trialPlanName = computed(() => eligibility.value?.trialPlan?.name || 'Profissional')

// Features to display (based on trial plan modules or defaults)
const trialFeatures = computed(() => {
  const modules = eligibility.value?.trialPlan?.modules || []
  const moduleKeys = modules.map(m => m.module?.key || m.moduleId)

  const features = [
    { icon: 'bi-cart-check', title: 'Pedidos Online', desc: 'Receba pedidos pelo cardápio digital com notificações em tempo real', always: true },
    { icon: 'bi-phone', title: 'Cardápio Digital', desc: 'Cardápio completo e personalizável com fotos e descrições', key: 'CARDAPIO_COMPLETO' },
    { icon: 'bi-people', title: 'Gestão de Clientes', desc: 'Cadastro completo, histórico de pedidos e segmentação', key: 'CARDAPIO_COMPLETO' },
    { icon: 'bi-bicycle', title: 'Gestão de Entregadores', desc: 'Controle de entregas, rotas e acertos financeiros', key: 'RIDERS' },
    { icon: 'bi-person-badge', title: 'Programa de Afiliados', desc: 'Indique e ganhe com comissões sobre vendas', key: 'AFFILIATES' },
    { icon: 'bi-graph-up-arrow', title: 'Relatórios Avançados', desc: 'Dados de vendas, produtos mais vendidos e performance', always: true },
    { icon: 'bi-printer', title: 'Impressão Automática', desc: 'Impressão de pedidos direto na impressora térmica', always: true },
    { icon: 'bi-whatsapp', title: 'WhatsApp Integrado', desc: 'Notificações automáticas para seus clientes via WhatsApp', key: 'WHATSAPP' },
  ]

  return features.filter(f => f.always || moduleKeys.includes(f.key))
})

async function checkEligibility() {
  loading.value = true
  error.value = null

  if (testMode.value) {
    // Simulate eligibility in test mode
    eligibility.value = {
      eligible: true,
      trialPlan: {
        name: 'Profissional',
        trialDurationDays: 7,
        modules: [
          { module: { key: 'CARDAPIO_COMPLETO' } },
          { module: { key: 'RIDERS' } },
          { module: { key: 'AFFILIATES' } },
        ]
      }
    }
    loading.value = false
    return
  }

  try {
    const { data } = await api.get('/saas/trial/eligibility')
    eligibility.value = data
    if (!data.eligible) {
      error.value = data.reason || 'Você não é elegível para o período de teste.'
    }
  } catch (e) {
    error.value = e.response?.data?.message || 'Erro ao verificar elegibilidade.'
  } finally {
    loading.value = false
  }
}

async function activateTrial() {
  activating.value = true

  if (testMode.value) {
    // Simulate activation in test mode
    await new Promise(r => setTimeout(r, 2000))
    activated.value = true
    activating.value = false
    return
  }

  try {
    await api.post('/saas/trial/activate')
    activated.value = true
    await saas.fetchMySubscription(true)
  } catch (e) {
    Swal.fire({ icon: 'error', text: e.response?.data?.message || 'Erro ao ativar o período de teste.' })
  } finally {
    activating.value = false
  }
}

function goToApp() {
  router.push('/orders')
}

function nextStep() {
  if (step.value < totalSteps) step.value++
}

function prevStep() {
  if (step.value > 1) step.value--
}

onMounted(() => {
  checkEligibility()
})
</script>

<template>
  <div class="trial-wizard">
    <!-- Test mode banner -->
    <div v-if="testMode" class="trial-test-banner">
      <i class="bi-bug me-2"></i>
      MODO DE TESTE — Nenhuma ação real será executada
    </div>

    <!-- Loading -->
    <div v-if="loading" class="trial-wizard__loading">
      <div class="spinner-border text-primary" role="status"></div>
      <p class="mt-3 text-muted">Carregando oferta...</p>
    </div>

    <!-- Error: not eligible -->
    <div v-else-if="error && !eligibility?.eligible" class="trial-wizard__error">
      <div class="trial-wizard__card text-center">
        <i class="bi-exclamation-triangle-fill text-warning" style="font-size: 3rem;"></i>
        <h3 class="mt-3 mb-2">Oferta indisponível</h3>
        <p class="text-muted mb-4">{{ error }}</p>
        <button class="btn btn-primary" @click="router.push('/orders')">
          Voltar ao painel
        </button>
      </div>
    </div>

    <!-- Wizard Steps -->
    <div v-else class="trial-wizard__container">
      <!-- Progress dots -->
      <div class="trial-wizard__progress">
        <span v-for="s in totalSteps" :key="s"
          class="trial-wizard__dot"
          :class="{ 'trial-wizard__dot--active': s === step, 'trial-wizard__dot--done': s < step }"
        ></span>
      </div>

      <!-- Step 1: Oferta Especial -->
      <transition name="wizard-slide" mode="out-in">
        <div v-if="step === 1" key="step1" class="trial-wizard__step">
          <div class="trial-wizard__card trial-wizard__hero">
            <div class="trial-hero__badge">
              <i class="bi-gift me-1"></i> Oferta exclusiva
            </div>

            <div class="trial-hero__icon-ring">
              <i class="bi-rocket-takeoff"></i>
            </div>

            <h1 class="trial-hero__title">
              Desbloqueie todo o potencial<br>
              <span class="trial-hero__highlight">do seu negócio</span>
            </h1>

            <p class="trial-hero__subtitle">
              Experimente <strong>{{ trialDays }} dias grátis</strong> do plano
              <strong>{{ trialPlanName }}</strong> e descubra como vender mais
              com menos esforço.
            </p>

            <div class="trial-hero__guarantee">
              <i class="bi-shield-check me-2"></i>
              Sem compromisso. Cancela a qualquer momento.
            </div>

            <button class="btn btn-lg trial-wizard__btn-primary w-100" @click="nextStep">
              Quero conhecer os benefícios
              <i class="bi-arrow-right ms-2"></i>
            </button>

            <button class="btn btn-link text-muted mt-2" @click="router.push('/orders')">
              Agora não, obrigado
            </button>
          </div>
        </div>
      </transition>

      <!-- Step 2: Recursos Inclusos -->
      <transition name="wizard-slide" mode="out-in">
        <div v-if="step === 2" key="step2" class="trial-wizard__step">
          <div class="trial-wizard__card">
            <button class="btn btn-link trial-wizard__back" @click="prevStep">
              <i class="bi-arrow-left me-1"></i> Voltar
            </button>

            <div class="text-center mb-4">
              <h2 class="trial-features__title">
                Tudo isso por <span class="trial-hero__highlight">{{ trialDays }} dias grátis</span>
              </h2>
              <p class="text-muted">
                Acesse ferramentas profissionais que vão transformar a gestão do seu delivery.
              </p>
            </div>

            <div class="trial-features__grid">
              <div v-for="(feat, i) in trialFeatures" :key="i" class="trial-feature-card">
                <div class="trial-feature-card__icon">
                  <i :class="['bi', feat.icon]"></i>
                </div>
                <div class="trial-feature-card__body">
                  <h6 class="trial-feature-card__title">{{ feat.title }}</h6>
                  <p class="trial-feature-card__desc">{{ feat.desc }}</p>
                </div>
              </div>
            </div>

            <div class="trial-features__social-proof">
              <i class="bi-star-fill text-warning me-1"></i>
              <span>Mais de <strong>500 empresas</strong> já usam essas ferramentas para crescer</span>
            </div>

            <button class="btn btn-lg trial-wizard__btn-primary w-100 mt-3" @click="nextStep">
              Ativar meu período grátis
              <i class="bi-arrow-right ms-2"></i>
            </button>
          </div>
        </div>
      </transition>

      <!-- Step 3: Parabéns / Ativação -->
      <transition name="wizard-slide" mode="out-in">
        <div v-if="step === 3" key="step3" class="trial-wizard__step">
          <div class="trial-wizard__card text-center">

            <!-- Before activation -->
            <template v-if="!activated">
              <button class="btn btn-link trial-wizard__back" @click="prevStep">
                <i class="bi-arrow-left me-1"></i> Voltar
              </button>

              <div class="trial-activate__icon">
                <i class="bi-trophy"></i>
              </div>

              <h2 class="trial-activate__title">Tudo pronto!</h2>
              <p class="trial-activate__desc">
                Você está a um clique de desbloquear <strong>{{ trialDays }} dias grátis</strong>
                do plano <strong>{{ trialPlanName }}</strong>.
              </p>

              <div class="trial-activate__summary">
                <div class="trial-activate__summary-row">
                  <span>Plano</span>
                  <strong>{{ trialPlanName }}</strong>
                </div>
                <div class="trial-activate__summary-row">
                  <span>Período</span>
                  <strong>{{ trialDays }} dias grátis</strong>
                </div>
                <div class="trial-activate__summary-row">
                  <span>Cobrança</span>
                  <strong class="text-success">R$ 0,00</strong>
                </div>
              </div>

              <button
                class="btn btn-lg trial-wizard__btn-success w-100 mt-4"
                :disabled="activating"
                @click="activateTrial"
              >
                <span v-if="activating">
                  <span class="spinner-border spinner-border-sm me-2"></span>
                  Ativando...
                </span>
                <span v-else>
                  <i class="bi-rocket-takeoff me-2"></i>
                  Ativar plano profissional
                </span>
              </button>

              <small class="d-block text-muted mt-3">
                Após o período de teste, você retorna ao plano atual automaticamente.
              </small>
            </template>

            <!-- After activation -->
            <template v-else>
              <div class="trial-success__confetti">
                <i class="bi-emoji-laughing"></i>
              </div>

              <h2 class="trial-success__title">Parabéns! 🎉</h2>
              <p class="trial-success__desc">
                Seu plano <strong>{{ trialPlanName }}</strong> foi ativado com sucesso!<br>
                Aproveite <strong>{{ trialDays }} dias</strong> de acesso completo.
              </p>

              <div class="trial-success__tips">
                <h6 class="mb-3">Comece agora:</h6>
                <div class="trial-success__tip">
                  <i class="bi-1-circle text-primary me-2"></i>
                  <span>Configure seu cardápio completo</span>
                </div>
                <div class="trial-success__tip">
                  <i class="bi-2-circle text-primary me-2"></i>
                  <span>Cadastre seus entregadores</span>
                </div>
                <div class="trial-success__tip">
                  <i class="bi-3-circle text-primary me-2"></i>
                  <span>Receba pedidos e acompanhe os resultados</span>
                </div>
              </div>

              <button class="btn btn-lg trial-wizard__btn-primary w-100 mt-4" @click="goToApp">
                Começar a usar agora
                <i class="bi-arrow-right ms-2"></i>
              </button>
            </template>
          </div>
        </div>
      </transition>
    </div>
  </div>
</template>

<style scoped>
.trial-wizard {
  min-height: 100vh;
  background: linear-gradient(160deg, var(--bg-app) 0%, #d4f5d0 50%, #e8f8e6 100%);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 1rem;
}

.trial-test-banner {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 9999;
  background: #ffc107;
  color: #212529;
  text-align: center;
  padding: 0.5rem 1rem;
  font-weight: 600;
  font-size: 0.8rem;
  letter-spacing: 0.05em;
}

.trial-wizard__loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 50vh;
}

.trial-wizard__error {
  width: 100%;
  max-width: 480px;
}

.trial-wizard__container {
  width: 100%;
  max-width: 520px;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.trial-wizard__progress {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1.5rem;
}

.trial-wizard__dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.12);
  transition: all 0.3s ease;
}

.trial-wizard__dot--active {
  background: var(--primary);
  transform: scale(1.3);
}

.trial-wizard__dot--done {
  background: var(--success);
}

.trial-wizard__step {
  width: 100%;
}

.trial-wizard__card {
  background: var(--bg-card);
  border-radius: var(--border-radius);
  box-shadow: var(--shadow-dropdown);
  padding: 2rem 1.5rem;
  position: relative;
}

.trial-wizard__back {
  position: absolute;
  top: 1rem;
  left: 1rem;
  color: var(--text-secondary);
  font-size: 0.85rem;
  text-decoration: none;
  padding: 0;
}

.trial-wizard__back:hover {
  color: var(--primary);
}

/* Hero Step */
.trial-wizard__hero {
  text-align: center;
}

.trial-hero__badge {
  display: inline-block;
  background: linear-gradient(135deg, var(--success), var(--success-dark));
  color: #fff;
  font-size: 0.75rem;
  font-weight: 600;
  padding: 0.35rem 1rem;
  border-radius: var(--border-radius-pill);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 1.5rem;
}

.trial-hero__icon-ring {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--primary), var(--primary-light));
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 1.5rem;
  font-size: 2rem;
  color: #fff;
  box-shadow: 0 8px 24px rgba(16, 87, 132, 0.25);
}

.trial-hero__title {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1.3;
  margin-bottom: 1rem;
}

.trial-hero__highlight {
  color: var(--primary);
}

.trial-hero__subtitle {
  font-size: 1rem;
  color: var(--text-secondary);
  line-height: 1.5;
  margin-bottom: 1.5rem;
}

.trial-hero__guarantee {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0;
  background: #f0faf0;
  color: var(--success-dark);
  font-size: 0.8rem;
  font-weight: 500;
  padding: 0.65rem 1rem;
  border-radius: var(--border-radius-sm);
  margin-bottom: 1.5rem;
}

/* Buttons */
.trial-wizard__btn-primary {
  background: linear-gradient(135deg, var(--primary), var(--primary-dark));
  color: #fff;
  border: none;
  border-radius: var(--border-radius-sm);
  font-weight: 600;
  font-size: 1rem;
  padding: 0.85rem 1.5rem;
  transition: all 0.2s ease;
  box-shadow: 0 4px 12px rgba(16, 87, 132, 0.3);
}

.trial-wizard__btn-primary:hover {
  background: linear-gradient(135deg, var(--primary-dark), var(--primary));
  transform: translateY(-1px);
  box-shadow: 0 6px 16px rgba(16, 87, 132, 0.35);
  color: #fff;
}

.trial-wizard__btn-success {
  background: linear-gradient(135deg, var(--success), var(--success-dark));
  color: #fff;
  border: none;
  border-radius: var(--border-radius-sm);
  font-weight: 600;
  font-size: 1.05rem;
  padding: 0.85rem 1.5rem;
  transition: all 0.2s ease;
  box-shadow: 0 4px 12px rgba(137, 209, 54, 0.35);
}

.trial-wizard__btn-success:hover:not(:disabled) {
  background: linear-gradient(135deg, var(--success-dark), var(--success));
  transform: translateY(-1px);
  box-shadow: 0 6px 16px rgba(137, 209, 54, 0.4);
  color: #fff;
}

.trial-wizard__btn-success:disabled {
  opacity: 0.7;
}

/* Features Step */
.trial-features__title {
  font-size: 1.3rem;
  font-weight: 700;
  color: var(--text-primary);
}

.trial-features__grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.trial-feature-card {
  display: flex;
  align-items: flex-start;
  gap: 0.85rem;
  padding: 0.85rem;
  border-radius: var(--border-radius-sm);
  background: var(--bg-input);
  transition: all 0.2s ease;
}

.trial-feature-card:hover {
  background: var(--bg-hover);
}

.trial-feature-card__icon {
  width: 40px;
  height: 40px;
  min-width: 40px;
  border-radius: 10px;
  background: linear-gradient(135deg, rgba(16, 87, 132, 0.1), rgba(16, 87, 132, 0.05));
  color: var(--primary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.1rem;
}

.trial-feature-card__body {
  flex: 1;
}

.trial-feature-card__title {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 0.15rem;
}

.trial-feature-card__desc {
  font-size: 0.78rem;
  color: var(--text-secondary);
  margin: 0;
  line-height: 1.4;
}

.trial-features__social-proof {
  text-align: center;
  font-size: 0.8rem;
  color: var(--text-secondary);
  padding: 0.75rem;
  background: #fffbeb;
  border-radius: var(--border-radius-sm);
}

/* Activation Step */
.trial-activate__icon {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--success-light), var(--success));
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 1rem auto 1.5rem;
  font-size: 2rem;
  color: #fff;
  box-shadow: 0 8px 24px rgba(137, 209, 54, 0.3);
}

.trial-activate__title {
  font-size: 1.4rem;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 0.5rem;
}

.trial-activate__desc {
  font-size: 0.95rem;
  color: var(--text-secondary);
  line-height: 1.5;
  margin-bottom: 1.5rem;
}

.trial-activate__summary {
  background: var(--bg-input);
  border-radius: var(--border-radius-sm);
  padding: 1rem;
  text-align: left;
}

.trial-activate__summary-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.5rem 0;
  font-size: 0.9rem;
  color: var(--text-secondary);
}

.trial-activate__summary-row:not(:last-child) {
  border-bottom: 1px solid var(--border-color-soft);
}

.trial-activate__summary-row strong {
  color: var(--text-primary);
}

/* Success */
.trial-success__confetti {
  width: 90px;
  height: 90px;
  border-radius: 50%;
  background: linear-gradient(135deg, #ffd700, #ffb300);
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 1.5rem;
  font-size: 2.5rem;
  animation: trial-bounce 0.6s ease;
}

.trial-success__title {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 0.5rem;
}

.trial-success__desc {
  font-size: 0.95rem;
  color: var(--text-secondary);
  line-height: 1.5;
  margin-bottom: 1.5rem;
}

.trial-success__tips {
  text-align: left;
  background: var(--bg-input);
  border-radius: var(--border-radius-sm);
  padding: 1rem 1.25rem;
}

.trial-success__tips h6 {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-primary);
}

.trial-success__tip {
  display: flex;
  align-items: center;
  font-size: 0.85rem;
  color: var(--text-secondary);
  padding: 0.4rem 0;
}

/* Animations */
.wizard-slide-enter-active,
.wizard-slide-leave-active {
  transition: all 0.35s ease;
}

.wizard-slide-enter-from {
  opacity: 0;
  transform: translateX(30px);
}

.wizard-slide-leave-to {
  opacity: 0;
  transform: translateX(-30px);
}

@keyframes trial-bounce {
  0% { transform: scale(0.3); opacity: 0; }
  50% { transform: scale(1.1); }
  100% { transform: scale(1); opacity: 1; }
}

/* Responsive */
@media (max-width: 576px) {
  .trial-wizard {
    padding: 0.5rem;
  }

  .trial-wizard__card {
    padding: 1.5rem 1rem;
    border-radius: 1rem;
  }

  .trial-hero__title {
    font-size: 1.25rem;
  }

  .trial-hero__icon-ring,
  .trial-activate__icon {
    width: 64px;
    height: 64px;
    font-size: 1.5rem;
  }

  .trial-features__title {
    font-size: 1.1rem;
  }
}
</style>
