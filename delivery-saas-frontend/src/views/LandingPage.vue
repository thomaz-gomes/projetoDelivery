<template>
  <div class="landing">
    <!-- ========== 1. HERO ========== -->
    <section class="hero">
      <div class="container hero-grid">
        <div class="hero-text">
          <span class="badge-pill">R$ 47/ano — menos de R$ 4 por mês</span>
          <h1>Seu cardápio digital profissional em minutos</h1>
          <p class="hero-sub">
            Transforme fotos amadoras em imagens profissionais com um clique.
            Por apenas R$&nbsp;3,92/mês.
          </p>
          <button class="btn-cta-hero" @click="scrollToForm">
            Quero meu cardápio digital →
          </button>
        </div>

        <div class="hero-visual">
          <div class="phone-frame">
            <div class="phone-notch"></div>
            <div class="phone-screen">
              <div class="mock-header">Core Menu</div>
              <div class="mock-item">
                <div class="mock-img"></div>
                <div class="mock-info">
                  <div class="mock-title"></div>
                  <div class="mock-price"></div>
                </div>
              </div>
              <div class="mock-item">
                <div class="mock-img"></div>
                <div class="mock-info">
                  <div class="mock-title"></div>
                  <div class="mock-price"></div>
                </div>
              </div>
              <div class="mock-item">
                <div class="mock-img"></div>
                <div class="mock-info">
                  <div class="mock-title"></div>
                  <div class="mock-price"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- ========== 2. PROBLEMA / DOR ========== -->
    <section class="problems">
      <div class="container">
        <h2 class="section-title">Você ainda usa cardápio de papel ou PDF no WhatsApp?</h2>
        <div class="cards-row">
          <div class="problem-card">
            <span class="card-icon">📸</span>
            <h3>Fotos ruins afastam clientes</h3>
            <p>Seus pratos merecem fotos que dão água na boca, não imagens escuras e desfocadas.</p>
          </div>
          <div class="problem-card">
            <span class="card-icon">💸</span>
            <h3>Atualizar preços é um pesadelo</h3>
            <p>Cada mudança de preço significa reimprimir tudo ou editar PDFs manualmente.</p>
          </div>
          <div class="problem-card">
            <span class="card-icon">📱</span>
            <h3>Clientes pedem cardápio e você manda PDF</h3>
            <p>PDFs são pesados, difíceis de navegar e não funcionam bem no celular.</p>
          </div>
        </div>
      </div>
    </section>

    <!-- ========== 3. COMO FUNCIONA ========== -->
    <section class="how-it-works">
      <div class="container">
        <h2 class="section-title">Como funciona</h2>
        <div class="steps">
          <div class="step">
            <div class="step-number">1</div>
            <div class="step-content">
              <h3>Tire uma foto do seu cardápio físico</h3>
              <p>Nossa IA lê e cria seu cardápio digital automaticamente. Sem digitação.</p>
            </div>
          </div>
          <div class="step">
            <div class="step-number">2</div>
            <div class="step-content">
              <h3>
                Otimize suas fotos com um clique
                <span class="ai-badge">IA</span>
              </h3>
              <p>A inteligência artificial transforma suas fotos amadoras em imagens profissionais.</p>
            </div>
          </div>
          <div class="step">
            <div class="step-number">3</div>
            <div class="step-content">
              <h3>Compartilhe o link</h3>
              <p>Seu catálogo digital fica pronto para compartilhar no WhatsApp e redes sociais.</p>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- ========== 4. SHOWCASE / ANTES E DEPOIS ========== -->
    <section class="showcase">
      <div class="container">
        <h2 class="section-title">Veja a diferença</h2>
        <div class="compare-row">
          <div class="compare-box compare-before">
            <span class="compare-label">Antes</span>
            <div class="compare-visual before-visual">
              <span class="compare-emoji">😞</span>
              <span class="compare-text">Foto amadora</span>
            </div>
          </div>
          <div class="compare-box compare-after">
            <span class="compare-label">Depois</span>
            <div class="compare-visual after-visual">
              <span class="compare-emoji">✨</span>
              <span class="compare-text">Foto otimizada com IA</span>
            </div>
          </div>
        </div>
        <p class="compare-caption">Transformação real com inteligência artificial</p>
      </div>
    </section>

    <!-- ========== 5. PREÇO + FORMULÁRIO (id="pricing") ========== -->
    <section id="pricing" class="pricing">
      <div class="container pricing-grid">
        <div class="pricing-card">
          <span class="pricing-badge">Mais Popular</span>
          <div class="pricing-amount">
            <span class="pricing-currency">R$</span>
            <span class="pricing-value">47</span>
            <span class="pricing-period">/ano</span>
          </div>
          <p class="pricing-subtitle">Menos de R$ 4 por mês</p>
          <ul class="pricing-features">
            <li><span class="check">✓</span> Catálogo digital ilimitado</li>
            <li><span class="check">✓</span> Otimizador de fotos com IA</li>
            <li><span class="check">✓</span> Link personalizado para compartilhar</li>
            <li><span class="check">✓</span> Suporte via WhatsApp</li>
            <li><span class="check">✓</span> Atualizações incluídas</li>
          </ul>
        </div>

        <div class="lead-form-wrapper">
          <h3 class="form-title">Comece agora</h3>
          <form class="lead-form" @submit.prevent="submitLead">
            <div class="form-group">
              <input
                v-model="name"
                type="text"
                placeholder="Seu nome completo"
                class="form-input"
                autocomplete="name"
              />
            </div>
            <div class="form-group">
              <input
                :value="phone"
                type="tel"
                placeholder="(xx) xxxxx-xxxx"
                class="form-input"
                autocomplete="tel"
                @input="onPhoneInput"
              />
            </div>
            <button type="submit" class="btn-cta" :disabled="loading">
              {{ loading ? 'Enviando...' : 'Garantir meu cardápio — R$ 47/ano' }}
            </button>
            <p v-if="error" class="form-error">{{ error }}</p>
            <p class="form-micro">🔒 Pagamento seguro via Kiwify. Acesso imediato após a confirmação.</p>
          </form>
        </div>
      </div>
    </section>

    <!-- ========== 6. UPSELL ========== -->
    <section class="upsell">
      <div class="container">
        <h2 class="section-title">Quer ir além? Conheça o plano Completo</h2>
        <p class="section-sub">Para quem precisa de gestão completa de pedidos</p>
        <div class="cards-row">
          <div class="upsell-card">
            <h3>Gestor de Pedidos</h3>
            <p>Receba e gerencie pedidos online em tempo real com painel completo.</p>
          </div>
          <div class="upsell-card">
            <h3>Integração com iFood</h3>
            <p>Sincronize seu cardápio e receba pedidos do iFood direto no sistema.</p>
          </div>
          <div class="upsell-card">
            <h3>Painel de Controle</h3>
            <p>Relatórios, clientes, entregadores e muito mais em um só lugar.</p>
          </div>
        </div>
        <a href="#" class="upsell-link">Fale conosco pelo WhatsApp →</a>
      </div>
    </section>

    <!-- ========== 7. FAQ ========== -->
    <section class="faq">
      <div class="container">
        <h2 class="section-title">Perguntas Frequentes</h2>
        <div class="faq-list">
          <details class="faq-item">
            <summary>Preciso de computador para usar?</summary>
            <p>Não! O Core funciona 100% no celular. Você gerencia tudo pelo navegador do seu smartphone.</p>
          </details>
          <details class="faq-item">
            <summary>Como funciona a otimização de fotos com IA?</summary>
            <p>Basta enviar a foto do prato. Nossa inteligência artificial melhora iluminação, cores e enquadramento automaticamente.</p>
          </details>
          <details class="faq-item">
            <summary>Posso cancelar a qualquer momento?</summary>
            <p>Sim. Não há fidelidade. Se não gostar, basta não renovar.</p>
          </details>
          <details class="faq-item">
            <summary>Quanto tempo leva para criar o cardápio?</summary>
            <p>Com a importação por foto, menos de 5 minutos. É só tirar uma foto do cardápio físico e a IA faz o resto.</p>
          </details>
          <details class="faq-item">
            <summary>Preciso saber mexer em tecnologia?</summary>
            <p>Não. O Core foi feito para ser simples. Se você sabe usar WhatsApp, sabe usar o Core.</p>
          </details>
        </div>
      </div>
    </section>

    <!-- ========== 8. FOOTER ========== -->
    <footer class="footer">
      <div class="container footer-inner">
        <div class="footer-brand">
          <strong>Core Delivery</strong>
          <span>Cardápio digital inteligente para seu negócio</span>
        </div>
        <div class="footer-copy">
          © 2026 Core Delivery. Todos os direitos reservados.
        </div>
      </div>
    </footer>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import api from '../api'

