<template>
  <div class="cz-page">
    <div class="cz-page-inner">
    <!-- Page head -->
    <div class="cz-page-head">
      <div>
        <h1 class="cz-page-title">Cobranças</h1>
        <p class="cz-page-sub">Gerencie seu plano, módulos e faturas em um só lugar.</p>
      </div>
      <button class="cz-btn cz-btn-soft cz-btn-lg" @click="openUpgrade">
        <i class="bi bi-stars"></i> Ver planos
      </button>
    </div>

    <!-- Overdue alert -->
    <div v-if="overdueInvoices.length" class="cz-alert">
      <div class="cz-a-icon"><i class="bi bi-exclamation-triangle"></i></div>
      <div class="cz-a-body">
        <div class="cz-a-title">
          Você tem {{ overdueInvoices.length }} fatura{{ overdueInvoices.length > 1 ? 's' : '' }} vencida{{ overdueInvoices.length > 1 ? 's' : '' }}
        </div>
        <div class="cz-a-text">
          A fatura {{ invoiceDescription(overdueInvoices[0]) }} venceu em {{ formatDate(overdueInvoices[0].dueDate) }}.
          Regularize para evitar a suspensão dos serviços.
        </div>
      </div>
      <button class="cz-btn cz-btn-danger" @click="openPay(overdueInvoices[0])">Pagar agora</button>
    </div>

    <div class="cz-stack">
      <!-- Plan summary -->
      <div v-if="loadingDash" class="cz-card cz-loading"><span class="spinner-border spinner-border-sm"></span></div>
      <div v-else-if="dashboard.plan" class="cz-card cz-plan-card">
        <div class="cz-plan-main">
          <div class="cz-plan-eyebrow">Seu plano</div>
          <div class="cz-plan-name">
            {{ dashboard.plan.name }}
            <span class="cz-pill" :class="planStatusMeta.pill"><span class="cz-dot"></span>{{ planStatusMeta.label }}</span>
          </div>
          <div class="cz-plan-price">{{ planPriceLine }}</div>
          <ul class="cz-plan-feat">
            <li v-for="f in planFeatures" :key="f"><i class="bi bi-check-lg cz-ck"></i> {{ f }}</li>
          </ul>
        </div>
        <div class="cz-plan-side">
          <div v-for="u in usageRows" :key="u.label" class="cz-usage-row">
            <div class="cz-usage-label"><span>{{ u.label }}</span><span>{{ u.used }} / {{ u.limit }}</span></div>
            <div class="cz-bar" :class="{ 'cz-warnbar': u.pct >= 90 }"><span :style="{ width: u.pct + '%' }"></span></div>
          </div>
          <button class="cz-btn cz-btn-primary cz-btn-block cz-btn-lg" style="margin-top: auto" @click="openUpgrade">
            <i class="bi bi-stars"></i> Fazer upgrade de plano
          </button>
          <div class="cz-plan-side-note">Desbloqueie módulos sem pagar à parte</div>
        </div>
      </div>
      <div v-else class="cz-card cz-plan-card">
        <div class="cz-plan-main">
          <div class="cz-plan-eyebrow">Seu plano</div>
          <div class="cz-plan-name">Nenhum plano ativo</div>
          <div class="cz-plan-price">Escolha um plano para liberar os recursos da plataforma.</div>
        </div>
        <div class="cz-plan-side">
          <button class="cz-btn cz-btn-primary cz-btn-block cz-btn-lg" style="margin-top: auto" @click="openUpgrade">
            <i class="bi bi-stars"></i> Ver planos
          </button>
        </div>
      </div>

      <!-- Active subscriptions -->
      <div class="cz-card">
        <div class="cz-card-head">
          <h3>Assinaturas ativas</h3>
          <span class="cz-hint" v-if="modulesMonthlyTotal > 0">{{ brl(modulesMonthlyTotal) }}/mês em módulos</span>
        </div>
        <div v-if="loadingDash" class="cz-loading"><span class="spinner-border spinner-border-sm"></span></div>
        <template v-else>
          <div v-if="dashboard.plan" class="cz-sub-row">
            <div class="cz-sub-ic" style="background: var(--cz-success-soft); color: #1e7a30"><i class="bi bi-journal-text"></i></div>
            <div class="cz-sub-meta">
              <div class="cz-sub-name">
                {{ dashboard.plan.name }}
                <span class="cz-pill cz-pill-success"><span class="cz-dot"></span>Plano atual</span>
              </div>
              <div class="cz-sub-desc">Plano base da conta</div>
            </div>
            <div class="cz-sub-right">
              <div class="cz-sub-amt">{{ Number(dashboard.plan.price) === 0 ? 'Incluído' : `${brl(dashboard.plan.price)}/mês` }}</div>
              <div v-if="dashboard.plan.nextDueAt" class="cz-sub-next">Próx: {{ formatDate(dashboard.plan.nextDueAt) }}</div>
            </div>
          </div>
          <div v-for="ms in dashboard.moduleSubscriptions" :key="ms.id" class="cz-sub-row">
            <div class="cz-sub-ic" style="background: var(--cz-info-soft); color: #0d6f99"><i :class="moduleIcon(ms.moduleKey)"></i></div>
            <div class="cz-sub-meta">
              <div class="cz-sub-name">
                {{ ms.moduleName }}
                <span class="cz-pill cz-pill-info"><span class="cz-dot"></span>{{ periodLabel(ms.period) }}</span>
              </div>
              <div class="cz-sub-desc">Cobrança {{ periodLabel(ms.period).toLowerCase() }} recorrente</div>
            </div>
            <div class="cz-sub-right">
              <div class="cz-sub-amt">{{ ms.amount != null ? `${brl(ms.amount)}/${periodSuffix(ms.period)}` : '—' }}</div>
              <div v-if="ms.nextDueAt" class="cz-sub-next">Próx: {{ formatDate(ms.nextDueAt) }}</div>
            </div>
          </div>
          <div v-if="!dashboard.plan && !dashboard.moduleSubscriptions.length" class="cz-empty">Nenhuma assinatura ativa.</div>
        </template>
      </div>

      <!-- Invoices -->
      <div class="cz-card">
        <div class="cz-card-head">
          <h3>Faturas</h3>
          <button class="cz-btn cz-btn-ghost cz-btn-sm" @click="exportCsv"><i class="bi bi-download"></i> Exportar</button>
        </div>
        <div class="cz-filters">
          <div class="cz-seg">
            <button v-for="f in FILTERS" :key="f.id" :class="{ on: filter === f.id }" @click="filter = f.id">
              {{ f.label }} <span class="cz-count">{{ counts[f.id] }}</span>
            </button>
          </div>
        </div>
        <div v-if="loadingInvoices" class="cz-loading"><span class="spinner-border spinner-border-sm"></span></div>
        <div v-else class="cz-tbl">
          <div class="cz-thead">
            <span>Descrição</span>
            <span class="cz-right">Valor</span>
            <span>Vencimento</span>
            <span>Status</span>
            <span class="cz-right">Ação</span>
          </div>
          <div v-if="!filteredInvoices.length" class="cz-empty">Nenhuma fatura nesta categoria.</div>
          <div v-for="inv in filteredInvoices" :key="inv.id" class="cz-trow">
            <div class="cz-inv-desc">
              <div class="cz-inv-ic"><i class="bi bi-receipt"></i></div>
              <div>
                <div class="cz-inv-title">{{ invoiceDescription(inv) }}</div>
                <div class="cz-inv-id">#{{ shortId(inv.id) }}</div>
              </div>
            </div>
            <div class="cz-inv-val cz-right">{{ brl(inv.amount) }}</div>
            <div class="cz-inv-date cz-col-date">{{ formatDate(inv.dueDate) }}</div>
            <div class="cz-col-status">
              <span class="cz-pill" :class="statusMeta(inv).pill"><span class="cz-dot"></span>{{ statusMeta(inv).label }}</span>
            </div>
            <div class="cz-right">
              <button v-if="isPayable(inv)"
                      class="cz-btn cz-btn-sm"
                      :class="displayStatus(inv) === 'overdue' ? 'cz-btn-danger' : 'cz-btn-primary'"
                      @click="openPay(inv)">Pagar</button>
              <button v-else class="cz-btn cz-btn-ghost cz-btn-sm" title="Baixar recibo" @click="downloadReceipt(inv)">
                <i class="bi bi-download"></i>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
    </div><!-- /cz-page-inner -->

    <!-- Pay modal -->
    <div v-if="payInvoice" class="cz-overlay" @click="payInvoice = null">
      <div class="cz-modal cz-modal-pay" @click.stop>
        <div class="cz-modal-head">
          <div>
            <h2>Pagar fatura</h2>
            <p>{{ invoiceDescription(payInvoice) }} · #{{ shortId(payInvoice.id) }}</p>
          </div>
          <button class="cz-icon-btn" @click="payInvoice = null"><i class="bi bi-x-lg"></i></button>
        </div>
        <div class="cz-modal-body">
          <div class="cz-pay-amount">
            <div class="cz-v">{{ brl(payInvoice.amount) }}</div>
            <div class="cz-l">Vencimento {{ formatDate(payInvoice.dueDate) }}</div>
          </div>
          <div class="cz-info-box">
            <i class="bi bi-info-circle"></i>
            <span>Você será redirecionado para o checkout seguro, com opções de <b>PIX</b> e <b>cartão</b>.</span>
          </div>
        </div>
        <div class="cz-modal-foot">
          <div class="cz-secure-note"><i class="bi bi-lock"></i> Pagamento seguro</div>
          <button class="cz-btn cz-btn-primary cz-btn-lg" :disabled="paying" @click="confirmPay">
            <span v-if="paying" class="spinner-border spinner-border-sm"></span>
            Pagar {{ brl(payInvoice.amount) }}
          </button>
        </div>
      </div>
    </div>

    <!-- Upgrade modal: plan comparison -->
    <div v-if="showUpgrade && !selectedPlan && !upgradeDone" class="cz-overlay" @click="closeUpgrade">
      <div class="cz-modal cz-modal-up" @click.stop>
        <div class="cz-modal-head">
          <div>
            <h2>Escolha seu plano</h2>
            <p>Faça upgrade para desbloquear módulos sem cobranças avulsas.</p>
          </div>
          <div class="cz-head-actions">
            <div v-if="hasAnnual" class="cz-bill-toggle">
              <button :class="{ on: cycle === 'monthly' }" @click="cycle = 'monthly'">Mensal</button>
              <button :class="{ on: cycle === 'annual' }" @click="cycle = 'annual'">
                Anual <span v-if="annualSavingsPct > 0" class="cz-save-tag">-{{ annualSavingsPct }}%</span>
              </button>
            </div>
            <button class="cz-icon-btn" @click="closeUpgrade"><i class="bi bi-x-lg"></i></button>
          </div>
        </div>
        <div class="cz-modal-body">
          <div v-if="loadingPlans" class="cz-loading"><span class="spinner-border spinner-border-sm"></span></div>
          <div v-else-if="!plans.length" class="cz-empty">Nenhum plano disponível no momento.</div>
          <div v-else class="cz-plans">
            <div v-for="p in plans" :key="p.id"
                 class="cz-plan"
                 :class="{ 'cz-featured': isFeatured(p), 'cz-current': p.id === currentPlanId }">
              <div v-if="isFeatured(p)" class="cz-plan-tag">Recomendado</div>
              <div class="cz-p-name">{{ p.name }}</div>
              <div class="cz-p-tagline">{{ planTagline(p) }}</div>
              <div class="cz-p-price">
                <span class="cz-p-amt">{{ priceOf(p) === 0 ? 'Grátis' : brl(priceOf(p)) }}</span>
                <span v-if="priceOf(p) > 0" class="cz-p-per">/mês</span>
                <span v-if="cycle === 'annual' && monthlyPriceOf(p) > priceOf(p)" class="cz-p-strike">{{ brl(monthlyPriceOf(p)) }}</span>
              </div>
              <div class="cz-p-annual-note">
                {{ cycle === 'annual' && annualTotalOf(p) > 0 ? `${brl(annualTotalOf(p))} cobrado anualmente` : '' }}
              </div>
              <ul class="cz-p-feat">
                <li v-for="(f, i) in planFeatureList(p)" :key="i" :style="f.in ? null : { color: 'var(--cz-faint)' }">
                  <i :class="f.in ? 'bi bi-check-lg cz-ck' : 'bi bi-x-lg cz-ck cz-muted-ck'"></i>
                  <span :style="f.hl ? { fontWeight: 700, color: 'var(--cz-brand-ink)' } : null">{{ f.t }}</span>
                </li>
              </ul>
              <div class="cz-p-cta">
                <button v-if="p.id === currentPlanId" class="cz-btn cz-btn-ghost cz-btn-block" disabled>Plano atual</button>
                <button v-else class="cz-btn cz-btn-block" :class="isFeatured(p) ? 'cz-btn-primary' : 'cz-btn-soft'" @click="selectedPlan = p">
                  <i class="bi bi-arrow-up"></i> Fazer upgrade
                </button>
              </div>
            </div>
          </div>
        </div>
        <div class="cz-modal-foot">
          <div class="cz-foot-note"><i class="bi bi-info-circle"></i> Você pode mudar ou cancelar o plano quando quiser. Sem fidelidade.</div>
        </div>
      </div>
    </div>

    <!-- Upgrade modal: confirm step -->
    <div v-if="showUpgrade && selectedPlan && !upgradeDone" class="cz-overlay" @click="closeUpgrade">
      <div class="cz-modal cz-modal-pay" @click.stop>
        <div class="cz-modal-head">
          <div>
            <h2>Confirmar upgrade</h2>
            <p>{{ currentPlanName }} → <b style="color: var(--cz-brand-ink)">{{ selectedPlan.name }}</b></p>
          </div>
          <button class="cz-icon-btn" @click="closeUpgrade"><i class="bi bi-x-lg"></i></button>
        </div>
        <div class="cz-modal-body">
          <div style="margin-bottom: 16px">
            <div class="cz-confirm-line"><span class="cz-lbl">Plano</span><span class="cz-val">{{ selectedPlan.name }}</span></div>
            <div class="cz-confirm-line"><span class="cz-lbl">Ciclo de cobrança</span><span class="cz-val">{{ cycle === 'annual' ? 'Anual' : 'Mensal' }}</span></div>
            <div class="cz-confirm-line"><span class="cz-lbl">Valor</span><span class="cz-val">{{ brl(priceOf(selectedPlan)) }}/mês</span></div>
            <div class="cz-confirm-line cz-confirm-total">
              <span class="cz-lbl">Total {{ cycle === 'annual' ? 'hoje (12 meses)' : 'hoje' }}</span>
              <span class="cz-val">{{ brl(totalOf(selectedPlan)) }}</span>
            </div>
          </div>
          <div v-if="upsellSavings.modules.length" class="cz-info-box">
            <i class="bi bi-info-circle"></i>
            <span>
              Inclui <b>{{ upsellSavings.modules.join(' e ') }}</b> — você deixa de pagar
              {{ brl(upsellSavings.total) }}/mês em módulos avulsos.
            </span>
          </div>
        </div>
        <div class="cz-modal-foot">
          <button class="cz-btn cz-btn-ghost" @click="selectedPlan = null">Voltar</button>
          <button class="cz-btn cz-btn-primary cz-btn-lg" :disabled="upgrading" @click="confirmUpgrade">
            <span v-if="upgrading" class="spinner-border spinner-border-sm"></span>
            <i v-else class="bi bi-lock"></i> Confirmar e pagar
          </button>
        </div>
      </div>
    </div>

    <!-- Upgrade modal: success step -->
    <div v-if="showUpgrade && upgradeDone" class="cz-overlay" @click="finishUpgrade">
      <div class="cz-modal cz-modal-pay" @click.stop>
        <div class="cz-modal-body">
          <div class="cz-success-wrap">
            <div class="cz-success-circle"><i class="bi bi-check-circle"></i></div>
            <h3>Upgrade concluído! 🎉</h3>
            <p>Seu plano agora é <b>{{ selectedPlan?.name }}</b>. Os módulos já estão liberados.</p>
          </div>
        </div>
        <div class="cz-modal-foot" style="justify-content: center">
          <button class="cz-btn cz-btn-primary cz-btn-lg" @click="finishUpgrade">Voltar para Cobranças</button>
        </div>
      </div>
    </div>

    <!-- Toasts -->
    <div class="cz-toast-wrap">
      <div v-for="t in toasts" :key="t.id" class="cz-toast">
        <span class="cz-t-ic"><i class="bi bi-check-circle"></i></span>{{ t.msg }}
      </div>
    </div>

    <!-- Payment redirect overlay -->
    <div v-if="redirecting" class="cz-pay-overlay">
      <div class="text-center text-white">
        <div class="spinner-border mb-3" style="width: 3rem; height: 3rem" role="status"></div>
        <div class="fs-5">Iniciando pagamento...</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import api from '../api.js'
