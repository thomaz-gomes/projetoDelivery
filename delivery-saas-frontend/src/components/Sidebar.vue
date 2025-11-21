<script setup>
import { computed, reactive } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

// Menu lateral (use Bootstrap Icons classes in `icon`)
const nav = [
  { name: 'Pedidos', to: '/orders', icon: 'bi bi-box-seam' },
  { name: 'Clientes', to: '/customers', icon: 'bi bi-person' },
  { name: 'Entregadores', to: '/riders', icon: 'bi bi-bicycle', children: [
    { name: 'Lista', to: '/riders', icon: 'bi bi-people' },
    { name: 'Créditos/Débitos', to: '/rider-adjustments', icon: 'bi bi-credit-card' },
  ] },
  { name: 'Afiliados', to: '/affiliates', icon: 'bi bi-people-fill' },
  { name: 'Cupons', to: '/coupons', icon: 'bi bi-ticket-perforated' },
    { name: 'Lista de cardápios', to: '/menu/menus', icon: 'bi bi-list' },
 
  
  // Configurações has sub-items
    { name: 'Configurações', to: '/settings/company', icon: 'bi bi-gear', children: [
    { name: 'Bairros', to: '/settings/neighborhoods', icon: 'bi bi-geo-alt' },
    { name: 'iFood', to: '/settings/ifood', icon: 'bi bi-shop' },
    { name: 'Lojas', to: '/settings/stores', icon: 'bi bi-shop-window' },
    { name: 'Pasta (import)', to: '/settings/file-source', icon: 'bi bi-folder' },
    { name: 'Preview (pasta)', to: '/settings/file-source/preview', icon: 'bi bi-eye' },
    { name: 'WhatsApp', to: '/settings/whatsapp', icon: 'bi bi-whatsapp' },
    { name: 'Geral', to: '/settings/company', icon: 'bi bi-sliders' },
    { name: 'Dev Tools', to: '/settings/devtools', icon: 'bi bi-tools' },
    { name: 'Formas de pagamento', to: '/settings/payment-methods', icon: 'bi bi-credit-card-2-front' },
    { name: 'Gestão de Acessos', to: '/settings/access-control', icon: 'bi bi-shield-lock' },
  ] },
];

// collapsed state for parent items with children (true = collapsed)
const collapsed = reactive({})

function toggleParent(to){
  if(!to) return
  collapsed[to] = !collapsed[to]
}

const isActive = (to) => computed(() => route.path.startsWith(to));

const showSidebar = computed(() => {
  try {
    if (route.meta && route.meta.noSidebar) return false;
  } catch (e) {}
  return !route.path.startsWith('/rider');
});

function logout() {
  auth.logout();
  router.replace('/login');
}
</script>
<template>
  <aside v-if="showSidebar" class="d-none d-md-flex flex-column border-end" style="width: 240px; min-height: 100vh;">
    <!-- Header -->
    <div class="border-bottom p-3">
      <h5 class="mb-0">Delivery SaaS</h5>
      <small class="text-muted">Painel Administrativo</small>
    </div>

    <!-- Navegação -->
    <nav class="flex-grow-1 p-2">
      <ul class="nav flex-column">
        <li v-for="item in nav" :key="item.to" class="nav-item mb-1">
          <div class="d-flex flex-column">
            <template v-if="!item.children">
              <router-link
                :to="item.to"
                class="nav-link d-flex align-items-center px-3 py-2 rounded text-white"
                :class="{ active: isActive(item.to).value }"
              >
                <i :class="item.icon + ' me-2'" aria-hidden="true"></i>
                <span>{{ item.name }}</span>
              </router-link>
            </template>

            <template v-else>
              <div class="nav-link d-flex align-items-center px-3 py-2 rounded parent-link" role="button" tabindex="0" @click="toggleParent(item.to)" @keydown.enter.prevent="toggleParent(item.to)" :aria-expanded="!collapsed[item.to]">
                <i :class="item.icon + ' me-2'" aria-hidden="true"></i>
                <span class="flex-grow-1">{{ item.name }}</span>
                <i :class="['bi bi-chevron-down ms-2 chevron', { rotated: collapsed[item.to] }]" aria-hidden="true"></i>
              </div>

              <transition name="slide">
                <ul class="nav flex-column ms-3 mt-1" v-show="!collapsed[item.to]">
                <li v-for="child in item.children" :key="child.to" class="nav-item mb-1">
                  <router-link
                    :to="child.to"
                    class="nav-link px-3 py-1 rounded text-white child-link"
                    :class="{ active: isActive(child.to).value }"
                  >
                    <i :class="child.icon + ' me-2'" aria-hidden="true"></i>
                    <span>{{ child.name }}</span>
                  </router-link>
                </li>
                </ul>
              </transition>
            </template>
          </div>
        </li>
      </ul>
    </nav>

    <!-- Logout -->
    <div class="border-top p-3">
      <button type="button" class="btn btn-sm btn-outline-secondary w-100 text-white border-white" @click="logout">
        Sair
      </button>
    </div>
  </aside>
</template>

<style scoped>
.nav-link {
  transition: background-color 0.12s, color 0.12s;
  color: #fff;
}
.nav-link i { color: #fff; }
.nav-link:hover, .nav-link:focus {
  background-color: rgba(255,255,255,0.08);
  color: #fff;
}
.parent-link { cursor: pointer; }
.child-link { font-size: .95rem; }
.child-link i { font-size: 1rem }

/* diagonal gradient background: primary -> slightly darker blue; fallback color included */
aside { background-color: #0d6efd; background-image: linear-gradient(135deg, #0d6efd 0%, #0a58ca 100%); }

/* active state: subtly highlighted */
.nav-link.active { background-color: rgba(255,255,255,0.14); font-weight:600 }

/* chevron rotate on toggle */
.chevron { transition: transform 180ms ease; transform-origin: 50% 50%; }
.chevron.rotated { transform: rotate(-90deg); }

/* slide transition for child lists */
.slide-enter-active, .slide-leave-active {
  transition: max-height 220ms ease, opacity 160ms ease;
  overflow: hidden;
}
.slide-enter-from, .slide-leave-to {
  max-height: 0;
  opacity: 0;
}
.slide-enter-to, .slide-leave-from {
  max-height: 400px; /* large enough for lists */
  opacity: 1;
}
</style>