const name = ref('')
const phone = ref('')
const loading = ref(false)
const error = ref('')

function formatPhone(value) {
  const digits = value.replace(/\D/g, '').slice(0, 11)
  if (digits.length <= 2) return `(${digits}`
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
}

function onPhoneInput(e) {
  phone.value = formatPhone(e.target.value)
}

async function submitLead() {
  error.value = ''
  if (!name.value.trim()) { error.value = 'Preencha seu nome'; return }
  const digits = phone.value.replace(/\D/g, '')
  if (digits.length < 10) { error.value = 'WhatsApp inválido'; return }
  loading.value = true
  try {
    await api.post('/public/leads', { name: name.value.trim(), phone: digits })
    window.location.href = 'https://pay.kiwify.com.br/YmuEZ57'
  } catch {
    error.value = 'Erro ao enviar. Tente novamente.'
  } finally {
    loading.value = false
  }
}

function scrollToForm() {
  document.getElementById('pricing')?.scrollIntoView({ behavior: 'smooth' })
}
</script>

<style scoped>
/* ===== RESET & BASE ===== */
*,
*::before,
*::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

.landing {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  color: #212529;
  line-height: 1.6;
  overflow-x: hidden;
  -webkit-font-smoothing: antialiased;
}

.container {
  max-width: 1140px;
  margin: 0 auto;
  padding: 0 1.25rem;
}