import { useAddOnStoreStore } from '../stores/addOnStore.js'

const addOnStore = useAddOnStoreStore()

// ── State ────────────────────────────────────────────────
const loadingDash = ref(true)
const loadingInvoices = ref(true)
const loadingPlans = ref(false)
const dashboard = ref({ plan: null, moduleSubscriptions: [] })
const invoices = ref([])
const filter = ref('all')
const payInvoice = ref(null)
const paying = ref(false)
const redirecting = ref(false)

const showUpgrade = ref(false)
const selectedPlan = ref(null)
const upgradeDone = ref(false)
const upgrading = ref(false)
const cycle = ref('annual')
const plans = ref([])
const currentPlanId = ref(null)
const activeModuleSubs = ref([])

const toasts = ref([])

const FILTERS = [
  { id: 'all', label: 'Todas' },
  { id: 'overdue', label: 'Vencidas' },
  { id: 'pending', label: 'Pendentes' },
  { id: 'paid', label: 'Pagas' },
]

onMounted(() => {
  loadDashboard()
  loadInvoices()
})

// ── Loaders ──────────────────────────────────────────────
async function loadDashboard() {
  loadingDash.value = true
  try {
    const { data } = await api.get('/saas/billing/dashboard')
    dashboard.value = { moduleSubscriptions: [], ...data }
  } catch (e) {
    console.error(e)
  } finally {
    loadingDash.value = false
  }
}

