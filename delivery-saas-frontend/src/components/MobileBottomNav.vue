<template>
  <!-- Mobile bottom navigation (fixed) - visible on small screens only -->
  <nav v-if="showNav" class="mobile-bottom-nav d-lg-none">
    <div class="d-flex justify-content-around align-items-center">
      <!-- Meus pedidos -->
      <button :class="['nav-item', { active: isActive('/rider/orders') }]" @click.prevent="goRiderOrders" aria-label="Meus pedidos">
        <span class="nav-icon-wrap">
          <i :class="['bi', isActive('/rider/orders') ? 'bi-list-check' : 'bi-list-task', 'nav-icon']" aria-hidden="true"></i>
          <span v-if="orderCount > 0" class="nav-badge">{{ orderCount > 9 ? '9+' : orderCount }}</span>
        </span>
        <div class="nav-label">Pedidos</div>
      </button>

      <!-- Check-in -->
      <button :class="['nav-item', { active: isActive('/rider/checkin') }]" @click.prevent="router.push('/rider/checkin')" aria-label="Check-in">
        <span class="nav-icon-wrap">
          <i :class="['bi', isActive('/rider/checkin') ? 'bi-geo-alt-fill' : 'bi-geo-alt', 'nav-icon']" aria-hidden="true"></i>
        </span>
        <div class="nav-label">Check-in</div>
      </button>

      <!-- Ranking -->
      <button :class="['nav-item', { active: isActive('/rider/ranking') }]" @click.prevent="router.push('/rider/ranking')" aria-label="Ranking">
        <span class="nav-icon-wrap">
          <i :class="['bi', isActive('/rider/ranking') ? 'bi-trophy-fill' : 'bi-trophy', 'nav-icon']" aria-hidden="true"></i>
        </span>
        <div class="nav-label">Ranking</div>
      </button>

      <!-- Meu Extrato -->
      <button :class="['nav-item', { active: isActive('/rider/account') }]" @click.prevent="goStatement" aria-label="Meu extrato">
        <span class="nav-icon-wrap">
          <i :class="['bi', isActive('/rider/account') ? 'bi-wallet-fill' : 'bi-wallet2', 'nav-icon']" aria-hidden="true"></i>
        </span>
        <div class="nav-label">Extrato</div>
      </button>

      <!-- Turnos -->
      <button :class="['nav-item', { active: isActive('/rider/shifts') }]" @click.prevent="router.push('/rider/shifts')" aria-label="Turnos">
        <span class="nav-icon-wrap">
          <i :class="['bi', isActive('/rider/shifts') ? 'bi-clock-history' : 'bi-clock-history', 'nav-icon']" aria-hidden="true"></i>
        </span>
        <div class="nav-label">Turnos</div>
      </button>

      <!-- Sair -->
      <button class="nav-item" @click.prevent="logout" aria-label="Sair">
        <span class="nav-icon-wrap">
          <i class="bi bi-box-arrow-right nav-icon" aria-hidden="true"></i>
        </span>
        <div class="nav-label">Sair</div>
      </button>
    </div>
  </nav>
</template>

<script setup>
import { useRouter, useRoute } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { computed, onMounted } from 'vue';
import api from '../api';

const props = defineProps({
  orderCount: { type: Number, default: 0 }
});

const router = useRouter();
const route = useRoute();
const auth = useAuthStore();

// Expose nav height as CSS variable on :root so spacer divs stay in sync
onMounted(() => {
  document.documentElement.style.setProperty('--mobile-nav-height', '80px');
});

function goRiderOrders(){ router.push({ path: '/rider/orders' }) }
function openScanner(){
  // dispatch event to trigger scanner modal; ensure we're on rider/orders
  const doDispatch = () => { try{ window.dispatchEvent(new CustomEvent('open-rider-scanner')) }catch(e){ console.warn('dispatch open-rider-scanner failed', e) } }
  if(route.path && String(route.path) === '/rider/orders'){ doDispatch(); return }
  router.push({ path: '/rider/orders' }).then(()=> setTimeout(doDispatch, 300)).catch(()=> setTimeout(doDispatch, 500))
}
function goStatement(){
  try{ console.debug('MobileBottomNav: navigating to /rider/account') }catch(e){}
  router.push('/rider/account')
}

async function logout(){
  // Remove a posição do mapa antes de limpar o token (token ainda válido aqui)
  if (auth.user?.role === 'RIDER') {
    try { await api.delete('/riders/me/position') } catch (e) { console.warn('clearPosition on logout failed:', e?.message) }
  }
  try{ auth.logout(); }catch(e){ console.warn('logout failed', e) }
  router.replace('/login')
}

const showNav = computed(() => {
  try{ return route && route.path && String(route.path).startsWith('/rider') }
  catch(e){ return false }
})

function isActive(path){
  try{
    if(!route || !route.path) return false
    // active when equal or when path is a prefix (handles routes like /rider/orders/123)
    return route.path === path || String(route.path).startsWith(path + '/')
  }catch(e){ return false }
}
</script>

<style scoped>
.mobile-bottom-nav {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 1080;
  background: rgb(248, 249, 250);
  padding: 8px 8px;
  padding-bottom: calc(8px + env(safe-area-inset-bottom, 0px));
}

.mobile-bottom-nav .nav-item {
  background: transparent;
  border: 0;
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  min-height: 52px;
  justify-content: center;
  border-radius: 14px;
  color: #1a1a1a;
  transition: background 0.2s ease, transform 0.1s ease;
  position: relative;
}

.mobile-bottom-nav .nav-item:active {
  transform: scale(0.95);
}

.mobile-bottom-nav .nav-item.active {
  background: rgb(137, 209, 54);
  color: #000;
}

.mobile-bottom-nav .nav-icon-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.mobile-bottom-nav .nav-icon {
  display: block;
  font-size: 1.25rem;
}

.mobile-bottom-nav .nav-label {
  font-size: 0.65rem;
  font-weight: 500;
  line-height: 1;
}

.nav-badge {
  position: absolute;
  top: -6px;
  right: -10px;
  background: #dc3545;
  color: #fff;
  font-size: 0.55rem;
  font-weight: 700;
  min-width: 16px;
  height: 16px;
  line-height: 16px;
  text-align: center;
  border-radius: 8px;
  padding: 0 4px;
  pointer-events: none;
}
</style>

<style>
/* Global spacer utility – consumed by rider views to reserve space for the fixed nav */
.mobile-nav-spacer {
  height: var(--mobile-nav-height, 80px);
}
</style>