.section-title {
  font-size: 1.75rem;
  font-weight: 800;
  text-align: center;
  margin-bottom: 0.75rem;
  letter-spacing: -0.02em;
}

.section-sub {
  text-align: center;
  color: #6C757D;
  font-size: 1.05rem;
  margin-bottom: 2.5rem;
}

/* ===== 1. HERO ===== */
.hero {
  background: linear-gradient(135deg, #8cbe1f 0%, #89d136 60%, #8cbe1f 100%);
  color: #fff;
  padding: 3.5rem 0 4rem;
  position: relative;
  overflow: hidden;
}

.hero::after {
  content: '';
  position: absolute;
  bottom: -2px;
  left: 0;
  right: 0;
  height: 60px;
  background: #fff;
  clip-path: ellipse(55% 100% at 50% 100%);
}

.hero-grid {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2.5rem;
}

.hero-text {
  text-align: center;
}

.badge-pill {
  display: inline-block;
  background: rgba(255, 255, 255, 0.15);
  backdrop-filter: blur(6px);
  color: #fff;
  font-size: 0.85rem;
  font-weight: 600;
  padding: 0.4rem 1.1rem;
  border-radius: 2rem;
  margin-bottom: 1.25rem;
  border: 1px solid rgba(255, 255, 255, 0.25);
}

.hero h1 {
  font-size: 2rem;
  font-weight: 800;
  line-height: 1.15;
  letter-spacing: -0.03em;
  margin-bottom: 1rem;
}

.hero-sub {
  font-size: 1.1rem;
  opacity: 0.9;
  max-width: 480px;
  margin: 0 auto 1.75rem;
  line-height: 1.5;
}

.btn-cta-hero {
  display: inline-block;
  background: #fff;
  color: #4a7a0a;
  font-size: 1.05rem;
  font-weight: 700;
  padding: 0.9rem 2rem;
  border: none;
  border-radius: 0.625rem;
  cursor: pointer;
  transition: transform 0.2s, box-shadow 0.2s;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.15);
  font-family: inherit;
}

.btn-cta-hero:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.2);
}

/* Phone mockup */
.hero-visual {
  display: flex;
  justify-content: center;
}

.phone-frame {
  width: 220px;
  height: 420px;
  background: #3d6b0a;
  border-radius: 2rem;
  padding: 0.75rem;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.3);
  position: relative;
}

