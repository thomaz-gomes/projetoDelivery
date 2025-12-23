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
// the local QZ Tray webserver (port 8181) by setting VITE_ENABLE_QZ=1.
// We inject qz-tray.js directly (no pre-probe) to allow QZ to handle
// certificate prompts and connection. If it fails to load, we fall back
// to a local stub for UI testing.
try {
  const enableQz = import.meta.env.VITE_ENABLE_QZ === '1';
  if (enableQz && typeof window !== 'undefined') {
    // QZ Tray serves qz-tray.js over HTTPS with its own certificate.
    // Using HTTP here can cause ERR_INVALID_HTTP_RESPONSE due to TLS.
    const urls = [
      `https://localhost:8181/qz-tray.js`,
      `https://127.0.0.1:8181/qz-tray.js`
    ];

    const loadScript = (url) => new Promise((resolve) => {
      try {
        const s = document.createElement('script');
        s.src = url;
        s.async = true;
        s.onload = () => { console.log('qz-tray script loaded from', url); resolve(true); };
        s.onerror = (e) => { console.warn('Failed to load qz-tray.js from', url, e); resolve(false); };
        document.head.appendChild(s);
      } catch (e) {
        resolve(false);
      }
    });

    (async () => {
      let loaded = false;
      for (const u of urls) {
        if (await loadScript(u)) { loaded = true; break; }
      }
      if (!loaded) {
        // Fall back to local stub for UI continuity
        if (await loadScript('/qz-tray.js')) {
          loaded = true;
        }
      }
      initQZ().catch(()=>{});
    })();
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