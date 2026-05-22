<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import api from '../api'

// ─── Brand tokens (mirrors chefiz-shared.jsx) ───────────────────────────────
// Exposed for inline-style usage in the few spots where CSS-vars are awkward.
const C = {
  green: '#89D136',
  greenDark: '#6DAE1E',
  greenSoft: '#EAF7D6',
  greenInk: '#3D6313',
  ink: '#1F1F1F',
  graphite: '#3F3F3F',
  slate: '#5B5B5B',
  mute: '#8A8A8A',
  hairline: '#E7E6E2',
  paper: '#FAFAF7',
  paperWarm: '#F4F2EC',
  white: '#FFFFFF',
}

// ─── Plans (mirrors chefiz-shared.jsx PLANS) ────────────────────────────────
const PLANS = [
  {
    key: 'BASICO',
    name: 'Básico',
    tagline: 'Para começar a vender no WhatsApp.',
    monthly: 110,
    yearly: 990,
    modules: ['CARDAPIO_COMPLETO', 'WHATSAPP', 'STUDIO_IA', 'COUPONS', 'CUSTOM_DOMAIN'],
    bestFor: 'restaurantes pequenos e dark kitchens',
  },
  {
    key: 'PRO',
    name: 'Pro',
    tagline: 'Tudo do Básico + entregadores, cashback e afiliados.',
    monthly: 200,
    yearly: 1800,
    modules: ['CARDAPIO_COMPLETO', 'WHATSAPP', 'STUDIO_IA', 'COUPONS', 'CUSTOM_DOMAIN', 'RIDERS', 'CASHBACK', 'AFFILIATES'],
    bestFor: 'restaurantes com entregadores próprios',
    recommended: true,
  },
  {
    key: 'PREMIUM',
    name: 'Premium',
    tagline: 'Tudo do Pro + NFC-e e controle de estoque.',
    monthly: 350,
    yearly: 3150,
    modules: ['CARDAPIO_COMPLETO', 'WHATSAPP', 'STUDIO_IA', 'COUPONS', 'CUSTOM_DOMAIN', 'RIDERS', 'CASHBACK', 'AFFILIATES', 'FISCAL', 'STOCK'],
    bestFor: 'operações com NFC-e e estoque',
  },
]

const MODULE_LABELS = {
  CARDAPIO_SIMPLES: 'Cardápio digital',
  CARDAPIO_COMPLETO: 'Gestor de pedidos',
  WHATSAPP: 'Atendimento no WhatsApp',
  STUDIO_IA: 'Studio IA · fotos',
  COUPONS: 'Cupons de desconto',
  CUSTOM_DOMAIN: 'Domínio próprio',
  RIDERS: 'App do motoboy',
  CASHBACK: 'Cashback',
  AFFILIATES: 'Programa de afiliados',
  FISCAL: 'NFC-e / NF-e',
  STOCK: 'Controle de estoque',
}

// Optional plan-specific Kiwify URLs (env-driven). Fallback to single legacy URL.
const KIWIFY_URLS = {
  BASICO: import.meta.env.VITE_KIWIFY_BASICO || 'https://pay.kiwify.com.br/YmuEZ57',
  PRO: import.meta.env.VITE_KIWIFY_PRO || 'https://pay.kiwify.com.br/YmuEZ57',
  PREMIUM: import.meta.env.VITE_KIWIFY_PREMIUM || 'https://pay.kiwify.com.br/YmuEZ57',
}

// ─── State ──────────────────────────────────────────────────────────────────
const period = ref('MONTHLY')
const selectedPlan = ref(null)
const name = ref('')
const phone = ref('')
const error = ref('')
const ok = ref(false)
const loading = ref(false)
const studioTab = ref('plate')
const openFaq = ref(0)
const pricingRef = ref(null)
const formRef = ref(null)
const featuresRef = ref(null)
const faqRef = ref(null)

// ─── Static content ─────────────────────────────────────────────────────────
const PROBLEM_CARDS = [
  { icon: 'pen', t: 'Cardápio sempre desatualizado.', s: 'Preço muda na cozinha, mas o que o cliente vê é do mês passado. "Tem esse prato hoje?" virou rotina.' },
  { icon: 'alert', t: 'Foto de celular não vende.', s: 'Você sabe que o sabor é ótimo, mas a foto torta com luz amarela na bancada só espanta cliente novo.' },
  { icon: 'clock', t: 'Você responde a mesma coisa o dia todo.', s: '"Qual o link do cardápio?", "tá aberto?", "entrega no bairro X?". 80% das mensagens — sempre iguais.' },
]

const FEATURES = [
  { k: 'CARDAPIO_COMPLETO', t: 'Gestor de cardápio', s: 'Adiciona prato, mexe preço, pausa item esgotado — 30 segundos no celular ou no notebook. Mudou aqui, mudou no cliente.', img: 'green' },
  { k: 'STUDIO_IA', t: 'Studio IA · fotos', s: 'Sobe foto do celular. Sai com luz, fundo limpo e cara de profissional — sem inventar ingredientes, sem cara de IA.', img: 'green' },
  { k: 'CUSTOM_DOMAIN', t: 'Domínio próprio', s: 'pedido.seurestaurante.com.br — seu link, seu branding. Sem propaganda de iFood, sem comissão.', img: 'warm' },
  { k: 'WHATSAPP', t: 'Atendente automático (simples)', s: 'Responde as perguntas repetidas: link do cardápio, horário, bairros que entrega. Não tira pedido — manda o cliente pro cardápio.', img: 'warm' },
  { k: 'COUPONS', t: 'Cupons de desconto', s: 'Cria cupom em 10 segundos. Manda no broadcast e mede quanto vendeu.', img: 'green' },
  { k: 'CARDAPIO_SIMPLES', t: 'Importação do seu cardápio', s: 'Manda o link do seu iFood, Anota AI ou Goomer. Nossa equipe importa em 24h — você só revisa.', img: 'warm' },
]

const STUDIO_TABS = [
  { k: 'plate', label: 'Foto do prato', sub: 'amadora → profissional' },
  { k: 'social', label: 'Post pra rede social', sub: 'a partir de uma foto' },
  { k: 'menu', label: 'Capa de cardápio', sub: 'estilo do seu restaurante' },
]

const STUDIO_COPY = {
  plate: {
    before: 'foto amadora · celular',
    after: 'mesma foto · iluminada, sem cara de IA',
    caption: 'Suba a foto que você tirou no celular. O Studio devolve a mesma comida, sem trocar ingredientes, com luz e fundo profissionais.',
  },
  social: {
    before: 'foto do prato',
    after: 'post 1080×1080 pronto',
    caption: 'Diz pra qual rede e o Studio gera carrossel, story e feed com a foto do prato, preço e botão pra pedir no WhatsApp.',
  },
  menu: {
    before: 'cardápio cru',
    after: 'capa estilizada',
    caption: 'Definição do estilo da marca: cores, tipografia e tom. Capa do cardápio impressa e digital saindo da mesma base.',
  },
}

const TESTIMONIALS = [
  { q: 'Mexer no cardápio era um terror. Agora eu mudo preço de pizza no ônibus, no caminho da padaria.', a: 'Léo · Forno do Léo · Belo Horizonte', tag: 'Pizzaria · 80 pedidos/dia' },
  { q: 'Botei as fotos do Studio IA no cardápio. Os pedidos do digital subiram 38% em 6 semanas.', a: 'Ana · Quintal Burgers · Curitiba', tag: 'Hamburgueria · dark kitchen' },
  { q: 'O atendente respondendo "qual o link?" sozinho me devolveu umas 2h por dia. Bobagem? Não, é vida.', a: 'Bruno · Sushi Maré · Florianópolis', tag: 'Sushi · 4 lojas' },
]

const FAQS = [
  { q: 'O atendente automático tira pedido sozinho?', a: 'Não. O atendente cuida das perguntas repetidas — link do cardápio, horário, formas de pagamento, bairros que entrega. O pedido em si o cliente faz no cardápio digital. É mais simples, dá controle pra você e o cliente nunca recebe "tomate" quando pediu "tomate seco".' },
  { q: 'Preciso ter um número novo do WhatsApp ou uso o meu?', a: 'Usamos o seu número atual. A gente conecta o atendente automático ao seu WhatsApp Business e o cliente continua falando com o mesmo número.' },
  { q: 'O que acontece se eu cancelar?', a: 'Sem fidelidade. Você cancela direto no painel — o serviço fica ativo até o fim do mês pago e a gente exporta seu cardápio e seus clientes em CSV.' },
  { q: 'O Studio IA das fotos custa à parte?', a: 'Não. Está incluso em todos os planos — Básico, Pro e Premium. Cada plano tem um limite mensal de fotos geradas (e você pode comprar pacote extra se passar).' },
  { q: 'Funciona com iFood?', a: 'Sim. Você continua no iFood se quiser — o Chefiz é o seu canal direto, sem comissão. Muitos restaurantes saem do iFood gradualmente conforme o WhatsApp deles cresce.' },
  { q: 'Posso emitir NFC-e?', a: 'Sim, no plano Premium. A gente integra com seu emissor (PlugNotas, Bling, Tiny) e emite NFC-e/NF-e automaticamente em cada pedido.' },
  { q: 'Já tenho cardápio em outro lugar — dá pra importar?', a: 'Sim. Mandamos um link do seu cardápio atual (iFood, Anota AI, Goomer, Cardapioweb) e nossa equipe importa em até 24h. Você só revisa.' },
]

