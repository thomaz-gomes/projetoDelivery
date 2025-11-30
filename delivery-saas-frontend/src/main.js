import { createApp } from 'vue';
import { createPinia } from 'pinia';
import router from './router';
import App from './App.vue';
import { initQZ, printComanda } from "./plugins/qz.js";
import PrinterWatcher from "./components/PrinterWatcher.vue";

// ✅ Import Bootstrap CSS e JS
import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap/dist/js/bootstrap.bundle.min.js';
import 'bootstrap-icons/font/bootstrap-icons.css';
import './assets/main.css';
import './assets/admin-shared.css';

// inicializar tooltips Bootstrap dinamicamente
import * as bootstrap from 'bootstrap';
function initTooltips() {
  try {
    const nodes = document.querySelectorAll('[data-bs-toggle="tooltip"]');
    nodes.forEach((el) => {
      if (!el._tooltip) {
        el._tooltip = new bootstrap.Tooltip(el);
      }
    });
  } catch (e) {
    console.warn('initTooltips failed', e);
  }
}

// componentes globais
import BaseButton from './components/BaseButton.vue';
import BaseIconButton from './components/BaseIconButton.vue';

const app = createApp(App);

initQZ();

// During local development, if a dev JWT is provided via VITE_DEV_JWT,
// populate localStorage so the dev session is authenticated automatically.
try {
  const devToken = import.meta.env.VITE_DEV_JWT || '';
  if (devToken && typeof window !== 'undefined') {
    try { if (!localStorage.getItem('token')) localStorage.setItem('token', devToken); } catch(e){}
  }
} catch(e) {}

async function handleNovoPedido(pedido) {
  await printComanda(pedido);
}

// registra componentes globais
app.component('BaseButton', BaseButton);
app.component('BaseIconButton', BaseIconButton);

// plugins
app.use(createPinia());
app.use(router);
app.component("PrinterWatcher", PrinterWatcher);

// monta
app.mount('#app');

// init tooltips initially and after route changes
initTooltips();
router.afterEach(() => {
  // small timeout to ensure DOM updated
  setTimeout(initTooltips, 50);
});