async function loadInvoices() {
  loadingInvoices.value = true
  try {
    const { data } = await api.get('/saas/invoices', { params: { mine: true, pageSize: 200 } })
    invoices.value = data.rows || data.invoices || data
  } catch (e) {
    console.error(e)
  } finally {
    loadingInvoices.value = false
  }
}

async function loadPlans() {
  loadingPlans.value = true
  try {
    const { data } = await api.get('/saas/plans/available')
    plans.value = data.plans || []
    currentPlanId.value = data.currentPlanId
    activeModuleSubs.value = data.activeModuleSubscriptions || []
  } catch (e) {
    console.error(e)
  } finally {
    loadingPlans.value = false
  }
}

// ── Formatters / helpers ─────────────────────────────────
const brl = (n) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const formatDate = (d) => (d ? new Date(d).toLocaleDateString('pt-BR') : '-')
const shortId = (id) => String(id).replace(/-/g, '').slice(0, 8).toUpperCase()

function invoiceDescription(inv) {
  if (inv.items?.length) return inv.items.map((i) => i.description).join(', ')
  return `Fatura ${inv.month}/${inv.year}`
}

function displayStatus(inv) {
  if (inv.status === 'PAID') return 'paid'
  if (inv.status === 'OVERDUE') return 'overdue'
  if (inv.dueDate && new Date(inv.dueDate) < new Date()) return 'overdue'
  return 'pending'
}