.phone-notch {
  width: 80px;
  height: 20px;
  background: #3d6b0a;
  border-radius: 0 0 0.75rem 0.75rem;
  margin: 0 auto;
  position: absolute;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  z-index: 2;
}

.phone-screen {
  background: #fff;
  border-radius: 1.35rem;
  height: 100%;
  padding: 2rem 0.75rem 0.75rem;
  overflow: hidden;
}

.mock-header {
  text-align: center;
  font-size: 0.85rem;
  font-weight: 700;
  color: #4a7a0a;
  margin-bottom: 0.75rem;
  padding-bottom: 0.5rem;
  border-bottom: 2px solid #EEFFED;
}

.mock-item {
  display: flex;
  gap: 0.6rem;
  align-items: center;
  padding: 0.55rem 0;
  border-bottom: 1px solid #E6E6E6;
}

.mock-img {
  width: 48px;
  height: 48px;
  border-radius: 0.5rem;
  background: linear-gradient(135deg, #89D136 0%, #6DAE1E 100%);
  flex-shrink: 0;
  opacity: 0.7;
}

.mock-info {
  flex: 1;
}

.mock-title {
  height: 10px;
  width: 80%;
  background: #E6E6E6;
  border-radius: 4px;
  margin-bottom: 6px;
}

.mock-price {
  height: 8px;
  width: 40%;
  background: #89D136;
  border-radius: 4px;
  opacity: 0.6;
}

/* ===== 2. PROBLEMS ===== */
.problems {
  background: #fff;
  padding: 4rem 0;
}

.problems .section-title {
  margin-bottom: 2.5rem;
}

.cards-row {
  display: grid;
  grid-template-columns: 1fr;
  gap: 1.25rem;
}

.problem-card {
  background: #F8F9FA;
  border: 1px solid #E6E6E6;
  border-radius: 1rem;
  padding: 1.75rem;
  text-align: center;
  transition: transform 0.2s, box-shadow 0.2s;
}

.problem-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08);
}

.card-icon {
  font-size: 2.25rem;
  display: block;
  margin-bottom: 0.75rem;
}

.problem-card h3 {
  font-size: 1.1rem;
  font-weight: 700;
  margin-bottom: 0.5rem;
  color: #212529;
}

.problem-card p {
  font-size: 0.95rem;
  color: #6C757D;
  line-height: 1.5;
}

/* ===== 3. HOW IT WORKS ===== */
.how-it-works {
  background: #F8F9FA;
  padding: 4rem 0;
}

.how-it-works .section-title {
  margin-bottom: 2.5rem;
}

.steps {
  display: flex;
  flex-direction: column;
  gap: 2rem;
  max-width: 640px;
  margin: 0 auto;
}

.step {
  display: flex;
  gap: 1.25rem;
  align-items: flex-start;
}

.step-number {
  width: 48px;
  height: 48px;
  min-width: 48px;
  background: #89d136;
  color: #fff;
  font-size: 1.25rem;
  font-weight: 800;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
}