const MENU_ITEMS = [
  { name: 'Margherita Especial', desc: 'molho de tomate San Marzano, mussarela de búfala, manjericão fresco', price: 'R$ 58', tone: 'green' },
  { name: 'Calabresa Artesanal', desc: 'calabresa defumada, cebola roxa, azeitona preta', price: 'R$ 62', tone: 'warm' },
  { name: 'Quatro Queijos', desc: 'mussarela, gorgonzola, parmesão, provolone', price: 'R$ 64', tone: 'green' },
]

const STATS = [
  ['1.000+', 'restaurantes ativos'],
  ['R$ 110', 'a partir de · /mês'],
  ['24h', 'setup completo'],
  ['+ 30%', 'pedidos em média, com fotos do Studio'],
]

const FOOTER_GROUPS = [
  { title: 'Produto', items: ['Funcionalidades', 'Planos', 'Studio IA', 'NFC-e'] },
  { title: 'Para quem é', items: ['Pizzarias', 'Hamburguerias', 'Açaí', 'Sushi'] },
  { title: 'Suporte', items: ['Central de ajuda', 'Falar no WhatsApp', 'Status', 'Termos · Privacidade'] },
]

// ─── Helpers ────────────────────────────────────────────────────────────────
function brl(n) {
  return Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function priceFor(plan, p) {
  const useP = p || period.value
  return useP === 'YEARLY' ? Math.round(plan.yearly / 12) : plan.monthly
}

function maskPhoneBR(value) {
  const d = (value || '').replace(/\D/g, '').slice(0, 11)
  if (d.length === 0) return ''
  if (d.length < 3) return `(${d}`
  if (d.length < 8) return `(${d.slice(0, 2)}) ${d.slice(2)}`
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
}

function phoneDigits(value) {
  return (value || '').replace(/\D/g, '')
}

function isValidBR(value) {
  const d = phoneDigits(value)
  return d.length === 10 || d.length === 11
}

function onPhoneInput(e) {
  phone.value = maskPhoneBR(e.target.value)
}

const studioCopy = computed(() => STUDIO_COPY[studioTab.value])

// ─── Navigation ─────────────────────────────────────────────────────────────
function scrollToEl(el) {
  if (!el) return
  const top = el.getBoundingClientRect().top + window.scrollY
  window.scrollTo({ top: top - 60, behavior: 'smooth' })
}
function goToPlans() { scrollToEl(pricingRef.value) }
function goToFeatures() { scrollToEl(featuresRef.value) }
function goToFaq() { scrollToEl(faqRef.value) }
function onSelectPlan(plan) {
  selectedPlan.value = plan
  error.value = ''
  ok.value = false
  nextTick(() => setTimeout(() => scrollToEl(formRef.value), 50))
}
function toggleFaq(i) {
  openFaq.value = openFaq.value === i ? -1 : i
}

// ─── Submit ─────────────────────────────────────────────────────────────────
async function onSubmit() {
  error.value = ''
  ok.value = false
  if (!selectedPlan.value) { error.value = 'Escolha um plano acima primeiro.'; return }
  if (!name.value.trim()) { error.value = 'Digite o nome do seu restaurante.'; return }
  if (!isValidBR(phone.value)) { error.value = 'WhatsApp inválido. Use DDD + 9 dígitos.'; return }
  loading.value = true
  try {
    await api.post('/public/leads', {
      name: name.value.trim(),
      phone: phoneDigits(phone.value),
      planKey: selectedPlan.value.key,
      period: period.value,
    })
    ok.value = true
    const url = KIWIFY_URLS[selectedPlan.value.key]
    if (url) window.location.href = url
  } catch (e) {
    error.value = e?.response?.data?.message || 'Não foi possível enviar agora. Tente novamente.'
    loading.value = false
  }
}

// ─── Font + title ───────────────────────────────────────────────────────────
const PREV_TITLE = typeof document !== 'undefined' ? document.title : ''
let injectedFontLink = null
onMounted(() => {
  document.title = 'Chefiz — Cardápio digital. Fotos que vendem.'
  if (!document.getElementById('chefiz-font')) {
    injectedFontLink = document.createElement('link')
    injectedFontLink.id = 'chefiz-font'
    injectedFontLink.rel = 'stylesheet'
    injectedFontLink.href = 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap'
    document.head.appendChild(injectedFontLink)
  }
})
onUnmounted(() => {
  document.title = PREV_TITLE
})
</script>

<template>
  <div class="cfz">
    <!-- ─── Sticky Header ──────────────────────────────────────────── -->
    <header class="cfz-header">
      <div class="cfz-header-inner">
        <a href="#" class="cfz-logo-link" aria-label="Chefiz">
          <svg class="cfz-logo" viewBox="0 0 380 100" height="26" xmlns="http://www.w3.org/2000/svg">
            <text x="0" y="80" font-family="'Plus Jakarta Sans', system-ui" font-weight="800" font-size="100" letter-spacing="-0.04em" fill="#fff">Chef</text>
            <g transform="translate(245,0)">
              <path d="M 0 0 L 130 0 L 110 100 L -20 100 Z" :fill="C.green" />
              <text x="14" y="80" font-family="'Plus Jakarta Sans', system-ui" font-weight="800" font-size="100" letter-spacing="-0.04em" :fill="C.ink">iz</text>
            </g>
          </svg>
        </a>
        <nav class="cfz-nav">
          <a href="#funcionalidades" @click.prevent="goToFeatures">Funcionalidades</a>
          <a href="#planos" @click.prevent="goToPlans">Planos</a>
          <a href="#perguntas" @click.prevent="goToFaq">Dúvidas</a>
        </nav>
        <div class="cfz-header-cta">
          <a href="/login" class="cfz-header-login">Entrar</a>
          <button @click="goToPlans" class="cfz-btn-pill-green">Ver planos →</button>
        </div>
      </div>
    </header>

    <!-- ─── Hero ──────────────────────────────────────────────────── -->
    <section class="cfz-hero">
      <div class="cfz-hero-inner">
        <div>
          <div class="cfz-eyebrow">Chefiz · plataforma de delivery</div>
          <h1 class="cfz-hero-title">
            Cardápio digital.<br />
            <span class="cfz-hero-italic">Fotos que vendem.</span>
          </h1>
          <p class="cfz-hero-sub">
            Monta, edita e atualiza o cardápio em minutos. As fotos saíram do seu celular — o Studio IA deixa elas com cara de cardápio caro. <strong>A partir de R$ 110/mês.</strong>
          </p>
          <div class="cfz-hero-ctas">
            <button @click="goToPlans" class="cfz-btn-pill-green cfz-btn-lg">
              Começar agora
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="12" x2="20" y2="12" /><polyline points="14 6 20 12 14 18" /></svg>
            </button>
            <button @click="goToFeatures" class="cfz-btn-pill-outline">
              Ver demo de 2 minutos
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="12" x2="20" y2="12" /><polyline points="14 6 20 12 14 18" /></svg>
            </button>
          </div>
          <div class="cfz-hero-bullets">
            <span><i class="cfz-check"></i> Setup em 1 dia</span>
            <span><i class="cfz-check"></i> Sem fidelidade</span>
            <span><i class="cfz-check"></i> Studio IA incluso</span>
          </div>
        </div>

        <!-- Phone mockup: cardápio digital -->
        <div class="cfz-hero-visual">
          <div class="cfz-hero-halo" aria-hidden></div>

          <div class="cfz-phone">
            <div class="cfz-phone-screen">
              <!-- Status bar -->
              <div class="cfz-phone-status">
                <span>19:42</span>
                <span class="cfz-phone-status-right">●●● · 📶 · 100%</span>
              </div>

              <!-- Restaurant header -->
              <div class="cfz-phone-restaurant">
                <div class="cfz-phone-restaurant-row">
                  <div>
                    <div class="cfz-phone-restaurant-name">Pizzaria do Tio</div>
                    <div class="cfz-phone-restaurant-meta">
                      <span class="cfz-phone-open">
                        <span class="cfz-phone-dot"></span> Aberto
                      </span>
                      <span>· 35-45min · R$ 8 entrega</span>
                    </div>
                  </div>
                  <div class="cfz-phone-rating">★ 4.9</div>
                </div>
                <div class="cfz-phone-chips">
                  <span
                    v-for="(c, i) in ['Pizzas', 'Massas', 'Bebidas', 'Sobremesa']"
                    :key="c"
                    class="cfz-phone-chip"
                    :class="{ active: i === 0 }"
                  >{{ c }}</span>
                </div>
              </div>

              <!-- Menu items -->
              <div class="cfz-phone-items">
                <div v-for="(it, i) in MENU_ITEMS" :key="it.name" class="cfz-phone-item">
                  <div>
                    <div class="cfz-phone-item-name">{{ it.name }}</div>
                    <div class="cfz-phone-item-desc">{{ it.desc }}</div>
                    <div class="cfz-phone-item-bottom">
                      <span class="cfz-phone-item-price">{{ it.price }}</span>
                      <span class="cfz-phone-item-add">+</span>
                    </div>
                  </div>
                  <div class="cfz-phone-item-photo" :class="`tone-${it.tone}`">
                    <div v-if="i === 0" class="cfz-phone-ia-badge">
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8L12 2z" /></svg>
                      IA
                    </div>
                  </div>
                </div>
              </div>

              <!-- Bottom bar -->
              <div class="cfz-phone-cart">
                <button class="cfz-phone-cart-btn">Ver carrinho · R$ 0,00</button>
              </div>
            </div>
          </div>

          <!-- Floating tag: Studio IA -->
          <div class="cfz-float-tag cfz-float-tag-ia">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8L12 2zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16z" /></svg>
            <div>
              <div>Studio IA</div>
              <div class="cfz-float-tag-sub">fotos otimizadas</div>
            </div>
          </div>

          <!-- Floating tag: edita em 30s -->
          <div class="cfz-float-tag cfz-float-tag-edit">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20l4-1 11-11-3-3L5 16l-1 4z" /><line x1="14" y1="6" x2="17" y2="9" /></svg>
            edita em 30s
          </div>
        </div>
      </div>

      <!-- Stats strip -->
      <div class="cfz-stats">
        <div v-for="[n, l] in STATS" :key="l">
          <div class="cfz-stats-n">{{ n }}</div>
          <div class="cfz-stats-l">{{ l }}</div>
        </div>
      </div>
    </section>

    <!-- ─── Problem cards ─────────────────────────────────────────── -->
    <section class="cfz-problems">
      <div class="cfz-container">
        <div class="cfz-problems-head">
          <h2 class="cfz-h2">
            Seu cardápio faz dinheiro — ou faz você perder tempo. <span class="cfz-h2-muted">O Chefiz resolve esses 3 buracos.</span>
          </h2>
          <p class="cfz-problems-sub">O que todo restaurante de delivery sofre antes de chegar no Chefiz.</p>
        </div>
        <div class="cfz-problems-grid">
          <div v-for="(it, i) in PROBLEM_CARDS" :key="i" class="cfz-problem-card">
            <div class="cfz-problem-icon">
              <!-- Icon switch -->
              <svg v-if="it.icon === 'pen'" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20l4-1 11-11-3-3L5 16l-1 4z" /><line x1="14" y1="6" x2="17" y2="9" /></svg>
              <svg v-else-if="it.icon === 'alert'" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l10 18H2L12 3z" /><line x1="12" y1="10" x2="12" y2="14" /><circle cx="12" cy="17.5" r=".6" fill="currentColor" stroke="none" /></svg>
              <svg v-else width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 16 14" /></svg>
            </div>
            <h3 class="cfz-problem-title">{{ it.t }}</h3>
            <p class="cfz-problem-text">{{ it.s }}</p>
          </div>
        </div>
      </div>
    </section>

    <!-- ─── Features ──────────────────────────────────────────────── -->
    <section id="funcionalidades" ref="featuresRef" class="cfz-features">
      <div class="cfz-container">
        <div class="cfz-features-head">
          <div class="cfz-eyebrow-green">Como funciona</div>
          <h2 class="cfz-h2">Tudo o que você precisa pra montar e crescer o cardápio.</h2>
        </div>
        <div class="cfz-features-grid">
          <article v-for="m in FEATURES" :key="m.k" class="cfz-feature-card">
            <div class="cfz-placeholder" :class="`tone-${m.img}`">
              <svg class="cfz-placeholder-x" preserveAspectRatio="none">
                <line x1="0" y1="0" x2="100%" y2="100%" stroke-width="1" />
                <line x1="100%" y1="0" x2="0" y2="100%" stroke-width="1" />
              </svg>
              <span class="cfz-placeholder-label">{{ MODULE_LABELS[m.k] || m.t }}</span>
            </div>
            <div class="cfz-feature-body">
              <div class="cfz-feature-kicker">
                <!-- Module icon -->
                <svg v-if="m.k === 'CARDAPIO_COMPLETO' || m.k === 'CARDAPIO_SIMPLES'" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7h14l-1.2 12.2A2 2 0 0 1 15.8 21H8.2a2 2 0 0 1-2-1.8L5 7z" /><path d="M9 7V5a3 3 0 0 1 6 0v2" /></svg>
                <svg v-else-if="m.k === 'WHATSAPP'" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15.07L2 22l5.07-1.33A10 10 0 1 0 12 2zm5.43 14.13c-.23.65-1.36 1.24-1.86 1.3-.5.06-1.1.09-1.78-.11-.4-.13-.93-.31-1.6-.6-2.8-1.21-4.62-4.03-4.76-4.22-.14-.18-1.13-1.5-1.13-2.86 0-1.37.72-2.04.97-2.32.26-.28.56-.35.74-.35.18 0 .37 0 .53.01.17.01.4-.07.62.47.23.55.78 1.91.85 2.05.07.14.12.31.02.5-.1.18-.14.3-.28.46-.14.16-.3.36-.43.49-.14.14-.29.29-.13.57.16.28.7 1.15 1.5 1.86 1.04.93 1.92 1.21 2.2 1.36.27.14.43.12.59-.07.16-.2.68-.79.86-1.06.18-.27.36-.23.6-.14.25.09 1.57.74 1.83.88.27.13.45.2.51.31.07.12.07.66-.16 1.31z" /></svg>
                <svg v-else-if="m.k === 'STUDIO_IA'" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8L12 2zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16z" /></svg>
                <svg v-else-if="m.k === 'COUPONS'" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4V9z" /><path d="M12 7v2M12 12v.01M12 15v2" /></svg>
                <svg v-else-if="m.k === 'CUSTOM_DOMAIN'" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></svg>
                <span>{{ m.k.replace('_', ' · ').toLowerCase() }}</span>
              </div>
              <h3 class="cfz-feature-title">{{ m.t }}</h3>
              <p class="cfz-feature-text">{{ m.s }}</p>
            </div>
          </article>
        </div>
      </div>
    </section>

    <!-- ─── Studio IA ─────────────────────────────────────────────── -->
    <section class="cfz-studio">
      <div class="cfz-studio-bg" aria-hidden></div>
      <div class="cfz-container cfz-studio-grid">
        <div>
          <div class="cfz-studio-pill">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8L12 2z" /></svg>
            Studio IA · incluso em todos os planos
          </div>
          <h2 class="cfz-studio-title">
            Foto de comida<br />
            que dá fome.<br />
            <span class="cfz-studio-green">Sem cara de IA.</span>
          </h2>
          <p class="cfz-studio-sub">
            Suba a foto que você tirou no celular. O Studio devolve a mesma comida — sem inventar ingredientes — iluminada, com fundo limpo e cara de cardápio caro. E gera os posts pra Instagram, story e WhatsApp Status no mesmo clique.
          </p>
          <div class="cfz-studio-tabs">
            <button
              v-for="t in STUDIO_TABS"
              :key="t.k"
              :class="['cfz-studio-tab', { active: studioTab === t.k }]"
              @click="studioTab = t.k"
            >
              <div>
                <div class="cfz-studio-tab-label">{{ t.label }}</div>
                <div class="cfz-studio-tab-sub">{{ t.sub }}</div>
              </div>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="12" x2="20" y2="12" /><polyline points="14 6 20 12 14 18" /></svg>
            </button>
          </div>
          <div class="cfz-studio-included">
            <i class="cfz-check"></i>
            <div>
              <strong>Incluso em todos os planos.</strong> Do Básico ao Premium, sem custo extra, sem limite de crédito surpresa.
            </div>
          </div>
        </div>

        <div class="cfz-studio-visual">
          <div class="cfz-studio-pair">
            <div>
              <div class="cfz-studio-label">Antes</div>
              <div class="cfz-studio-before">
                <div class="cfz-placeholder tone-dark cfz-studio-img">
                  <svg class="cfz-placeholder-x" preserveAspectRatio="none">
                    <line x1="0" y1="0" x2="100%" y2="100%" stroke-width="1" />
                    <line x1="100%" y1="0" x2="0" y2="100%" stroke-width="1" />
                  </svg>
                  <span class="cfz-placeholder-label">{{ studioCopy.before }}</span>
                </div>
              </div>
            </div>
            <div>
              <div class="cfz-studio-label-row">
                <span class="cfz-studio-label cfz-studio-label-green">Depois</span>
                <span class="cfz-studio-time">2 min</span>
              </div>
              <div class="cfz-studio-after">
                <div class="cfz-placeholder tone-green cfz-studio-img">
                  <svg class="cfz-placeholder-x" preserveAspectRatio="none">
                    <line x1="0" y1="0" x2="100%" y2="100%" stroke-width="1" />
                    <line x1="100%" y1="0" x2="0" y2="100%" stroke-width="1" />
                  </svg>
                  <span class="cfz-placeholder-label">{{ studioCopy.after }}</span>
                </div>
              </div>
            </div>
          </div>
          <div class="cfz-studio-caption">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8L12 2z" /></svg>
            <p>{{ studioCopy.caption }}</p>
          </div>
          <div class="cfz-polaroid" aria-hidden>
            <div class="cfz-polaroid-pic"></div>
            <div class="cfz-polaroid-cap">IG · 03 set</div>
          </div>
        </div>
      </div>
    </section>

    <!-- ─── Pricing ───────────────────────────────────────────────── -->
    <section id="planos" ref="pricingRef" class="cfz-pricing">
      <div class="cfz-container">
        <div class="cfz-pricing-head">
          <div class="cfz-eyebrow-green">Planos</div>
          <h2 class="cfz-h2 cfz-h2-center">Escolha seu plano.</h2>
          <p class="cfz-pricing-sub">
            Comece com o Básico. Cresça quando precisar — em minutos, sem trocar de plataforma.
          </p>
          <div class="cfz-period-toggle">
            <button
              :class="['cfz-period-btn', { on: period === 'MONTHLY' }]"
              @click="period = 'MONTHLY'"
            >Mensal</button>
            <button
              :class="['cfz-period-btn', { on: period === 'YEARLY' }]"
              @click="period = 'YEARLY'"
            >
              Anual
              <span class="cfz-period-badge">−25%</span>
            </button>
          </div>
        </div>

        <div class="cfz-pricing-rows">
          <article
            v-for="(plan, idx) in PLANS"
            :key="plan.key"
            :class="['cfz-pricing-row', { recommended: plan.recommended }]"
          >
            <div>
              <div class="cfz-pricing-row-head">
                <span class="cfz-pricing-row-num">0{{ idx + 1 }}</span>
                <h3 class="cfz-pricing-row-name">{{ plan.name }}</h3>
              </div>
              <div class="cfz-pricing-row-price">
                <span class="cfz-pricing-row-currency">R$</span>
                <span class="cfz-pricing-row-amount">{{ brl(priceFor(plan)) }}</span>
                <span class="cfz-pricing-row-per">/mês</span>
              </div>
              <div class="cfz-pricing-row-footnote">
                <template v-if="period === 'YEARLY'">cobrado anualmente · R$ {{ brl(plan.yearly) }}</template>
                <template v-else>sem fidelidade</template>
              </div>
              <div v-if="plan.recommended" class="cfz-pricing-row-recommended">⭐ MAIS ESCOLHIDO</div>
            </div>

            <div>
              <p class="cfz-pricing-row-tagline">{{ plan.tagline }}</p>
              <div class="cfz-pricing-row-chips">
                <span v-for="m in plan.modules" :key="m" class="cfz-pricing-chip">
                  <span class="cfz-pricing-chip-icon">
                    <svg v-if="m === 'CARDAPIO_COMPLETO' || m === 'CARDAPIO_SIMPLES'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7h14l-1.2 12.2A2 2 0 0 1 15.8 21H8.2a2 2 0 0 1-2-1.8L5 7z" /><path d="M9 7V5a3 3 0 0 1 6 0v2" /></svg>
                    <svg v-else-if="m === 'WHATSAPP'" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15.07L2 22l5.07-1.33A10 10 0 1 0 12 2zm5.43 14.13c-.23.65-1.36 1.24-1.86 1.3-.5.06-1.1.09-1.78-.11-.4-.13-.93-.31-1.6-.6-2.8-1.21-4.62-4.03-4.76-4.22-.14-.18-1.13-1.5-1.13-2.86 0-1.37.72-2.04.97-2.32.26-.28.56-.35.74-.35.18 0 .37 0 .53.01.17.01.4-.07.62.47.23.55.78 1.91.85 2.05.07.14.12.31.02.5-.1.18-.14.3-.28.46-.14.16-.3.36-.43.49-.14.14-.29.29-.13.57.16.28.7 1.15 1.5 1.86 1.04.93 1.92 1.21 2.2 1.36.27.14.43.12.59-.07.16-.2.68-.79.86-1.06.18-.27.36-.23.6-.14.25.09 1.57.74 1.83.88.27.13.45.2.51.31.07.12.07.66-.16 1.31z" /></svg>
                    <svg v-else-if="m === 'STUDIO_IA'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8L12 2z" /></svg>
                    <svg v-else-if="m === 'COUPONS'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4V9z" /></svg>
                    <svg v-else-if="m === 'CUSTOM_DOMAIN'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></svg>
                    <svg v-else-if="m === 'RIDERS'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="17" r="3" /><circle cx="18" cy="17" r="3" /><path d="M6 17l4-8h4l2 4" /><path d="M14 9h3" /></svg>
                    <svg v-else-if="m === 'CASHBACK'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9" /><path d="M14.5 9.5C14.5 8.4 13.4 8 12 8s-2.5.6-2.5 1.7c0 2.4 5 1.4 5 4 0 1.2-1.2 1.8-2.5 1.8s-2.5-.7-2.5-1.8" /><path d="M12 6v2M12 16v2" /></svg>
                    <svg v-else-if="m === 'AFFILIATES'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="9" r="3" /><path d="M3 19a6 6 0 0 1 12 0" /><path d="M16 6.5a3 3 0 0 1 0 5.5M21 19a5 5 0 0 0-5-5" /></svg>
                    <svg v-else-if="m === 'FISCAL'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3z" /><line x1="9" y1="8" x2="15" y2="8" /></svg>
                    <svg v-else-if="m === 'STOCK'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8l9-5 9 5v8l-9 5-9-5V8z" /><path d="M3 8l9 5 9-5M12 13v9" /></svg>
                  </span>
                  {{ MODULE_LABELS[m] }}
                </span>
              </div>
            </div>

            <button @click="onSelectPlan(plan)" class="cfz-pricing-cta">
              Quero o {{ plan.name }}
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="12" x2="20" y2="12" /><polyline points="14 6 20 12 14 18" /></svg>
            </button>
          </article>
        </div>
      </div>
    </section>

    <!-- ─── Testimonials ──────────────────────────────────────────── -->
    <section class="cfz-testimonials">
      <div class="cfz-container">
        <div class="cfz-testimonials-head">
          <h2 class="cfz-h2">Quem já cozinha com a gente.</h2>
          <p class="cfz-testimonials-sub">1.243 restaurantes ativos. 2.8M de pedidos processados no último ano.</p>
        </div>
        <div class="cfz-testimonials-grid">
          <figure
            v-for="(t, i) in TESTIMONIALS"
            :key="i"
            :class="['cfz-testimonial', { highlight: i === 1 }]"
          >
            <div class="cfz-testimonial-quote">"</div>
            <blockquote>{{ t.q }}</blockquote>
            <div class="cfz-testimonial-spacer"></div>
            <figcaption class="cfz-testimonial-meta">
              <div class="cfz-testimonial-avatar">{{ t.a.charAt(0) }}</div>
              <div>
                <div class="cfz-testimonial-name">{{ t.a }}</div>
                <div class="cfz-testimonial-tag">{{ t.tag }}</div>
              </div>
            </figcaption>
          </figure>
        </div>
      </div>
    </section>

    <!-- ─── FAQ ───────────────────────────────────────────────────── -->
    <section id="perguntas" ref="faqRef" class="cfz-faq">
      <div class="cfz-faq-inner">
        <div class="cfz-faq-head">
          <div class="cfz-eyebrow-green">Dúvidas</div>
          <h2 class="cfz-h2 cfz-h2-center">Perguntas frequentes.</h2>
        </div>
        <div class="cfz-faq-list">
          <div
            v-for="(f, i) in FAQS"
            :key="i"
            :class="['cfz-faq-item', { first: i === 0 }]"
          >
            <button class="cfz-faq-q" @click="toggleFaq(i)">
              <span>{{ f.q }}</span>
              <svg
                :class="['cfz-faq-chev', { open: openFaq === i }]"
                width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"
              ><polyline points="6 9 12 15 18 9" /></svg>
            </button>
            <div :class="['cfz-faq-a', { open: openFaq === i }]">
              <p>{{ f.a }}</p>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- ─── Lead Form ─────────────────────────────────────────────── -->
    <section ref="formRef" class="cfz-form-section">
      <div class="cfz-form-inner">
        <div>
          <div class="cfz-eyebrow-green">Última parada</div>
          <h2 class="cfz-form-title">Coloque seu restaurante no Chefiz hoje.</h2>
          <div v-if="selectedPlan" class="cfz-form-plan">
            <div class="cfz-form-plan-tick">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 12 10 18 20 6" /></svg>
            </div>
            <div>
              <div class="cfz-form-plan-eyebrow">Plano selecionado</div>
              <div class="cfz-form-plan-name">
                {{ selectedPlan.name }} · R$ {{ brl(priceFor(selectedPlan)) }}/mês
              </div>
            </div>
          </div>
          <p v-else class="cfz-form-empty">
            Escolha um plano acima e a gente leva você ao checkout em 30 segundos.
          </p>
        </div>

        <form @submit.prevent="onSubmit" class="cfz-form">
          <label class="cfz-form-label">
            Nome do restaurante
            <input
              v-model="name"
              placeholder="Pizzaria do Tio"
              class="cfz-form-input"
            />
          </label>
          <label class="cfz-form-label">
            WhatsApp do contato
            <input
              :value="phone"
              @input="onPhoneInput"
              placeholder="(11) 99999-9999"
              inputmode="tel"
              class="cfz-form-input"
            />
          </label>
          <div v-if="error" class="cfz-form-error">{{ error }}</div>
          <div v-if="ok" class="cfz-form-ok">Tudo certo! Te levando para o checkout do Kiwify…</div>
          <button type="submit" class="cfz-form-submit" :disabled="loading">
            <span v-if="loading" class="cfz-spinner"></span>
            {{ loading ? 'Enviando…' : selectedPlan ? `Ir para o checkout do ${selectedPlan.name}` : 'Continuar' }}
            <svg v-if="!loading" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="12" x2="20" y2="12" /><polyline points="14 6 20 12 14 18" /></svg>
          </button>
          <p class="cfz-form-terms">
            Ao continuar, você concorda com nossos
            <router-link to="/termos-de-servico">Termos</router-link>
            e
            <router-link to="/politica-de-privacidade">Política de Privacidade</router-link>.
          </p>
        </form>
      </div>
    </section>

    <!-- ─── Footer ────────────────────────────────────────────────── -->
    <footer class="cfz-footer">
      <div class="cfz-footer-grid">
        <div>
          <svg class="cfz-logo" viewBox="0 0 380 100" height="28" xmlns="http://www.w3.org/2000/svg">
            <text x="0" y="80" font-family="'Plus Jakarta Sans', system-ui" font-weight="800" font-size="100" letter-spacing="-0.04em" fill="#fff">Chef</text>
            <g transform="translate(245,0)">
              <path d="M 0 0 L 130 0 L 110 100 L -20 100 Z" :fill="C.green" />
              <text x="14" y="80" font-family="'Plus Jakarta Sans', system-ui" font-weight="800" font-size="100" letter-spacing="-0.04em" :fill="C.ink">iz</text>
            </g>
          </svg>
          <p class="cfz-footer-blurb">
            A plataforma que organiza o cardápio do seu restaurante. Feita no Brasil, pra cozinhas brasileiras.
          </p>
        </div>
        <div v-for="g in FOOTER_GROUPS" :key="g.title" class="cfz-footer-col">
          <div class="cfz-footer-title">{{ g.title }}</div>
          <ul>
            <li v-for="it in g.items" :key="it">{{ it }}</li>
          </ul>
        </div>
      </div>
      <div class="cfz-footer-bottom">
        <div>© 2026 Chefiz · todos os direitos reservados</div>
        <div>Feito com 🌶 em Florianópolis</div>
      </div>
    </footer>
  </div>
</template>

<style scoped>
/* ─── Base ────────────────────────────────────────────────────────── */
.cfz,
.cfz * {
  box-sizing: border-box;
}
.cfz {
  font-family: 'Plus Jakarta Sans', ui-sans-serif, system-ui, sans-serif;
  color: #1F1F1F;
  background: #fff;
  -webkit-font-smoothing: antialiased;
  font-feature-settings: 'cv11', 'ss01';
}
.cfz h1,
.cfz h2,
.cfz h3,
.cfz h4 {
  margin: 0;
  letter-spacing: -0.02em;
  line-height: 1.05;
  font-weight: 700;
}
.cfz h1 {
  letter-spacing: -0.035em;
}
.cfz p {
  margin: 0;
  line-height: 1.55;
  color: #5B5B5B;
}
.cfz a {
  color: inherit;
}
.cfz ::selection {
  background: #89D136;
  color: #1F1F1F;
}
.cfz-container {
  max-width: 1400px;
  margin: 0 auto;
}
.cfz-h2 {
  font-size: 56px;
  letter-spacing: -0.025em;
}
.cfz-h2-center {
  text-align: center;
}
.cfz-h2-muted {
  color: #8A8A8A;
}
.cfz-eyebrow {
  font-size: 12px;
  letter-spacing: 0.3em;
  text-transform: uppercase;
  color: #89D136;
  font-weight: 700;
  margin-bottom: 32px;
}
.cfz-eyebrow-green {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.16em;
  color: #89D136;
  text-transform: uppercase;
  margin-bottom: 12px;
}
.cfz-check {
  display: inline-block;
  width: 14px;
  height: 14px;
  background: #89D136;
  -webkit-mask: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2.6' stroke-linecap='round' stroke-linejoin='round'><polyline points='4 12 10 18 20 6'/></svg>") center / contain no-repeat;
          mask: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2.6' stroke-linecap='round' stroke-linejoin='round'><polyline points='4 12 10 18 20 6'/></svg>") center / contain no-repeat;
}

/* ─── Header ──────────────────────────────────────────────────────── */
.cfz-header {
  position: sticky;
  top: 0;
  z-index: 30;
  background: rgba(15, 15, 15, 0.88);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid #1f1f1f;
  color: #fff;
}
.cfz-header-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 56px;
  max-width: 1400px;
  margin: 0 auto;
  gap: 16px;
}
.cfz-logo {
  display: block;
}
.cfz-logo-link {
  text-decoration: none;
}
.cfz-nav {
  display: flex;
  gap: 32px;
  font-size: 14px;
  font-weight: 500;
  color: #cfcfcf;
}
.cfz-nav a {
  text-decoration: none;
  cursor: pointer;
}
.cfz-nav a:hover {
  color: #fff;
}
.cfz-header-cta {
  display: flex;
  gap: 10px;
  align-items: center;
}
.cfz-header-login {
  font-size: 14px;
  font-weight: 600;
  color: #fff;
  text-decoration: none;
}
.cfz-btn-pill-green {
  background: #89D136;
  color: #1F1F1F;
  border: none;
  padding: 11px 18px;
  border-radius: 999px;
  font-weight: 700;
  font-size: 14px;
  cursor: pointer;
  font-family: inherit;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  transition: background 0.15s;
}
.cfz-btn-pill-green:hover {
  background: #6DAE1E;
}
.cfz-btn-lg {
  padding: 20px 32px;
  font-size: 17px;
}
.cfz-btn-pill-outline {
  background: transparent;
  color: #fff;
  border: 1.5px solid #2a2a2a;
  padding: 19px 22px;
  border-radius: 999px;
  font-weight: 600;
  font-size: 15px;
  cursor: pointer;
  font-family: inherit;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  transition: border-color 0.15s;
}
.cfz-btn-pill-outline:hover {
  border-color: #4a4a4a;
}

