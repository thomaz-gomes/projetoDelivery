<template>
  <!-- Mobile bottom navigation (fixed) - visible on small screens only -->
  <nav v-if="showNav" class="mobile-bottom-nav d-lg-none" style="position:fixed;left:0;right:0;bottom:0;z-index:1080;background:#fff;border-top:1px solid rgba(0,0,0,0.06);padding:.4rem 0;">
    <div class="d-flex justify-content-around align-items-center">
      <!-- Meus pedidos (principal) -->
      <button :class="['nav-item btn btn-link', isActive('/rider/orders') ? 'active' : 'text-muted']" @click.prevent="goRiderOrders" aria-label="Meus pedidos">
        <i class="bi bi-list-task nav-icon" aria-hidden="true" style="font-size:1.15rem"></i>
        <div class="nav-label small">Meus pedidos</div>
      </button>

      <!-- Leitor de QR -->
      <button :class="['nav-item btn btn-link', isActive('/rider/home') ? 'active' : 'text-muted']" @click.prevent="goRiderHome" aria-label="Leitor QR">
        <i class="bi bi-upc-scan nav-icon" aria-hidden="true" style="font-size:1.15rem"></i>
        <div class="nav-label small">Leitor QR</div>
      </button>

      <!-- Meu Extrato -->
      <button :class="['nav-item btn btn-link', isActive('/rider/account') ? 'active' : 'text-muted']" @click.prevent="goStatement" aria-label="Meu extrato">
        <i class="bi bi-wallet2 nav-icon" aria-hidden="true" style="font-size:1.15rem"></i>
        <div class="nav-label small">Meu extrato</div>
      </button>

      <!-- Sair -->
      <button class="nav-item btn btn-link text-muted" @click.prevent="logout" aria-label="Sair">
        <i class="bi bi-box-arrow-right nav-icon" aria-hidden="true" style="font-size:1.15rem"></i>
        <div class="nav-label small">Sair</div>
      </button>
    </div>
  </nav>
</template>

<script setup>
import { useRouter, useRoute } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { computed } from 'vue';
const router = useRouter();
const route = useRoute();
const auth = useAuthStore();

function goRiderOrders(){ router.push({ path: '/rider/orders' }) }
function goRiderHome(){
  // navigate to rider home and trigger the scanner open event; if already there, just trigger
  const doDispatch = () => { try{ window.dispatchEvent(new CustomEvent('open-rider-scanner')) }catch(e){ console.warn('dispatch open-rider-scanner failed', e) } }
  if(route.path && String(route.path).startsWith('/rider/home')){ doDispatch(); return }
  router.push({ path: '/rider/home' }).then(()=> setTimeout(doDispatch, 280)).catch(()=> setTimeout(doDispatch, 500))
}
function goStatement(){
  try{ console.debug('MobileBottomNav: navigating to /rider/account') }catch(e){}
  router.push('/rider/account')
}

function logout(){
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
.mobile-bottom-nav .nav-item{ background:transparent;border:0;padding:.25rem .4rem;display:flex;flex-direction:column;align-items:center }
.mobile-bottom-nav .nav-icon{ display:block }
.mobile-bottom-nav .nav-label{ font-size:11px; line-height:1 }
.mobile-bottom-nav .nav-item.active, .mobile-bottom-nav .nav-item.active .nav-label, .mobile-bottom-nav .nav-item.active .nav-icon{ color: var(--bs-primary,#0d6efd) !important }
</style>