const STATUS_META = {
  overdue: { label: 'Vencida', pill: 'cz-pill-danger' },
  pending: { label: 'Pendente', pill: 'cz-pill-warn' },
  paid: { label: 'Paga', pill: 'cz-pill-success' },
}
const statusMeta = (inv) => STATUS_META[displayStatus(inv)]
const isPayable = (inv) => displayStatus(inv) !== 'paid'

const periodLabel = (p) => ({ MONTHLY: 'Mensal', ANNUAL: 'Anual', QUARTERLY: 'Trimestral', BIMONTHLY: 'Bimestral' }[String(p || '').toUpperCase()] || 'Mensal')
const periodSuffix = (p) => (String(p || '').toUpperCase() === 'ANNUAL' ? 'ano' : 'mês')

const MODULE_ICONS = {
  CARDAPIO_SIMPLES: 'bi bi-journal-text',
  CARDAPIO_COMPLETO: 'bi bi-layers',
  RIDERS: 'bi bi-truck',
  AFFILIATES: 'bi bi-people',
  STOCK: 'bi bi-box-seam',
  CASHBACK: 'bi bi-cash-coin',
  COUPONS: 'bi bi-ticket-percent',
  WHATSAPP: 'bi bi-whatsapp',
  FINANCIAL: 'bi bi-wallet2',
  FISCAL: 'bi bi-receipt',
  CUSTOM_DOMAIN: 'bi bi-globe',
  MARKETING_CAMPAIGNS: 'bi bi-megaphone',
}
const moduleIcon = (key) => MODULE_ICONS[key] || 'bi bi-puzzle'

// ── Invoices: filters / counts ───────────────────────────
const counts = computed(() => ({
  all: invoices.value.length,
  overdue: invoices.value.filter((i) => displayStatus(i) === 'overdue').length,
  pending: invoices.value.filter((i) => displayStatus(i) === 'pending').length,
  paid: invoices.value.filter((i) => displayStatus(i) === 'paid').length,
}))
const filteredInvoices = computed(() =>
  filter.value === 'all' ? invoices.value : invoices.value.filter((i) => displayStatus(i) === filter.value)
)
const overdueInvoices = computed(() => invoices.value.filter((i) => displayStatus(i) === 'overdue'))

// ── Plan summary ─────────────────────────────────────────
const PLAN_STATUS_META = {
  ACTIVE: { label: 'Ativo', pill: 'cz-pill-neutral' },
  SUSPENDED: { label: 'Suspenso', pill: 'cz-pill-danger' },
  CANCELED: { label: 'Cancelado', pill: 'cz-pill-danger' },
}
const planStatusMeta = computed(() => PLAN_STATUS_META[dashboard.value.plan?.status] || PLAN_STATUS_META.ACTIVE)

const planPriceLine = computed(() => {
  const p = dashboard.value.plan
  if (!p) return ''
  const price = Number(p.price || 0)
  if (price === 0) return 'Gratuito · módulos cobrados à parte'
  return `${brl(price)}/mês`
})

const planFeatures = computed(() => {
  const p = dashboard.value.plan
  if (!p) return []
  const feats = (p.modules || []).map((m) => m.name)
  const u = p.usage || {}
  if (u.menus) feats.push(u.menus.unlimited ? 'Cardápios ilimitados' : `Até ${u.menus.limit} cardápio${u.menus.limit > 1 ? 's' : ''}`)
  if (u.stores) feats.push(u.stores.unlimited ? 'Lojas ilimitadas' : `${u.stores.limit} loja${u.stores.limit > 1 ? 's' : ''}`)
  if (u.aiCredits) feats.push(u.aiCredits.unlimited ? 'Créditos de IA ilimitados' : `${u.aiCredits.monthlyLimit} créditos de IA/mês`)
  return feats.slice(0, 8)
})

const usageRows = computed(() => {
  const u = dashboard.value.plan?.usage
  if (!u) return []
  const rows = []
  const push = (label, item) => {
    if (!item || item.unlimited || item.limit == null) return
    const pct = Math.min(100, Math.round((item.used / Math.max(1, item.limit)) * 100))
    rows.push({ label, used: item.used, limit: item.limit, pct })
  }
  push('Cardápios', u.menus)
  push('Lojas', u.stores)
  push('Números de WhatsApp', u.whatsapps)
  if (!rows.length && u.aiCredits && !u.aiCredits.unlimited && u.aiCredits.monthlyLimit > 0) {
    const used = Math.max(0, u.aiCredits.monthlyLimit - u.aiCredits.balance)
    rows.push({ label: 'Créditos de IA', used, limit: u.aiCredits.monthlyLimit, pct: Math.min(100, Math.round((used / u.aiCredits.monthlyLimit) * 100)) })
  }
  return rows
})

const modulesMonthlyTotal = computed(() =>
  dashboard.value.moduleSubscriptions.reduce((s, ms) => {
    const amt = Number(ms.amount || 0)
    return s + (String(ms.period).toUpperCase() === 'ANNUAL' ? amt / 12 : amt)
  }, 0)
)

// ── Upgrade modal ────────────────────────────────────────
const currentPlanName = computed(() => dashboard.value.plan?.name || 'Plano atual')

function openUpgrade() {
  showUpgrade.value = true
  selectedPlan.value = null
  upgradeDone.value = false
  if (!plans.value.length) loadPlans()
}
function closeUpgrade() {
  showUpgrade.value = false
  selectedPlan.value = null
  upgradeDone.value = false
}
function finishUpgrade() {
  closeUpgrade()
  loadDashboard()
  loadInvoices()
}

const findPrice = (p, period) => {
  const pr = (p.prices || []).find((x) => String(x.period).toUpperCase() === period)
  return pr ? Number(pr.price) : null
}
const monthlyPriceOf = (p) => {
  const m = findPrice(p, 'MONTHLY')
  return m != null ? m : Number(p.price || 0)
}
const annualTotalOf = (p) => {
  const a = findPrice(p, 'ANNUAL')
  return a != null ? a : 0
}
// Displayed price per month for the selected cycle
function priceOf(p) {
  if (cycle.value === 'annual') {
    const a = annualTotalOf(p)
    if (a > 0) return a / 12
  }
  return monthlyPriceOf(p)
}
const totalOf = (p) => (cycle.value === 'annual' && annualTotalOf(p) > 0 ? annualTotalOf(p) : monthlyPriceOf(p))