/* ─── Hero ────────────────────────────────────────────────────────── */
.cfz-hero {
  background: #1F1F1F;
  color: #fff;
  position: relative;
  overflow: hidden;
}
.cfz-hero-inner {
  display: grid;
  grid-template-columns: 1.05fr 1fr;
  padding: 80px 80px 100px;
  align-items: center;
  gap: 64px;
  max-width: 1400px;
  margin: 0 auto;
}
.cfz-hero-title {
  font-size: 108px;
  line-height: 0.94;
  font-weight: 800;
  color: #fff;
  letter-spacing: -0.04em;
}
.cfz-hero-italic {
  color: #89D136;
  font-style: italic;
}
.cfz-hero-sub {
  font-size: 19px;
  color: #cfcfcf;
  margin-top: 32px;
  max-width: 480px;
  line-height: 1.5;
}
.cfz-hero-sub strong {
  color: #fff;
  font-weight: 500;
}
.cfz-hero-ctas {
  display: flex;
  gap: 12px;
  margin-top: 36px;
  flex-wrap: wrap;
  align-items: center;
}
.cfz-hero-bullets {
  display: flex;
  gap: 24px;
  margin-top: 36px;
  font-size: 13px;
  color: #aaa;
  flex-wrap: wrap;
}
.cfz-hero-bullets span {
  display: inline-flex;
  gap: 6px;
  align-items: center;
}