.step-content h3 {
  font-size: 1.1rem;
  font-weight: 700;
  margin-bottom: 0.25rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.step-content p {
  color: #6C757D;
  font-size: 0.95rem;
}

.ai-badge {
  display: inline-block;
  background: #7C3AED;
  color: #fff;
  font-size: 0.7rem;
  font-weight: 700;
  padding: 0.15rem 0.5rem;
  border-radius: 2rem;
  letter-spacing: 0.04em;
  vertical-align: middle;
}

/* ===== 4. SHOWCASE ===== */
.showcase {
  background: #fff;
  padding: 4rem 0;
}

.showcase .section-title {
  margin-bottom: 2.5rem;
}

.compare-row {
  display: grid;
  grid-template-columns: 1fr;
  gap: 1.25rem;
  max-width: 720px;
  margin: 0 auto;
}

.compare-box {
  border-radius: 1rem;
  overflow: hidden;
}

.compare-label {
  display: block;
  text-align: center;
  font-weight: 700;
  font-size: 0.95rem;
  padding: 0.6rem 0;
}

.compare-before .compare-label {
  background: #E6E6E6;
  color: #6C757D;
}

.compare-after .compare-label {
  background: #7C3AED;
  color: #fff;
}

.compare-visual {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 180px;
  gap: 0.75rem;
}

.before-visual {
  background: #E9ECEF;
  filter: blur(0.5px) grayscale(0.3);
}

.after-visual {
  background: linear-gradient(135deg, #EEFFED 0%, #d4f5c4 100%);
  border: 2px solid #7C3AED;
  border-top: none;
  border-radius: 0 0 1rem 1rem;
}

.compare-emoji {
  font-size: 2.5rem;
}

.compare-text {
  font-size: 0.95rem;
  font-weight: 600;
  color: #6C757D;
}

.compare-after .compare-text {
  color: #7C3AED;
}

.compare-caption {
  text-align: center;
  color: #6C757D;
  font-size: 0.9rem;
  margin-top: 1.5rem;
  font-style: italic;
}

/* ===== 5. PRICING ===== */
.pricing {
  background: #F8F9FA;
  padding: 4rem 0;
}

.pricing-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 2rem;
  max-width: 820px;
  margin: 0 auto;
}

.pricing-card {
  background: #fff;
  border: 2px solid #89d136;
  border-radius: 1rem;
  padding: 2rem 1.75rem;
  text-align: center;
  position: relative;
  box-shadow: 0 4px 16px rgba(137, 209, 54, 0.15);
}

.pricing-badge {
  position: absolute;
  top: -0.75rem;
  left: 50%;
  transform: translateX(-50%);
  background: #89d136;
  color: #fff;
  font-size: 0.8rem;
  font-weight: 700;
  padding: 0.3rem 1rem;
  border-radius: 2rem;
  white-space: nowrap;
}

.pricing-amount {
  margin: 1.5rem 0 0.25rem;
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 0.15rem;
}

.pricing-currency {
  font-size: 1.5rem;
  font-weight: 700;
  color: #4a7a0a;
}

.pricing-value {
  font-size: 3.5rem;
  font-weight: 800;
  color: #4a7a0a;
  line-height: 1;
}

.pricing-period {
  font-size: 1.1rem;
  color: #6C757D;
  font-weight: 500;
}

.pricing-subtitle {
  color: #6C757D;
  font-size: 1rem;
  margin-bottom: 1.5rem;
}

.pricing-features {
  list-style: none;
  text-align: left;
  padding: 0;
}

.pricing-features li {
  padding: 0.45rem 0;
  font-size: 0.95rem;
  color: #212529;
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

.check {
  color: #89D136;
  font-weight: 700;
  font-size: 1.1rem;
}

/* Lead form */
.lead-form-wrapper {
  background: #fff;
  border-radius: 1rem;
  padding: 2rem 1.75rem;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
  border: 1px solid #E6E6E6;
}

.form-title {
  font-size: 1.35rem;
  font-weight: 800;
  text-align: center;
  margin-bottom: 1.5rem;
  color: #212529;
}

.lead-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.form-group {
  display: flex;
  flex-direction: column;
}

.form-input {
  width: 100%;
  padding: 0.85rem 1rem;
  border: 1.5px solid #E6E6E6;
  border-radius: 0.625rem;
  font-size: 1rem;
  font-family: inherit;
  color: #212529;
  transition: border-color 0.2s, box-shadow 0.2s;
  outline: none;
}

.form-input::placeholder {
  color: #adb5bd;
}

.form-input:focus {
  border-color: #89d136;
  box-shadow: 0 0 0 3px rgba(137, 209, 54, 0.15);
}

.btn-cta {
  width: 100%;
  background: #89D136;
  color: #fff;
  font-size: 1.05rem;
  font-weight: 700;
  padding: 0.95rem 1.5rem;
  border: none;
  border-radius: 0.625rem;
  cursor: pointer;
  transition: background 0.2s, transform 0.2s, box-shadow 0.2s;
  box-shadow: 0 4px 14px rgba(137, 209, 54, 0.3);
  font-family: inherit;
}

.btn-cta:hover:not(:disabled) {
  background: #6DAE1E;
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(109, 174, 30, 0.35);
}

.btn-cta:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.form-error {
  color: #dc3545;
  font-size: 0.9rem;
  text-align: center;
  font-weight: 500;
}

.form-micro {
  text-align: center;
  font-size: 0.82rem;
  color: #6C757D;
  line-height: 1.4;
}

/* ===== 6. UPSELL ===== */
.upsell {
  background: #fff;
  padding: 4rem 0;
}

.upsell .section-title {
  margin-bottom: 0.5rem;
}

.upsell .section-sub {
  margin-bottom: 2.5rem;
}

.upsell-card {
  background: #F8F9FA;
  border: 1px solid #E6E6E6;
  border-radius: 1rem;
  padding: 1.75rem;
  text-align: center;
  transition: transform 0.2s, box-shadow 0.2s;
}

.upsell-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08);
}

