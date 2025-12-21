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

// tooltips are initialized by individual components when needed (e.g. Sidebar).

// componentes globais
import TextInput from './components/form/input/TextInput.vue';
import TextareaInput from './components/form/input/TextareaInput.vue';
import BaseButton from './components/BaseButton.vue';
import BaseIconButton from './components/BaseIconButton.vue';
import CurrencyInput from './components/CurrencyInput.vue';
import SelectInput from './components/form/select/SelectInput.vue';

const app = createApp(App);

// During development you can enable loading the QZ Tray client script from
// the local QZ Tray websocket server (default port 8181) by setting
// VITE_ENABLE_QZ=1 in your dev environment. This helps local testing
// without committing index.html changes. If enabled, dynamically load the
// script and then initialize QZ.
try {
  const enableQz = import.meta.env.VITE_ENABLE_QZ === '1';
  if (enableQz && typeof window !== 'undefined') {
    const s = document.createElement('script');
    s.src = 'http://localhost:8181/qz-tray.js';
    s.async = true;
    s.onload = () => { console.log('qz-tray script loaded (dev)'); initQZ().catch(()=>{}); };
    s.onerror = () => { console.warn('Failed to load qz-tray.js from localhost:8181'); };
    document.head.appendChild(s);
  } else {
    initQZ();
  }
} catch (e) {
  initQZ();
}

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
app.component('CurrencyInput', CurrencyInput);
app.component('TextInput', TextInput);
app.component('TextareaInput', TextareaInput);
app.component('SelectInput', SelectInput);

// plugins
app.use(createPinia());
app.use(router);
app.component("PrinterWatcher", PrinterWatcher);

// monta
app.mount('#app');

// route changes handled by components that need to initialize tooltips locally