.cfz-hero-visual {
  position: relative;
  display: flex;
  justify-content: center;
  align-items: center;
}
.cfz-hero-halo {
  position: absolute;
  inset: -40px;
  background: radial-gradient(circle at 50% 40%, rgba(137, 209, 54, 0.18), transparent 65%);
}

/* ─── Phone mockup ────────────────────────────────────────────────── */
.cfz-phone {
  width: 340px;
  height: 620px;
  border-radius: 36px;
  overflow: hidden;
  background: #000;
  padding: 8px;
  box-shadow:
    0 40px 100px -20px rgba(20, 30, 10, 0.45),
    0 12px 30px -10px rgba(0, 0, 0, 0.25);
  border: 1px solid #222;
  position: relative;
}
.cfz-phone-screen {
  height: 100%;
  border-radius: 28px;
  overflow: hidden;
  background: #FAFAF7;
  display: flex;
  flex-direction: column;
}
.cfz-phone-status {
  padding: 14px 18px 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
  color: #222;
  font-weight: 600;
}
.cfz-phone-status-right {
  display: inline-flex;
  gap: 4px;
}
.cfz-phone-restaurant {
  padding: 16px 18px 14px;
  border-bottom: 1px solid #eee;
}
.cfz-phone-restaurant-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}
.cfz-phone-restaurant-name {
  font-size: 18px;
  font-weight: 800;
  color: #111;
  letter-spacing: -0.02em;
}
.cfz-phone-restaurant-meta {
  font-size: 11px;
  color: #666;
  margin-top: 2px;
  display: flex;
  gap: 8px;
  align-items: center;
}
.cfz-phone-open {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.cfz-phone-dot {
  width: 6px;
  height: 6px;
  background: #89D136;
  border-radius: 50%;
}
.cfz-phone-rating {
  background: #EAF7D6;
  color: #3D6313;
  padding: 4px 8px;
  border-radius: 8px;
  font-size: 10px;
  font-weight: 700;
}
.cfz-phone-chips {
  display: flex;
  gap: 6px;
  margin-top: 12px;
  overflow: hidden;
}
.cfz-phone-chip {
  padding: 5px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  background: #F1EFE9;
  color: #555;
  flex: 0 0 auto;
}
.cfz-phone-chip.active {
  background: #1F1F1F;
  color: #fff;
}
.cfz-phone-items {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 14px 0;
}
.cfz-phone-item {
  display: grid;
  grid-template-columns: 1fr 88px;
  gap: 12px;
  padding: 10px;
  background: #fff;
  border-radius: 14px;
  border: 1px solid #f0eee9;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.03);
}
.cfz-phone-item-name {
  font-size: 13px;
  font-weight: 700;
  color: #111;
  line-height: 1.2;
}
.cfz-phone-item-desc {
  font-size: 10.5px;
  color: #777;
  margin-top: 4px;
  line-height: 1.35;
}
.cfz-phone-item-bottom {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}
.cfz-phone-item-price {
  font-size: 14px;
  font-weight: 800;
  color: #111;
}
.cfz-phone-item-add {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: #89D136;
  color: #1F1F1F;
  font-size: 14px;
  font-weight: 700;
  padding: 3px 10px;
  border-radius: 999px;
  line-height: 1;
}
.cfz-phone-item-photo {
  border-radius: 10px;
  position: relative;
  overflow: hidden;
}
.cfz-phone-item-photo.tone-green {
  background: #EAF7D6;
}
.cfz-phone-item-photo.tone-warm {
  background: #F4EAD8;
}
.cfz-phone-item-photo::after {
  content: '';
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(135deg, rgba(0, 0, 0, 0) 49%, rgba(137, 209, 54, 0.4) 49.5%, rgba(137, 209, 54, 0.4) 50.5%, transparent 51%),
    linear-gradient(45deg, rgba(0, 0, 0, 0) 49%, rgba(137, 209, 54, 0.4) 49.5%, rgba(137, 209, 54, 0.4) 50.5%, transparent 51%);
  opacity: 0.4;
  pointer-events: none;
}
.cfz-phone-item-photo.tone-warm::after {
  background-image:
    linear-gradient(135deg, rgba(0, 0, 0, 0) 49%, rgba(201, 185, 140, 0.4) 49.5%, rgba(201, 185, 140, 0.4) 50.5%, transparent 51%),
    linear-gradient(45deg, rgba(0, 0, 0, 0) 49%, rgba(201, 185, 140, 0.4) 49.5%, rgba(201, 185, 140, 0.4) 50.5%, transparent 51%);
}
.cfz-phone-ia-badge {
  position: absolute;
  top: 5px;
  left: 5px;
  background: #fff;
  color: #3D6313;
  font-size: 8.5px;
  font-weight: 800;
  padding: 2px 6px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.1);
  z-index: 2;
}
.cfz-phone-cart {
  padding: 14px;
  border-top: 1px solid #eee;
  background: #fff;
}
.cfz-phone-cart-btn {
  width: 100%;
  background: #89D136;
  color: #1F1F1F;
  border: none;
  padding: 12px;
  border-radius: 12px;
  font-weight: 800;
  font-size: 13px;
  cursor: pointer;
  font-family: inherit;
}