.upsell-card h3 {
  font-size: 1.1rem;
  font-weight: 700;
  margin-bottom: 0.5rem;
  color: #4a7a0a;
}

.upsell-card p {
  font-size: 0.95rem;
  color: #6C757D;
  line-height: 1.5;
}

.upsell-link {
  display: block;
  text-align: center;
  margin-top: 2rem;
  color: #89D136;
  font-weight: 700;
  font-size: 1.05rem;
  text-decoration: none;
  transition: color 0.2s;
}

.upsell-link:hover {
  color: #6DAE1E;
}

/* ===== 7. FAQ ===== */
.faq {
  background: #F8F9FA;
  padding: 4rem 0;
}

.faq .section-title {
  margin-bottom: 2.5rem;
}

.faq-list {
  max-width: 720px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.faq-item {
  background: #fff;
  border: 1px solid #E6E6E6;
  border-radius: 0.75rem;
  overflow: hidden;
  transition: box-shadow 0.2s;
}

.faq-item:hover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.faq-item summary {
  padding: 1.1rem 1.25rem;
  font-weight: 700;
  font-size: 1rem;
  cursor: pointer;
  list-style: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  color: #212529;
  user-select: none;
}

.faq-item summary::-webkit-details-marker {
  display: none;
}

.faq-item summary::after {
  content: '+';
  font-size: 1.4rem;
  font-weight: 300;
  color: #89d136;
  transition: transform 0.2s;
  flex-shrink: 0;
}

.faq-item[open] summary::after {
  content: '\2212';
}

.faq-item p {
  padding: 0 1.25rem 1.1rem;
  color: #6C757D;
  font-size: 0.95rem;
  line-height: 1.6;
}

/* ===== 8. FOOTER ===== */
.footer {
  background: linear-gradient(135deg, #3d6b0a 0%, #4a7a0a 100%);
  color: #fff;
  padding: 2rem 0;
}

.footer-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 1rem;
}

.footer-brand {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.footer-brand strong {
  font-size: 1.15rem;
}

.footer-brand span {
  font-size: 0.9rem;
  opacity: 0.8;
}

.footer-copy {
  font-size: 0.85rem;
  opacity: 0.7;
}

/* ===== RESPONSIVE: TABLET (768px) ===== */
@media (min-width: 768px) {
  .section-title {
    font-size: 2rem;
  }

  .hero {
    padding: 4.5rem 0 5rem;
  }

  .hero h1 {
    font-size: 2.5rem;
  }

  .hero-sub {
    font-size: 1.15rem;
  }

  .cards-row {
    grid-template-columns: repeat(3, 1fr);
    gap: 1.5rem;
  }

  .compare-row {
    grid-template-columns: 1fr 1fr;
    gap: 1.5rem;
  }

  .pricing-grid {
    grid-template-columns: 1fr 1fr;
    align-items: start;
  }

  .footer-inner {
    flex-direction: row;
    justify-content: space-between;
    text-align: left;
  }
}

/* ===== RESPONSIVE: DESKTOP (1024px) ===== */
@media (min-width: 1024px) {
  .section-title {
    font-size: 2.25rem;
  }

  .hero {
    padding: 5rem 0 5.5rem;
  }

  .hero-grid {
    flex-direction: row;
    justify-content: space-between;
    gap: 3rem;
  }

  .hero-text {
    text-align: left;
    flex: 1;
  }

  .hero h1 {
    font-size: 2.85rem;
  }

  .hero-sub {
    margin: 0 0 2rem;
    font-size: 1.2rem;
  }

  .phone-frame {
    width: 260px;
    height: 500px;
  }

  .compare-visual {
    height: 220px;
  }

  .steps {
    max-width: 700px;
  }
}
</style>