const hasAnnual = computed(() => plans.value.some((p) => annualTotalOf(p) > 0))
const annualSavingsPct = computed(() => {
  let best = 0
  for (const p of plans.value) {
    const m = monthlyPriceOf(p)
    const a = annualTotalOf(p)
    if (m > 0 && a > 0) best = Math.max(best, Math.round((1 - a / 12 / m) * 100))
  }
  return best
})

function isFeatured(p) {
  if (p.id === currentPlanId.value) return false
  const def = plans.value.find((x) => x.isDefault && x.id !== currentPlanId.value)
  if (def) return p.id === def.id
  // fallback: cheapest paid plan that isn't the current one
  const paid = plans.value.filter((x) => x.id !== currentPlanId.value && monthlyPriceOf(x) > 0)
  return paid.length ? p.id === paid[0].id : false
}

function planTagline(p) {
  if (monthlyPriceOf(p) === 0) return 'Para começar a vender online sem custo fixo.'
  if (p.unlimitedStores || p.unlimitedMenus) return 'Para redes e operações de alto volume.'
  return 'Tudo que um delivery em crescimento precisa.'
}

// Feature list per plan: own modules (✓, highlighting paid add-ons it absorbs)
// + limits, then modules other plans have and this one lacks (✗)
function planFeatureList(p) {
  const ownKeys = new Set((p.modules || []).map((m) => m.key))
  const paidAddOnKeys = new Set(activeModuleSubs.value.map((s) => s.key))
  const feats = (p.modules || []).map((m) => ({ t: m.name, in: true, hl: paidAddOnKeys.has(m.key) && p.id !== currentPlanId.value }))

  feats.push({ t: p.unlimitedMenus || p.menuLimit == null ? 'Cardápios ilimitados' : `Até ${p.menuLimit} cardápio${p.menuLimit > 1 ? 's' : ''}`, in: true })
  feats.push({ t: p.unlimitedStores || p.storeLimit == null ? 'Lojas ilimitadas' : `${p.storeLimit} loja${p.storeLimit > 1 ? 's' : ''}`, in: true })
  feats.push({ t: p.unlimitedAiCredits ? 'Créditos de IA ilimitados' : `${p.aiCreditsMonthlyLimit} créditos de IA/mês`, in: true })

  const missing = new Map()
  for (const other of plans.value) {
    for (const m of other.modules || []) {
      if (!ownKeys.has(m.key) && !missing.has(m.key)) missing.set(m.key, m.name)
    }
  }
  for (const name of missing.values()) feats.push({ t: name, in: false })
  return feats.slice(0, 9)
}

// Add-ons currently paid separately that the selected plan would absorb
const upsellSavings = computed(() => {
  const p = selectedPlan.value
  if (!p) return { modules: [], total: 0 }
  const ownKeys = new Set((p.modules || []).map((m) => m.key))
  const absorbed = activeModuleSubs.value.filter((s) => s.key && ownKeys.has(s.key))
  const total = absorbed.reduce((sum, s) => {
    const amt = Number(s.price || 0)
    return sum + (String(s.period).toUpperCase() === 'ANNUAL' ? amt / 12 : amt)
  }, 0)
  return { modules: absorbed.map((s) => s.name), total }
})

async function confirmUpgrade() {
  if (!selectedPlan.value) return
  upgrading.value = true
  try {
    const period = cycle.value === 'annual' && annualTotalOf(selectedPlan.value) > 0 ? 'ANNUAL' : 'MONTHLY'
    const result = await addOnStore.subscribeToPlan(selectedPlan.value.id, period)
    if (result?.checkoutUrl) return // redirecting to gateway
    if (result?.free) {
      upgradeDone.value = true
    } else if (result?.manual) {
      toast(result.message || 'Fatura gerada. Efetue o pagamento na lista de faturas.')
      closeUpgrade()
      loadInvoices()
      loadDashboard()
    } else {
      upgradeDone.value = true
    }
  } catch (e) {
    toast(e.response?.data?.message || 'Erro ao processar upgrade')
  } finally {
    upgrading.value = false
  }
}

// ── Payment ──────────────────────────────────────────────
function openPay(inv) {
  payInvoice.value = inv
}

async function confirmPay() {
  if (!payInvoice.value) return
  paying.value = true
  try {
    redirecting.value = true
    const result = await addOnStore.payInvoice(payInvoice.value.id)
    if (result?.checkoutUrl) return // redirecting
    redirecting.value = false
    if (result?.manual) {
      toast('Pagamento manual. Entre em contato com o administrador.')
    }
    payInvoice.value = null
  } catch (e) {
    redirecting.value = false
    toast(e.response?.data?.message || 'Erro ao processar pagamento')
  } finally {
    paying.value = false
  }
}

// ── Export / receipt ─────────────────────────────────────
function exportCsv() {
  const header = 'Descricao;Valor;Vencimento;Status'
  const lines = filteredInvoices.value.map((i) =>
    [invoiceDescription(i), Number(i.amount).toFixed(2).replace('.', ','), formatDate(i.dueDate), statusMeta(i).label].join(';')
  )
  downloadFile(`faturas-${new Date().toISOString().slice(0, 10)}.csv`, [header, ...lines].join('\n'))
}

function downloadReceipt(inv) {
  const content = [
    'RECIBO DE PAGAMENTO',
    `Fatura: #${shortId(inv.id)}`,
    `Descrição: ${invoiceDescription(inv)}`,
    `Valor: ${brl(inv.amount)}`,
    `Vencimento: ${formatDate(inv.dueDate)}`,
    `Pago em: ${formatDate(inv.paidAt)}`,
  ].join('\n')
  downloadFile(`recibo-${shortId(inv.id)}.txt`, content)
}