/* Floating tags */
.cfz-float-tag {
  position: absolute;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 700;
  z-index: 3;
}
.cfz-float-tag-ia {
  top: 30px;
  left: -10px;
  transform: rotate(-5deg);
  background: #fff;
  color: #1F1F1F;
  padding: 12px 14px;
  border-radius: 14px;
  box-shadow: 0 14px 40px rgba(0, 0, 0, 0.4);
}
.cfz-float-tag-ia svg {
  color: #3D6313;
}
.cfz-float-tag-sub {
  font-size: 10px;
  color: #8A8A8A;
  font-weight: 500;
}
.cfz-float-tag-ia > div {
  line-height: 1.2;
}
.cfz-float-tag-edit {
  bottom: 60px;
  right: -16px;
  transform: rotate(4deg);
  background: #89D136;
  color: #1F1F1F;
  padding: 10px 14px;
  border-radius: 12px;
  box-shadow: 0 10px 30px rgba(137, 209, 54, 0.4);
}

/* Stats strip */
.cfz-stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  border-top: 1px solid #2a2a2a;
  padding: 32px 80px;
  background: #161616;
  max-width: 1400px;
  margin: 0 auto;
  gap: 24px;
}
.cfz-stats-n {
  font-size: 32px;
  font-weight: 800;
  color: #fff;
}
.cfz-stats-l {
  font-size: 13px;
  color: #8A8A8A;
  margin-top: 4px;
}

