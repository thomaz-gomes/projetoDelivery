<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import api from '../../api';
import RiderHeader from '../../components/rider/RiderHeader.vue';
import MobileBottomNav from '../../components/MobileBottomNav.vue';
import SwipeableViews from '../../components/rider/SwipeableViews.vue';

const router = useRouter();
const loading = ref(true);
const checkingOut = ref(false);
const stats = ref({ todayEarnings: 0, todayDeliveries: 0, monthEarnings: 0, monthDeliveries: 0, checkedIn: false, hasActiveShift: false, activeOrder: null });

function formatMoney(v) { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v || 0)); }

async function load() {
  loading.value = true;
  try {
    const { data } = await api.get('/riders/me/daily-stats');
    stats.value = data;
  } catch (e) { console.warn('daily-stats failed', e); }
  finally { loading.value = false; }
}

async function encerrarTurno() {
  checkingOut.value = true;
  try {
    await api.post('/riders/me/checkout');
    await load();
  } catch (e) {
    const { default: Swal } = await import('sweetalert2');
    Swal.fire({ icon: 'error', text: e.response?.data?.message || 'Erro ao encerrar turno' });
  } finally {
    checkingOut.value = false;
  }
}

function go(path) { router.push(path); }

let pollInterval = null;
function onVisibility() { if (!document.hidden) load(); }

onMounted(() => {
  load();
  pollInterval = setInterval(load, 30000);
  document.addEventListener('visibilitychange', onVisibility);
});
onUnmounted(() => {
  clearInterval(pollInterval);
  document.removeEventListener('visibilitychange', onVisibility);
});
</script>

<template>
  <RiderHeader />
  <SwipeableViews>
  <div class="rider-dashboard rider-page">
    <!-- Hero: today's earnings -->
    <div class="hero-card mb-3">
      <div class="hero-label">Ganhos hoje</div>
      <div class="hero-value" v-if="!loading">{{ formatMoney(stats.todayEarnings) }}</div>
      <div class="hero-value" v-else>
        <span class="skeleton" style="width:140px;height:36px;display:inline-block"></span>
      </div>
      <div class="hero-sub">
        <span><i class="bi bi-bicycle me-1"></i>{{ loading ? '—' : stats.todayDeliveries }} entregas</span>
        <span v-if="stats.checkedIn" class="badge-checkin"><i class="bi bi-check-circle-fill me-1"></i>Check-in OK</span>
        <span v-else class="badge-no-checkin" @click="go('/rider/checkin')"><i class="bi bi-exclamation-circle me-1"></i>Sem check-in</span>
      </div>
    </div>

    <!-- Encerrar turno -->
    <div v-if="stats.hasActiveShift" class="checkout-card mb-3">
      <div class="d-flex align-items-center justify-content-between">
        <div class="d-flex align-items-center gap-2">
          <span class="checkout-dot"></span>
          <span class="checkout-label">Turno em andamento</span>
        </div>
        <button class="btn btn-sm btn-danger" :disabled="checkingOut" @click="encerrarTurno">
          <span v-if="checkingOut" class="spinner-border spinner-border-sm me-1"></span>
          <i v-else class="bi bi-stop-circle me-1"></i>
          {{ checkingOut ? 'Encerrando...' : 'Encerrar turno' }}
        </button>
      </div>
    </div>

    <!-- Active order card -->
    <div v-if="stats.activeOrder" class="active-order-card mb-3 press-effect" @click="go('/rider/orders')">
      <div class="d-flex align-items-center gap-2">
        <div class="active-order-pulse"></div>
        <div class="flex-grow-1">
          <div class="fw-bold">#{{ stats.activeOrder.displayId || stats.activeOrder.displaySimple || '—' }}</div>
          <div class="active-order-addr">{{ stats.activeOrder.address || stats.activeOrder.customerName || 'Pedido ativo' }}</div>
        </div>
        <i class="bi bi-chevron-right"></i>
      </div>
    </div>

    <!-- Month summary -->
    <div class="month-row mb-3">
      <div class="month-stat">
        <div class="month-stat__value">{{ loading ? '—' : formatMoney(stats.monthEarnings) }}</div>
        <div class="month-stat__label">Este mês</div>
      </div>
      <div class="month-stat">
        <div class="month-stat__value">{{ loading ? '—' : stats.monthDeliveries }}</div>
        <div class="month-stat__label">Entregas no mês</div>
      </div>
    </div>

    <!-- Quick nav -->
    <div class="quick-nav">
      <div class="quick-nav__item press-effect" @click="go('/rider/orders')">
        <div class="quick-nav__icon" style="background:rgba(25,135,84,0.1);color:#198754"><i class="bi bi-list-check"></i></div>
        <span>Pedidos</span>
      </div>
      <div class="quick-nav__item press-effect" @click="go('/rider/checkin')">
        <div class="quick-nav__icon" style="background:rgba(13,110,253,0.1);color:#0d6efd"><i class="bi bi-geo-alt-fill"></i></div>
        <span>Check-in</span>
      </div>
      <div class="quick-nav__item press-effect" @click="go('/rider/shifts')">
        <div class="quick-nav__icon" style="background:rgba(255,193,7,0.1);color:#ffc107"><i class="bi bi-clock-history"></i></div>
        <span>Turnos</span>
      </div>
      <div class="quick-nav__item press-effect" @click="go('/rider/account')">
        <div class="quick-nav__icon" style="background:rgba(13,202,240,0.1);color:#0dcaf0"><i class="bi bi-wallet-fill"></i></div>
        <span>Extrato</span>
      </div>
    </div>

    <div class="mobile-nav-spacer d-lg-none"></div>
  </div>
  </SwipeableViews>
  <MobileBottomNav />