function downloadFile(name, content) {
  const blob = new Blob(['﻿' + content], { type: 'text/plain;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  URL.revokeObjectURL(a.href)
}

// ── Toasts ───────────────────────────────────────────────
function toast(msg) {
  const id = Date.now() + Math.random()
  toasts.value.push({ id, msg })
  setTimeout(() => {
    toasts.value = toasts.value.filter((t) => t.id !== id)
  }, 3200)
}
</script>

<style>
@import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap');
</style>

<style scoped>
/* ============ Design tokens (Cobranças template) ============ */
.cz-page {
  --cz-bg: #f2f5f7;
  --cz-surface: #ffffff;
  --cz-surface-2: #f7f9fa;
  --cz-border: #e6ebef;
  --cz-border-strong: #d6dde2;
  --cz-ink: #16222c;
  --cz-ink-2: #3c4a55;
  --cz-muted: #6c7a85;
  --cz-faint: #98a4ad;

  --cz-brand: #5ea829;
  --cz-brand-ink: #4a8a1f;
  --cz-brand-dark: #437f1d;
  --cz-brand-soft: #eef6e5;
  --cz-brand-soft-border: #d8ecc4;

  --cz-info: #1798cf;
  --cz-info-soft: #e4f4fb;
  --cz-danger: #df433d;
  --cz-danger-soft: #fde9e8;
  --cz-danger-dark: #c0352f;
  --cz-warn: #cf8500;
  --cz-warn-soft: #fcf1da;
  --cz-success: #2f9e44;
  --cz-success-soft: #e7f5ea;

  --cz-radius: 14px;
  --cz-shadow-sm: 0 1px 2px rgba(22, 34, 44, 0.05), 0 1px 3px rgba(22, 34, 44, 0.04);
  --cz-shadow-lg: 0 24px 60px rgba(22, 34, 44, 0.2), 0 6px 18px rgba(22, 34, 44, 0.1);

  font-family: 'Manrope', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  background: var(--cz-bg);
  color: var(--cz-ink);
  -webkit-font-smoothing: antialiased;
  width: 100%;
  min-height: 100%;
}
.cz-page-inner { max-width: 1080px; margin: 0 auto; width: 100%; padding: 30px 26px 64px; }

.cz-stack { display: flex; flex-direction: column; gap: 18px; }
.cz-loading { padding: 40px; text-align: center; color: var(--cz-muted); }

/* ---------- Header ---------- */
.cz-page-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; margin-bottom: 22px; flex-wrap: wrap; }
.cz-page-title { font-size: 26px; font-weight: 800; letter-spacing: -0.025em; margin: 0; }
.cz-page-sub { color: var(--cz-muted); font-size: 14px; margin: 5px 0 0; font-weight: 500; }

/* ---------- Generic card ---------- */
.cz-card { background: var(--cz-surface); border: 1px solid var(--cz-border); border-radius: var(--cz-radius); box-shadow: var(--cz-shadow-sm); }
.cz-card-head { display: flex; align-items: center; justify-content: space-between; padding: 18px 22px; border-bottom: 1px solid var(--cz-border); }
.cz-card-head h3 { margin: 0; font-size: 15px; font-weight: 700; letter-spacing: -0.01em; }
.cz-card-head .cz-hint { font-size: 12.5px; color: var(--cz-faint); font-weight: 600; }

/* ---------- Alert ---------- */
.cz-alert {
  display: flex; align-items: center; gap: 14px; padding: 15px 18px; border-radius: var(--cz-radius);
  background: var(--cz-danger-soft); border: 1px solid #f6cdca; margin-bottom: 18px;
}
.cz-a-icon { width: 38px; height: 38px; border-radius: 10px; background: #fff; color: var(--cz-danger); display: grid; place-items: center; flex-shrink: 0; box-shadow: var(--cz-shadow-sm); font-size: 18px; }
.cz-a-body { flex: 1; }
.cz-a-title { font-weight: 700; font-size: 14.5px; color: var(--cz-danger-dark); }
.cz-a-text { font-size: 13px; color: #8f3b37; margin-top: 1px; font-weight: 500; }

/* ---------- Buttons ---------- */
.cz-btn {
  font-family: inherit; font-weight: 700; font-size: 14px; border-radius: 10px; padding: 10px 18px;
  border: 1px solid transparent; cursor: pointer; transition: 0.15s; display: inline-flex; align-items: center;
  gap: 8px; justify-content: center; white-space: nowrap; line-height: 1;
}
.cz-btn-primary { background: var(--cz-brand); color: #fff; box-shadow: 0 2px 5px rgba(94, 168, 41, 0.3); }
.cz-btn-primary:hover { background: var(--cz-brand-ink); }
.cz-btn-danger { background: var(--cz-danger); color: #fff; box-shadow: 0 2px 5px rgba(223, 67, 61, 0.3); }
.cz-btn-danger:hover { background: var(--cz-danger-dark); }
.cz-btn-ghost { background: var(--cz-surface); color: var(--cz-ink-2); border-color: var(--cz-border-strong); }
.cz-btn-ghost:hover { background: var(--cz-surface-2); border-color: var(--cz-muted); }
.cz-btn-soft { background: var(--cz-brand-soft); color: var(--cz-brand-ink); border-color: var(--cz-brand-soft-border); }
.cz-btn-soft:hover { background: #e6f2d8; }
.cz-btn-sm { padding: 7px 13px; font-size: 13px; border-radius: 8px; }
.cz-btn-lg { padding: 13px 22px; font-size: 15px; }
.cz-btn-block { width: 100%; }
.cz-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.cz-icon-btn {
  width: 36px; height: 36px; border-radius: 9px; border: 1px solid var(--cz-border); background: var(--cz-surface);
  display: grid; place-items: center; color: var(--cz-muted); cursor: pointer; transition: 0.15s;
}
.cz-icon-btn:hover { background: var(--cz-surface-2); color: var(--cz-ink-2); }

/* ---------- Pills ---------- */
.cz-pill {
  display: inline-flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 700; letter-spacing: 0.03em;
  text-transform: uppercase; padding: 3px 9px; border-radius: 999px; line-height: 1.4; white-space: nowrap;
}
.cz-pill .cz-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.cz-pill-info { background: var(--cz-info-soft); color: #0d6f99; }
.cz-pill-success { background: var(--cz-success-soft); color: #1e7a30; }
.cz-pill-danger { background: var(--cz-danger-soft); color: var(--cz-danger-dark); }
.cz-pill-warn { background: var(--cz-warn-soft); color: #9a6400; }
.cz-pill-neutral { background: #eef1f3; color: var(--cz-muted); }

/* ---------- Plan summary ---------- */
.cz-plan-card { display: grid; grid-template-columns: 1.4fr 1fr; gap: 0; overflow: hidden; }
.cz-plan-main { padding: 24px; }
.cz-plan-side { background: linear-gradient(160deg, #f9fbf6, #f1f7e9); border-left: 1px solid var(--cz-border); padding: 24px; display: flex; flex-direction: column; gap: 14px; }
.cz-plan-eyebrow { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: var(--cz-brand-ink); }
.cz-plan-name { font-size: 24px; font-weight: 800; letter-spacing: -0.02em; margin: 6px 0 2px; display: flex; align-items: center; gap: 10px; }
.cz-plan-price { font-size: 14px; color: var(--cz-muted); font-weight: 600; }
.cz-plan-feat { list-style: none; margin: 18px 0 0; padding: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 10px 18px; }
.cz-plan-feat li { display: flex; align-items: center; gap: 8px; font-size: 13.5px; color: var(--cz-ink-2); font-weight: 500; }
.cz-ck { color: var(--cz-brand); flex-shrink: 0; }
.cz-plan-side-note { font-size: 12px; color: var(--cz-muted); text-align: center; font-weight: 600; }
.cz-usage-row + .cz-usage-row { margin-top: 4px; }
.cz-usage-label { display: flex; justify-content: space-between; font-size: 12.5px; font-weight: 600; color: var(--cz-ink-2); margin-bottom: 6px; white-space: nowrap; }
.cz-usage-label span:last-child { color: var(--cz-muted); }
.cz-bar { height: 7px; border-radius: 999px; background: #e5eae0; overflow: hidden; }
.cz-bar > span { display: block; height: 100%; border-radius: 999px; background: var(--cz-brand); }
.cz-bar.cz-warnbar > span { background: var(--cz-warn); }

/* ---------- Subscriptions list ---------- */
.cz-sub-row { display: flex; align-items: center; gap: 14px; padding: 15px 22px; }
.cz-sub-row + .cz-sub-row { border-top: 1px solid var(--cz-border); }
.cz-sub-ic { width: 40px; height: 40px; border-radius: 10px; display: grid; place-items: center; flex-shrink: 0; font-size: 19px; }
.cz-sub-meta { flex: 1; min-width: 0; }
.cz-sub-name { font-weight: 700; font-size: 14.5px; display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }
.cz-sub-desc { font-size: 12.5px; color: var(--cz-muted); margin-top: 2px; font-weight: 500; }
.cz-sub-right { text-align: right; flex-shrink: 0; }
.cz-sub-amt { font-weight: 700; font-size: 14.5px; }
.cz-sub-next { font-size: 12px; color: var(--cz-faint); margin-top: 2px; font-weight: 600; }

/* ---------- Invoices table ---------- */
.cz-filters { display: flex; align-items: center; gap: 8px; padding: 14px 22px; border-bottom: 1px solid var(--cz-border); flex-wrap: wrap; }
.cz-seg { display: inline-flex; background: var(--cz-surface-2); border: 1px solid var(--cz-border); border-radius: 10px; padding: 3px; gap: 2px; }
.cz-seg button {
  font-family: inherit; border: 0; background: transparent; font-size: 13px; font-weight: 600; color: var(--cz-muted);
  padding: 6px 13px; border-radius: 7px; cursor: pointer; transition: 0.12s; display: inline-flex; align-items: center; gap: 6px;
}
.cz-seg button:hover { color: var(--cz-ink-2); }
.cz-seg button.on { background: var(--cz-surface); color: var(--cz-ink); box-shadow: var(--cz-shadow-sm); }
.cz-seg .cz-count { font-size: 11px; font-weight: 700; background: #e4e9ed; color: var(--cz-muted); border-radius: 999px; padding: 1px 6px; }
.cz-seg button.on .cz-count { background: var(--cz-brand-soft); color: var(--cz-brand-ink); }

.cz-tbl { width: 100%; }
.cz-thead { display: grid; grid-template-columns: 1fr 130px 150px 130px 110px; gap: 12px; padding: 11px 22px; }
.cz-thead span { font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--cz-faint); }
.cz-thead .cz-right, .cz-trow .cz-right { text-align: right; justify-content: flex-end; }
.cz-trow {
  display: grid; grid-template-columns: 1fr 130px 150px 130px 110px; gap: 12px; align-items: center;
  padding: 15px 22px; border-top: 1px solid var(--cz-border); transition: background 0.12s;
}
.cz-trow:hover { background: var(--cz-surface-2); }
.cz-inv-desc { display: flex; align-items: center; gap: 12px; }
.cz-inv-desc > div { min-width: 0; }
.cz-inv-ic { width: 36px; height: 36px; border-radius: 9px; background: var(--cz-surface-2); border: 1px solid var(--cz-border); display: grid; place-items: center; color: var(--cz-muted); flex-shrink: 0; }
.cz-inv-title { font-weight: 700; font-size: 14px; line-height: 1.3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cz-inv-id { font-size: 12px; color: var(--cz-faint); font-weight: 600; margin-top: 1px; }
.cz-inv-val { font-weight: 700; font-size: 14.5px; }
.cz-inv-date { font-size: 13.5px; color: var(--cz-ink-2); font-weight: 600; }
.cz-empty { padding: 50px 22px; text-align: center; color: var(--cz-faint); font-weight: 600; font-size: 14px; }

/* ---------- Modal ---------- */
.cz-overlay {
  position: fixed; inset: 0; background: rgba(18, 28, 36, 0.48); backdrop-filter: blur(3px);
  display: grid; place-items: center; z-index: 1100; padding: 24px; animation: cz-fade 0.18s ease;
}
@keyframes cz-fade { from { opacity: 0; } }
@keyframes cz-pop { from { opacity: 0; transform: translateY(12px) scale(0.985); } }
.cz-modal { background: var(--cz-surface, #fff); border-radius: 18px; box-shadow: var(--cz-shadow-lg); width: 100%; animation: cz-pop 0.22s cubic-bezier(0.2, 0.7, 0.3, 1); overflow: hidden; }
.cz-modal-pay { max-width: 440px; }
.cz-modal-up { max-width: 960px; max-height: 92vh; display: flex; flex-direction: column; }
.cz-modal-head { display: flex; align-items: flex-start; justify-content: space-between; padding: 22px 24px; border-bottom: 1px solid var(--cz-border); }
.cz-modal-head h2 { margin: 0; font-size: 19px; font-weight: 800; letter-spacing: -0.02em; }
.cz-modal-head p { margin: 4px 0 0; font-size: 13.5px; color: var(--cz-muted); font-weight: 500; }
.cz-head-actions { display: flex; align-items: center; gap: 14px; }
.cz-modal-body { padding: 24px; overflow-y: auto; }
.cz-modal-foot { padding: 18px 24px; border-top: 1px solid var(--cz-border); display: flex; align-items: center; justify-content: space-between; gap: 12px; background: var(--cz-surface-2); }
.cz-secure-note { display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--cz-muted); font-weight: 600; }
.cz-foot-note { display: flex; align-items: center; gap: 10px; font-size: 13px; color: var(--cz-muted); font-weight: 500; flex: 1; }

/* ---------- Billing toggle ---------- */
.cz-bill-toggle { display: inline-flex; align-items: center; gap: 10px; background: var(--cz-surface-2); border: 1px solid var(--cz-border); border-radius: 999px; padding: 4px; }
.cz-bill-toggle button { font-family: inherit; border: 0; background: transparent; font-size: 13px; font-weight: 700; color: var(--cz-muted); padding: 7px 15px; border-radius: 999px; cursor: pointer; transition: 0.14s; display: inline-flex; align-items: center; gap: 7px; }
.cz-bill-toggle button.on { background: var(--cz-ink); color: #fff; }
.cz-save-tag { font-size: 10.5px; font-weight: 800; background: var(--cz-brand-soft); color: var(--cz-brand-ink); padding: 2px 7px; border-radius: 999px; }
.cz-bill-toggle button.on .cz-save-tag { background: rgba(255, 255, 255, 0.2); color: #cdebb1; }

/* ---------- Plans grid ---------- */
.cz-plans { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
.cz-plan {
  border: 1.5px solid var(--cz-border); border-radius: 16px; padding: 22px; display: flex; flex-direction: column;
  position: relative; transition: 0.18s; background: var(--cz-surface);
}
.cz-plan.cz-featured { border-color: var(--cz-brand); box-shadow: 0 0 0 4px var(--cz-brand-soft); }
.cz-plan.cz-current { background: var(--cz-surface-2); }
.cz-plan-tag { position: absolute; top: -11px; left: 50%; transform: translateX(-50%); background: var(--cz-brand); color: #fff; font-size: 11px; font-weight: 800; letter-spacing: 0.04em; text-transform: uppercase; padding: 4px 12px; border-radius: 999px; box-shadow: 0 3px 8px rgba(94, 168, 41, 0.4); }
.cz-p-name { font-size: 16px; font-weight: 800; letter-spacing: -0.01em; }
.cz-p-tagline { font-size: 12.5px; color: var(--cz-muted); font-weight: 500; margin-top: 3px; min-height: 34px; }
.cz-p-price { display: flex; align-items: baseline; gap: 4px; margin: 12px 0 2px; }
.cz-p-amt { font-size: 30px; font-weight: 800; letter-spacing: -0.03em; }
.cz-p-per { font-size: 13px; color: var(--cz-muted); font-weight: 600; }
.cz-p-annual-note { font-size: 11.5px; color: var(--cz-brand-ink); font-weight: 700; min-height: 16px; }
.cz-p-strike { font-size: 12.5px; color: var(--cz-faint); text-decoration: line-through; font-weight: 600; margin-left: 4px; }
.cz-p-feat { list-style: none; margin: 16px 0 0; padding: 16px 0 0; border-top: 1px solid var(--cz-border); display: flex; flex-direction: column; gap: 9px; flex: 1; }
.cz-p-feat li { display: flex; align-items: flex-start; gap: 9px; font-size: 13px; color: var(--cz-ink-2); font-weight: 500; line-height: 1.35; }
.cz-p-feat .cz-ck { color: var(--cz-brand); flex-shrink: 0; margin-top: 1px; }
.cz-p-feat .cz-muted-ck { color: var(--cz-faint); }
.cz-p-cta { margin-top: 18px; }

/* ---------- Confirm step ---------- */
.cz-confirm-line { display: flex; align-items: center; justify-content: space-between; padding: 13px 0; font-size: 14px; }
.cz-confirm-line + .cz-confirm-line { border-top: 1px solid var(--cz-border); }
.cz-confirm-line .cz-lbl { color: var(--cz-muted); font-weight: 600; }
.cz-confirm-line .cz-val { font-weight: 700; }
.cz-confirm-total { font-size: 17px; }
.cz-confirm-total .cz-val { color: var(--cz-brand-ink); }
.cz-info-box { background: var(--cz-info-soft); border: 1px solid #c4e6f4; border-radius: 12px; padding: 13px 15px; font-size: 13px; color: #0d6f99; font-weight: 500; display: flex; gap: 10px; }

/* ---------- Pay modal ---------- */
.cz-pay-amount { text-align: center; padding: 6px 0 18px; }
.cz-pay-amount .cz-v { font-size: 34px; font-weight: 800; letter-spacing: -0.03em; }
.cz-pay-amount .cz-l { font-size: 13px; color: var(--cz-muted); font-weight: 600; }

/* ---------- Toast ---------- */
.cz-toast-wrap { position: fixed; bottom: 26px; left: 50%; transform: translateX(-50%); z-index: 1200; display: flex; flex-direction: column; gap: 10px; align-items: center; }
.cz-toast { background: var(--cz-ink, #16222c); color: #fff; border-radius: 12px; padding: 13px 18px; font-size: 14px; font-weight: 600; box-shadow: var(--cz-shadow-lg); display: flex; align-items: center; gap: 10px; animation: cz-pop 0.25s cubic-bezier(0.2, 0.7, 0.3, 1); }
.cz-toast .cz-t-ic { color: #8fdf5e; display: grid; place-items: center; }

/* ---------- Success ---------- */
.cz-success-wrap { text-align: center; padding: 14px 0 4px; }
.cz-success-circle { width: 66px; height: 66px; border-radius: 50%; background: var(--cz-success-soft); color: var(--cz-success); display: grid; place-items: center; margin: 0 auto 16px; font-size: 34px; }
.cz-success-wrap h3 { margin: 0 0 6px; font-size: 19px; font-weight: 800; }
.cz-success-wrap p { margin: 0 auto; max-width: 340px; color: var(--cz-muted); font-size: 14px; font-weight: 500; line-height: 1.5; }

/* ---------- Payment redirect overlay ---------- */
.cz-pay-overlay {
  position: fixed; inset: 0; background: rgba(0, 0, 0, 0.6);
  display: flex; align-items: center; justify-content: center; z-index: 1300;
}

@media (max-width: 880px) {
  .cz-plan-card { grid-template-columns: 1fr; }
  .cz-plan-side { border-left: 0; border-top: 1px solid var(--cz-border); }
  .cz-plans { grid-template-columns: 1fr; }
  .cz-thead { display: none; }
  .cz-trow { grid-template-columns: 1fr auto; gap: 6px 12px; }
  .cz-trow .cz-col-date, .cz-trow .cz-col-status { grid-column: 1; }
}
</style>