/* ─── Problem cards ───────────────────────────────────────────────── */
.cfz-problems {
  background: #F4F2EC;
  padding: 96px 80px;
}
.cfz-problems-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  margin-bottom: 56px;
  flex-wrap: wrap;
  gap: 24px;
}
.cfz-problems-head .cfz-h2 {
  max-width: 760px;
}
.cfz-problems-sub {
  font-size: 16px;
  color: #5B5B5B;
  max-width: 320px;
}
.cfz-problems-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}
.cfz-problem-card {
  background: #fff;
  border-radius: 20px;
  padding: 32px 28px;
  border: 1px solid #E7E6E2;
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-height: 240px;
}
.cfz-problem-icon {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: #EAF7D6;
  color: #3D6313;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.cfz-problem-title {
  font-size: 22px;
  font-weight: 700;
  line-height: 1.2;
}
.cfz-problem-text {
  font-size: 15px;
  color: #5B5B5B;
}

/* ─── Features ───────────────────────────────────────────────────── */
.cfz-features {
  padding: 96px 80px;
  background: #fff;
}
.cfz-features-head {
  margin-bottom: 56px;
}
.cfz-features-head .cfz-h2 {
  max-width: 820px;
}
.cfz-features-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
}
.cfz-feature-card {
  border-radius: 20px;
  overflow: hidden;
  border: 1px solid #E7E6E2;
  display: flex;
  flex-direction: column;
  background: #fff;
}
.cfz-feature-body {
  padding: 24px 24px 28px;
}
.cfz-feature-kicker {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: #89D136;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  margin-bottom: 12px;
}
.cfz-feature-title {
  font-size: 22px;
  font-weight: 700;
  margin-bottom: 8px;
}
.cfz-feature-text {
  font-size: 15px;
  color: #5B5B5B;
}