</template>

<style scoped>
.rider-dashboard { max-width: 500px; }

.hero-card {
  background: var(--rider-primary, #198754);
  color: #fff;
  border-radius: var(--rider-radius, 16px);
  padding: 24px 20px;
  text-align: center;
}
.hero-label { font-size: 0.85rem; opacity: 0.85; margin-bottom: 4px; }
.hero-value { font-size: 2.25rem; font-weight: 800; line-height: 1.1; margin-bottom: 8px; }
.hero-sub { display: flex; justify-content: center; gap: 16px; font-size: 0.8rem; opacity: 0.9; }
.badge-checkin { color: #a8e866; }
.badge-no-checkin { color: #ffc107; cursor: pointer; text-decoration: underline; }

.checkout-card {
  background: var(--rider-card, #fff);
  border: 1.5px solid #dc3545;
  border-radius: var(--rider-radius, 16px);
  padding: 12px 16px;
}
.checkout-dot {
  width: 10px;
  height: 10px;
  background: #198754;
  border-radius: 50%;
  animation: ao-pulse 1.5s infinite;
  flex-shrink: 0;
}
.checkout-label {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--rider-text, #1a1a1a);
}

.active-order-card {
  background: var(--rider-card, #fff);
  border: 2px solid var(--rider-primary, #198754);
  border-radius: var(--rider-radius, 16px);
  padding: 16px;
  cursor: pointer;
}
.active-order-pulse {
  width: 12px;
  height: 12px;
  background: #198754;
  border-radius: 50%;
  animation: ao-pulse 1.5s infinite;
  flex-shrink: 0;
}
@keyframes ao-pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.4); opacity: 0.5; }
}
.active-order-addr {
  font-size: 0.8rem;
  color: var(--rider-text-secondary, #6c757d);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 250px;
}

.month-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.month-stat {
  background: var(--rider-card, #fff);
  border-radius: var(--rider-radius, 16px);
  padding: 16px;
  text-align: center;
  box-shadow: var(--rider-shadow, 0 2px 8px rgba(0,0,0,0.08));
}
.month-stat__value { font-size: 1.25rem; font-weight: 700; color: var(--rider-text, #1a1a1a); }
.month-stat__label { font-size: 0.75rem; color: var(--rider-text-secondary, #6c757d); margin-top: 2px; }

.quick-nav {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}
.quick-nav__item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 14px 4px;
  background: var(--rider-card, #fff);
  border-radius: var(--rider-radius, 16px);
  cursor: pointer;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--rider-text, #1a1a1a);
  box-shadow: var(--rider-shadow, 0 2px 8px rgba(0,0,0,0.08));
}
.quick-nav__icon {
  width: 44px;
  height: 44px;
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.25rem;
}
</style>
