<script setup>
import { ref, computed, onMounted } from 'vue';
import api from '../../api';
import RiderHeader from '../../components/rider/RiderHeader.vue';
import MobileBottomNav from '../../components/MobileBottomNav.vue';

const loading = ref(true);
const checkingOut = ref(false);
const shifts = ref([]);
const selected = ref(null);

const activeShift = computed(() => shifts.value.find(s => s.isActive) || null);

function formatMoney(v) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v || 0));
}

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function duration(checkinAt, checkoutAt) {
  if (!checkinAt || !checkoutAt) return null;
  const ms = new Date(checkoutAt) - new Date(checkinAt);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return `${h}h${m > 0 ? m + 'm' : ''}`;
}

async function load() {
  loading.value = true;
  try {
    const { data } = await api.get('/riders/me/shifts');
    shifts.value = data;
  } catch (e) {
    console.warn('shifts load failed', e);
  } finally {
    loading.value = false;
  }
}

function open(shift) {
  selected.value = selected.value?.id === shift.id ? null : shift;
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

onMounted(load);
</script>

<template>
  <RiderHeader />
  <div class="shifts-page rider-page">

    <div class="shifts-header mb-3">
      <h6 class="shifts-title">Histórico de Turnos</h6>
      <span class="shifts-count">{{ shifts.length }} turno(s)</span>
    </div>

    <!-- Turno ativo: encerrar -->
    <div v-if="activeShift && !loading" class="active-shift-banner mb-3">
      <div class="d-flex align-items-center justify-content-between">
        <div class="d-flex align-items-center gap-2">
          <span class="active-dot"></span>
          <div>
            <div class="active-shift-name">{{ activeShift.shift?.name || 'Turno em andamento' }}</div>
            <div class="active-shift-since">Desde {{ formatTime(activeShift.checkinAt) }}</div>
          </div>
        </div>
        <button class="btn btn-sm btn-danger" :disabled="checkingOut" @click.stop="encerrarTurno">
          <span v-if="checkingOut" class="spinner-border spinner-border-sm me-1"></span>
          <i v-else class="bi bi-stop-circle me-1"></i>
          {{ checkingOut ? 'Encerrando...' : 'Encerrar turno' }}
        </button>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="d-flex flex-column gap-2">
      <div v-for="i in 4" :key="i" class="skeleton shift-skeleton"></div>
    </div>

    <!-- Empty -->
    <div v-else-if="shifts.length === 0" class="empty-state">
      <i class="bi bi-clock-history empty-icon"></i>
      <div class="empty-text">Nenhum turno registrado ainda.</div>
    </div>

    <!-- List -->
    <div v-else class="shift-list">
      <div
        v-for="s in shifts"
        :key="s.id"
        class="shift-card"
        :class="{ 'shift-card--active': s.isActive, 'shift-card--open': selected?.id === s.id }"
        @click="open(s)"
      >
        <!-- Card header -->
        <div class="shift-card__header">
          <div class="shift-card__left">
            <div class="shift-date">{{ formatDate(s.checkinAt) }}</div>
            <div class="shift-name">{{ s.shift?.name || 'Turno' }}</div>
            <div class="shift-times">
              <i class="bi bi-clock me-1"></i>{{ formatTime(s.checkinAt) }}
              <template v-if="s.checkoutAt"> → {{ formatTime(s.checkoutAt) }}</template>
              <template v-else> <span class="badge-active ms-1">em andamento</span></template>
            </div>
          </div>
          <div class="shift-card__right">
            <div class="shift-earnings">{{ formatMoney(s.totalEarned) }}</div>
            <div class="shift-deliveries"><i class="bi bi-bicycle me-1"></i>{{ s.deliveries }} entregas</div>
            <i class="bi shift-chevron" :class="selected?.id === s.id ? 'bi-chevron-up' : 'bi-chevron-down'"></i>
          </div>
        </div>

        <!-- Detail panel (expanded) -->
        <transition name="detail-slide">
          <div v-if="selected?.id === s.id" class="shift-detail">
            <div class="detail-divider"></div>

            <div class="detail-grid">
              <div class="detail-stat">
                <div class="detail-stat__value">{{ s.deliveries }}</div>
                <div class="detail-stat__label">Entregas</div>
              </div>
              <div class="detail-stat">
                <div class="detail-stat__value">{{ formatMoney(s.totalEarned) }}</div>
                <div class="detail-stat__label">Total ganho</div>
              </div>
              <div class="detail-stat">
                <div class="detail-stat__value">{{ duration(s.checkinAt, s.checkoutAt) || '—' }}</div>
                <div class="detail-stat__label">Duração</div>
              </div>
              <div class="detail-stat">
                <div class="detail-stat__value" style="font-size:0.9rem">{{ s.topNeighborhood || '—' }}</div>
                <div class="detail-stat__label">Bairro top</div>
              </div>
            </div>

            <div v-if="s.goalsTotal > 0" class="goals-row mt-2">
              <i class="bi bi-trophy-fill me-1" style="color:#ffc107"></i>
              <span>Metas atingidas: <strong>{{ s.goalsHit }} / {{ s.goalsTotal }}</strong></span>
              <div class="goals-bar">
                <div class="goals-bar__fill" :style="{ width: (s.goalsHit / s.goalsTotal * 100) + '%' }"></div>
              </div>
            </div>

            <div v-if="!s.checkoutAt" class="active-notice mt-2">
              <i class="bi bi-info-circle me-1"></i>Turno ainda em andamento — checkout automático em até 2h após o fim do turno.
            </div>
          </div>
        </transition>
      </div>
    </div>

    <div class="mobile-nav-spacer d-lg-none"></div>
  </div>
  <MobileBottomNav />
</template>

<style scoped>
.shifts-page {
  max-width: 500px;
  padding: 16px;
}

.shifts-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}
.shifts-title {
  font-size: 1rem;
  font-weight: 700;
  color: var(--rider-text, #1a1a1a);
  margin: 0;
}
.shifts-count {
  font-size: 0.78rem;
  color: var(--rider-text-secondary, #6c757d);
}

/* Active shift banner */
.active-shift-banner {
  background: var(--rider-card, #fff);
  border: 1.5px solid #dc3545;
  border-radius: 16px;
  padding: 12px 16px;
}
.active-dot {
  width: 10px;
  height: 10px;
  background: #198754;
  border-radius: 50%;
  flex-shrink: 0;
  animation: pulse-dot 1.5s infinite;
}
@keyframes pulse-dot {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.4); opacity: 0.5; }
}
.active-shift-name { font-size: 0.9rem; font-weight: 600; color: var(--rider-text, #1a1a1a); }
.active-shift-since { font-size: 0.75rem; color: var(--rider-text-secondary, #6c757d); }

/* Skeleton */
.shift-skeleton {
  height: 80px;
  border-radius: 16px;
  background: linear-gradient(90deg, #e9ecef 25%, #f8f9fa 50%, #e9ecef 75%);
  background-size: 200% 100%;
  animation: shimmer 1.2s infinite;
}
@keyframes shimmer { 0% { background-position: 200% 0 } 100% { background-position: -200% 0 } }

/* Empty state */
.empty-state {
  text-align: center;
  padding: 48px 16px;
  color: var(--rider-text-secondary, #6c757d);
}
.empty-icon { font-size: 3rem; display: block; margin-bottom: 12px; opacity: 0.4; }
.empty-text { font-size: 0.875rem; }

/* Shift card */
.shift-card {
  background: var(--rider-card, #fff);
  border-radius: 16px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.07);
  margin-bottom: 10px;
  overflow: hidden;
  cursor: pointer;
  transition: box-shadow 0.2s;
}
.shift-card:active { transform: scale(0.99); }
.shift-card--active {
  border-left: 4px solid #198754;
}
.shift-card--open {
  box-shadow: 0 4px 16px rgba(0,0,0,0.12);
}

.shift-card__header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 14px 16px;
}
.shift-card__left { flex: 1; }
.shift-card__right {
  text-align: right;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
}

.shift-date { font-size: 0.78rem; color: var(--rider-text-secondary, #6c757d); margin-bottom: 2px; }
.shift-name { font-size: 0.9rem; font-weight: 600; color: var(--rider-text, #1a1a1a); }
.shift-times { font-size: 0.75rem; color: var(--rider-text-secondary, #6c757d); margin-top: 2px; }
.badge-active {
  background: #198754;
  color: #fff;
  font-size: 0.65rem;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 6px;
}

.shift-earnings { font-size: 1rem; font-weight: 700; color: #198754; }
.shift-deliveries { font-size: 0.75rem; color: var(--rider-text-secondary, #6c757d); }
.shift-chevron { font-size: 0.8rem; color: var(--rider-text-secondary, #6c757d); margin-top: 4px; }

/* Detail panel */
.detail-divider { height: 1px; background: #f0f0f0; margin: 0 16px; }
.shift-detail { padding: 14px 16px; }

.detail-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.detail-stat {
  background: #f8f9fa;
  border-radius: 10px;
  padding: 10px 12px;
  text-align: center;
}
.detail-stat__value { font-size: 1rem; font-weight: 700; color: var(--rider-text, #1a1a1a); }
.detail-stat__label { font-size: 0.7rem; color: var(--rider-text-secondary, #6c757d); margin-top: 2px; }

.goals-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8rem;
  color: var(--rider-text, #1a1a1a);
  flex-wrap: wrap;
}
.goals-bar {
  flex: 1;
  min-width: 60px;
  height: 6px;
  background: #e9ecef;
  border-radius: 3px;
  overflow: hidden;
}
.goals-bar__fill {
  height: 100%;
  background: #ffc107;
  border-radius: 3px;
  transition: width 0.4s;
}

.active-notice {
  font-size: 0.75rem;
  color: #0d6efd;
  background: rgba(13,110,253,0.07);
  border-radius: 8px;
  padding: 8px 10px;
}

/* Transition */
.detail-slide-enter-active, .detail-slide-leave-active { transition: max-height 0.25s ease, opacity 0.2s; overflow: hidden; }
.detail-slide-enter-from, .detail-slide-leave-to { max-height: 0; opacity: 0; }
.detail-slide-enter-to, .detail-slide-leave-from { max-height: 300px; opacity: 1; }
</style>