/* Placeholder (labeled rectangle) */
.cfz-placeholder {
  width: 100%;
  height: 200px;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.cfz-placeholder.tone-green {
  background: #EAF7D6;
  color: #5C8520;
}
.cfz-placeholder.tone-warm {
  background: #F0EDE5;
  color: #8A8473;
}
.cfz-placeholder.tone-dark {
  background: #1F1F1F;
  color: #9C9C9C;
}
.cfz-placeholder-x {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0.4;
}
.cfz-placeholder.tone-green .cfz-placeholder-x line {
  stroke: #89D136;
}
.cfz-placeholder.tone-warm .cfz-placeholder-x line {
  stroke: #C9C2AC;
}
.cfz-placeholder.tone-dark .cfz-placeholder-x line {
  stroke: #89D136;
}
.cfz-placeholder-label {
  position: relative;
  padding: 6px 10px;
  background: rgba(255, 255, 255, 0.6);
  border-radius: 999px;
  z-index: 1;
}
.cfz-placeholder.tone-dark .cfz-placeholder-label {
  background: rgba(0, 0, 0, 0.4);
  color: #cfcfcf;
}

/* ─── Studio IA ──────────────────────────────────────────────────── */
.cfz-studio {
  background: #1F1F1F;
  color: #fff;
  padding: 96px 80px;
  position: relative;
  overflow: hidden;
}
.cfz-studio-bg {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(circle at 80% 10%, rgba(137, 209, 54, 0.18), transparent 50%),
    radial-gradient(circle at 10% 90%, rgba(137, 209, 54, 0.08), transparent 50%);
  pointer-events: none;
}
.cfz-studio-grid {
  position: relative;
  display: grid;
  grid-template-columns: 1fr 1.05fr;
  gap: 80px;
  align-items: center;
}
.cfz-studio-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  border-radius: 999px;
  background: rgba(137, 209, 54, 0.14);
  color: #89D136;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}
.cfz-studio-title {
  font-size: 64px;
  margin-top: 22px;
  color: #fff;
  letter-spacing: -0.03em;
  line-height: 1.02;
  font-weight: 700;
}
.cfz-studio-green {
  color: #89D136;
}
.cfz-studio-sub {
  font-size: 18px;
  color: #cfcfcf;
  margin-top: 22px;
  max-width: 480px;
  line-height: 1.55;
}
.cfz-studio-tabs {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 28px;
}
.cfz-studio-tab {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 16px;
  text-align: left;
  background: transparent;
  color: #fff;
  border: 1px solid #2a2a2a;
  padding: 14px 18px;
  border-radius: 14px;
  cursor: pointer;
  font-family: inherit;
  transition: all 0.15s;
}
.cfz-studio-tab.active {
  background: #fff;
  color: #1F1F1F;
  border-color: transparent;
}
.cfz-studio-tab-label {
  font-size: 15px;
  font-weight: 700;
}
.cfz-studio-tab-sub {
  font-size: 12px;
  color: #999;
  margin-top: 2px;
}
.cfz-studio-tab.active .cfz-studio-tab-sub {
  color: #5B5B5B;
}
.cfz-studio-tab svg {
  color: #666;
}
.cfz-studio-tab.active svg {
  color: #89D136;
}
.cfz-studio-included {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 36px;
  padding: 14px 18px;
  background: rgba(137, 209, 54, 0.1);
  border: 1px solid rgba(137, 209, 54, 0.25);
  border-radius: 14px;
  font-size: 14px;
  color: #e6e6e6;
}
.cfz-studio-included strong {
  color: #fff;
}
.cfz-studio-visual {
  position: relative;
}
.cfz-studio-pair {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.cfz-studio-label {
  font-size: 11px;
  font-weight: 700;
  color: #999;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  margin-bottom: 10px;
  display: block;
}
.cfz-studio-label-green {
  color: #89D136;
}
.cfz-studio-label-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.cfz-studio-time {
  background: #89D136;
  color: #1F1F1F;
  font-size: 10px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 999px;
  letter-spacing: 0.05em;
}
.cfz-studio-before {
  border-radius: 18px;
  overflow: hidden;
  border: 1px solid #2a2a2a;
}
.cfz-studio-after {
  border-radius: 18px;
  overflow: hidden;
  box-shadow: 0 24px 60px -20px rgba(137, 209, 54, 0.4);
  border: 2px solid #89D136;
}
.cfz-studio-img {
  height: 360px;
  border-radius: 0;
}
.cfz-studio-caption {
  margin-top: 18px;
  background: #0f0f0f;
  border: 1px solid #1f1f1f;
  border-radius: 14px;
  padding: 14px 18px;
  display: flex;
  gap: 12px;
  align-items: flex-start;
}
.cfz-studio-caption svg {
  color: #89D136;
  margin-top: 2px;
  flex-shrink: 0;
}
.cfz-studio-caption p {
  font-size: 13px;
  color: #bbb;
  margin: 0;
  line-height: 1.5;
}
.cfz-polaroid {
  position: absolute;
  top: -24px;
  right: -24px;
  transform: rotate(7deg);
  background: #fff;
  padding: 8px 8px 28px;
  border-radius: 4px;
  box-shadow: 0 14px 40px rgba(0, 0, 0, 0.4);
  width: 96px;
}
.cfz-polaroid-pic {
  width: 100%;
  height: 80px;
  background: #E8DDC9;
  border-radius: 2px;
}
.cfz-polaroid-cap {
  font-family: serif;
  font-size: 10px;
  color: #666;
  text-align: center;
  margin-top: 4px;
}

/* ─── Pricing ────────────────────────────────────────────────────── */
.cfz-pricing {
  padding: 96px 80px;
  background: #fff;
}
.cfz-pricing-head {
  text-align: center;
  margin-bottom: 56px;
}
.cfz-pricing-sub {
  font-size: 18px;
  color: #5B5B5B;
  margin: 14px auto 0;
  max-width: 580px;
}
.cfz-period-toggle {
  margin-top: 28px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: #F1EFE9;
  padding: 6px;
  border-radius: 999px;
  font-size: 14px;
}
.cfz-period-btn {
  border: none;
  background: transparent;
  padding: 8px 16px;
  border-radius: 999px;
  font-weight: 600;
  color: #5B5B5B;
  cursor: pointer;
  font-family: inherit;
  display: inline-flex;
  gap: 6px;
  align-items: center;
}
.cfz-period-btn.on {
  background: #fff;
  color: #1F1F1F;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
}
.cfz-period-badge {
  font-size: 11px;
  font-weight: 700;
  color: #8A8A8A;
  padding: 2px 6px;
  border-radius: 999px;
}
.cfz-period-btn.on .cfz-period-badge {
  color: #3D6313;
  background: #EAF7D6;
}
.cfz-pricing-rows {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 1100px;
  margin: 0 auto;
}
.cfz-pricing-row {
  display: grid;
  grid-template-columns: 240px 1fr 240px;
  align-items: center;
  gap: 32px;
  padding: 32px 36px;
  border-radius: 20px;
  background: #fff;
  color: #1F1F1F;
  border: 1px solid #E7E6E2;
  position: relative;
}
.cfz-pricing-row.recommended {
  background: #1F1F1F;
  color: #fff;
  border: none;
  box-shadow: 0 24px 60px -20px rgba(0, 0, 0, 0.3);
}
.cfz-pricing-row-head {
  display: flex;
  align-items: baseline;
  gap: 12px;
}
.cfz-pricing-row-num {
  font-size: 12px;
  font-weight: 700;
  color: #8A8A8A;
  letter-spacing: 0.16em;
}
.cfz-pricing-row.recommended .cfz-pricing-row-num {
  color: #89D136;
}
.cfz-pricing-row-name {
  font-size: 32px;
  font-weight: 700;
}
.cfz-pricing-row-price {
  display: flex;
  align-items: baseline;
  gap: 4px;
  margin-top: 14px;
}
.cfz-pricing-row-currency,
.cfz-pricing-row-per {
  font-size: 13px;
  color: #8A8A8A;
}
.cfz-pricing-row.recommended .cfz-pricing-row-currency,
.cfz-pricing-row.recommended .cfz-pricing-row-per {
  color: #aaa;
}
.cfz-pricing-row-amount {
  font-size: 52px;
  font-weight: 800;
  letter-spacing: -0.04em;
}
.cfz-pricing-row-footnote {
  font-size: 11px;
  color: #8A8A8A;
  margin-top: 4px;
}
.cfz-pricing-row.recommended .cfz-pricing-row-footnote {
  color: #999;
}
.cfz-pricing-row-recommended {
  margin-top: 12px;
  font-size: 11px;
  font-weight: 700;
  color: #89D136;
  letter-spacing: 0.16em;
}
.cfz-pricing-row-tagline {
  color: #5B5B5B;
  font-size: 15px;
  margin-bottom: 16px;
  line-height: 1.5;
}
.cfz-pricing-row.recommended .cfz-pricing-row-tagline {
  color: #ddd;
}
.cfz-pricing-row-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.cfz-pricing-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 999px;
  background: #F4F2EC;
  color: #1F1F1F;
  font-size: 12px;
  font-weight: 500;
}
.cfz-pricing-row.recommended .cfz-pricing-chip {
  background: #2a2a2a;
  color: #eee;
}
.cfz-pricing-chip-icon {
  color: #89D136;
  display: inline-flex;
}
.cfz-pricing-cta {
  background: #1F1F1F;
  color: #fff;
  border: none;
  padding: 16px 22px;
  border-radius: 12px;
  font-weight: 700;
  font-size: 15px;
  cursor: pointer;
  font-family: inherit;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  transition: opacity 0.15s;
}
.cfz-pricing-cta:hover {
  opacity: 0.9;
}
.cfz-pricing-row.recommended .cfz-pricing-cta {
  background: #89D136;
  color: #1F1F1F;
}

/* ─── Testimonials ───────────────────────────────────────────────── */
.cfz-testimonials {
  padding: 96px 80px;
  background: #fff;
}
.cfz-testimonials-head {
  margin-bottom: 56px;
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  flex-wrap: wrap;
  gap: 24px;
}
.cfz-testimonials-head .cfz-h2 {
  max-width: 720px;
}
.cfz-testimonials-sub {
  font-size: 16px;
  color: #5B5B5B;
  max-width: 320px;
}
.cfz-testimonials-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
}
.cfz-testimonial {
  margin: 0;
  padding: 32px 28px;
  border-radius: 20px;
  background: #F4F2EC;
  color: #1F1F1F;
  display: flex;
  flex-direction: column;
  gap: 20px;
  min-height: 280px;
}
.cfz-testimonial.highlight {
  background: #89D136;
}
.cfz-testimonial-quote {
  font-size: 28px;
  line-height: 1;
  color: #3D6313;
}
.cfz-testimonial.highlight .cfz-testimonial-quote {
  color: #1F1F1F;
}
.cfz-testimonial blockquote {
  font-size: 19px;
  line-height: 1.4;
  font-weight: 600;
  margin: 0;
}
.cfz-testimonial-spacer {
  flex: 1;
}
.cfz-testimonial-meta {
  display: flex;
  gap: 12px;
  align-items: center;
}
.cfz-testimonial-avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: #EAF7D6;
  color: #3D6313;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
}
.cfz-testimonial.highlight .cfz-testimonial-avatar {
  background: #fff;
  color: #1F1F1F;
}
.cfz-testimonial-name {
  font-weight: 700;
  font-size: 13px;
  color: #1F1F1F;
}
.cfz-testimonial-tag {
  font-size: 13px;
  color: #5B5B5B;
}
.cfz-testimonial.highlight .cfz-testimonial-tag {
  color: #3F3F3F;
}

/* ─── FAQ ────────────────────────────────────────────────────────── */
.cfz-faq {
  padding: 96px 80px;
  background: #F4F2EC;
}
.cfz-faq-inner {
  max-width: 980px;
  margin: 0 auto;
}
.cfz-faq-head {
  text-align: center;
  margin-bottom: 56px;
}
.cfz-faq-list {
  display: flex;
  flex-direction: column;
}
.cfz-faq-item {
  border-bottom: 1px solid #E7E6E2;
}
.cfz-faq-item.first {
  border-top: 1px solid #E7E6E2;
}
.cfz-faq-q {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  width: 100%;
  padding: 24px 4px;
  background: transparent;
  border: none;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  font-size: 19px;
  font-weight: 700;
  color: #1F1F1F;
}
.cfz-faq-chev {
  color: #8A8A8A;
  flex-shrink: 0;
  transition: transform 0.2s;
}
.cfz-faq-chev.open {
  transform: rotate(180deg);
}
.cfz-faq-a {
  overflow: hidden;
  max-height: 0;
  transition: max-height 0.3s ease-in-out;
}
.cfz-faq-a.open {
  max-height: 260px;
}
.cfz-faq-a p {
  font-size: 16px;
  color: #5B5B5B;
  padding: 0 4px 24px;
  max-width: 760px;
}

/* ─── Form ───────────────────────────────────────────────────────── */
.cfz-form-section {
  padding: 96px 80px;
  background: #1F1F1F;
  color: #fff;
}
.cfz-form-inner {
  max-width: 920px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 56px;
  align-items: center;
}
.cfz-form-title {
  font-size: 48px;
  color: #fff;
  letter-spacing: -0.025em;
}
.cfz-form-plan {
  margin-top: 28px;
  padding: 20px 22px;
  border-radius: 16px;
  background: #2a2a2a;
  border: 1px solid #333;
  display: flex;
  align-items: center;
  gap: 14px;
}
.cfz-form-plan-tick {
  width: 38px;
  height: 38px;
  border-radius: 10px;
  background: #89D136;
  color: #1F1F1F;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.cfz-form-plan-eyebrow {
  font-size: 12px;
  color: #8A8A8A;
  font-weight: 600;
}
.cfz-form-plan-name {
  font-weight: 700;
  font-size: 18px;
}
.cfz-form-empty {
  margin-top: 24px;
  font-size: 16px;
  color: #cfcfcf;
}
.cfz-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.cfz-form-label {
  font-size: 13px;
  color: #ccc;
  font-weight: 600;
}
.cfz-form-input {
  display: block;
  width: 100%;
  margin-top: 6px;
  background: #161616;
  border: 1px solid #2a2a2a;
  color: #fff;
  border-radius: 12px;
  padding: 14px 16px;
  font-size: 16px;
  font-family: inherit;
  outline: none;
  transition: border-color 0.15s;
}
.cfz-form-input:focus {
  border-color: #89D136;
}
.cfz-form-input::placeholder {
  color: #555;
}
.cfz-form-error {
  font-size: 13px;
  color: #ff8b6b;
  font-weight: 600;
}
.cfz-form-ok {
  font-size: 13px;
  color: #89D136;
  font-weight: 600;
}
.cfz-form-submit {
  background: #89D136;
  color: #1F1F1F;
  border: none;
  padding: 16px 22px;
  border-radius: 12px;
  font-weight: 800;
  font-size: 16px;
  cursor: pointer;
  font-family: inherit;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-top: 4px;
  transition: background 0.15s;
}
.cfz-form-submit:hover:not(:disabled) {
  background: #6DAE1E;
}
.cfz-form-submit:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}
.cfz-spinner {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid rgba(31, 31, 31, 0.3);
  border-top-color: #1F1F1F;
  animation: cfz-spin 0.8s linear infinite;
}
@keyframes cfz-spin {
  to { transform: rotate(360deg); }
}
.cfz-form-terms {
  font-size: 11px;
  color: #999;
  margin-top: 4px;
}
.cfz-form-terms a {
  text-decoration: underline;
}

/* ─── Footer ─────────────────────────────────────────────────────── */
.cfz-footer {
  background: #0F0F0F;
  color: #aaa;
  padding: 64px 80px 40px;
}
.cfz-footer-grid {
  max-width: 1400px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: 1.5fr 1fr 1fr 1fr;
  gap: 48px;
}
.cfz-footer-blurb {
  font-size: 14px;
  margin-top: 16px;
  color: #888;
  max-width: 280px;
  line-height: 1.5;
}
.cfz-footer-title {
  font-size: 13px;
  font-weight: 700;
  color: #fff;
  margin-bottom: 14px;
}
.cfz-footer-col ul {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.cfz-footer-col li {
  font-size: 14px;
}
.cfz-footer-bottom {
  max-width: 1400px;
  margin: 56px auto 0;
  padding-top: 24px;
  border-top: 1px solid #222;
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  color: #666;
}

/* ─── Responsive ─────────────────────────────────────────────────── */
@media (max-width: 1200px) {
  .cfz-hero-title { font-size: 84px; }
  .cfz-h2 { font-size: 44px; }
  .cfz-studio-title { font-size: 48px; }
  .cfz-pricing-row { grid-template-columns: 220px 1fr 200px; gap: 24px; }
  .cfz-pricing-row-amount { font-size: 44px; }
  .cfz-features-grid { grid-template-columns: repeat(2, 1fr); }
  .cfz-stats { padding: 24px 40px; }
  .cfz-header-inner { padding: 16px 40px; }
  .cfz-hero-inner,
  .cfz-problems,
  .cfz-features,
  .cfz-studio,
  .cfz-pricing,
  .cfz-testimonials,
  .cfz-faq,
  .cfz-form-section,
  .cfz-footer { padding-left: 40px; padding-right: 40px; }
}

@media (max-width: 980px) {
  .cfz-hero-inner { grid-template-columns: 1fr; padding: 64px 24px 80px; gap: 48px; }
  .cfz-hero-title { font-size: 64px; }
  .cfz-hero-visual { order: 2; }
  .cfz-stats { grid-template-columns: repeat(2, 1fr); padding: 24px; gap: 24px; }
  .cfz-h2 { font-size: 32px; }
  .cfz-problems,
  .cfz-features,
  .cfz-studio,
  .cfz-pricing,
  .cfz-testimonials,
  .cfz-faq,
  .cfz-form-section { padding: 64px 24px; }
  .cfz-problems-grid,
  .cfz-features-grid,
  .cfz-testimonials-grid { grid-template-columns: 1fr; }
  .cfz-studio-grid { grid-template-columns: 1fr; gap: 48px; }
  .cfz-studio-title { font-size: 40px; }
  .cfz-form-inner { grid-template-columns: 1fr; gap: 32px; }
  .cfz-form-title { font-size: 32px; }
  .cfz-pricing-row { grid-template-columns: 1fr; gap: 20px; padding: 28px 24px; }
  .cfz-footer-grid { grid-template-columns: 1fr 1fr; }
  .cfz-footer { padding: 48px 24px 32px; }
  .cfz-footer-bottom { flex-direction: column; gap: 8px; }
  .cfz-header-inner { padding: 14px 20px; }
  .cfz-nav { display: none; }
  .cfz-header-cta .cfz-header-login { display: none; }
  .cfz-btn-lg { padding: 16px 22px; font-size: 15px; }
}

@media (max-width: 600px) {
  .cfz-hero-title { font-size: 48px; }
  .cfz-phone { width: 280px; height: 520px; }
  .cfz-float-tag-ia { top: 16px; left: -8px; }
  .cfz-float-tag-edit { bottom: 40px; right: -8px; }
  .cfz-stats { grid-template-columns: 1fr 1fr; }
  .cfz-studio-pair { grid-template-columns: 1fr; }
  .cfz-polaroid { display: none; }
  .cfz-footer-grid { grid-template-columns: 1fr; }
}
</style>
