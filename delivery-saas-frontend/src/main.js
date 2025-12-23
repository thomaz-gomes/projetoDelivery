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
    // Try to load qz-tray.js using the same protocol as the page to avoid
    // mixed-content blocks (https page can't load http script). Try
    // localhost first, then 127.0.0.1 as a fallback.
    const tryUrls = [
      `${location.protocol}//localhost:8181/qz-tray.js`,
      `${location.protocol}//127.0.0.1:8181/qz-tray.js`
    ];

    // First probe QZ Tray by attempting a WebSocket connection. Loading the
    // `qz-tray.js` script can fail with a SyntaxError when the endpoint
    // responds with an unexpected/legacy protocol or non-JS bytes (observed
    // as illegal character U+0015). A successful websocket upgrade is a
    // stronger signal that the QZ service is speaking the expected protocol
    // and we can safely inject the script.
    (async () => {
      const wsScheme = location.protocol === 'https:' ? 'wss' : 'ws';
      const hosts = [`localhost:8181`, `127.0.0.1:8181`];
      let wsOk = false;
      for (const h of hosts) {
        try {
          wsOk = await new Promise((resolve) => {
            let settled = false;
            const url = `${wsScheme}://${h}`;
            let socket;
            try {
              socket = new WebSocket(url);
            } catch (e) {
              // invalid url or protocol
              return resolve(false);
            }
            const timer = setTimeout(() => { if (!settled) { settled = true; try { socket.close(); } catch(_){}; resolve(false); } }, 1000);
            socket.addEventListener('open', () => { if (!settled) { settled = true; clearTimeout(timer); try { socket.close(); } catch(_){}; resolve(true); } });
            socket.addEventListener('error', () => { if (!settled) { settled = true; clearTimeout(timer); try { socket.close(); } catch(_){}; resolve(false); } });
            socket.addEventListener('close', () => { /* noop */ });
          });
        } catch (e) {
          wsOk = false;
        }
        if (wsOk) {
          // If websocket probe succeeded, inject the script from the matching URL
          const scriptUrl = `${location.protocol}//${h.replace(/:8181$/, ':8181')}/qz-tray.js`;
          const s = document.createElement('script');
          s.src = scriptUrl;
          s.async = true;
          s.onload = () => { console.log('qz-tray script loaded from', scriptUrl); initQZ().catch(()=>{}); };
          s.onerror = (e) => { console.warn('Failed to load qz-tray.js from', scriptUrl, e); initQZ().catch(()=>{}); };
          document.head.appendChild(s);
          return;
        }
      }
      // No websocket endpoint responded — try loading a local static stub to
      // allow development when the real QZ Tray webserver isn't available.
      try {
        // First, attempt to load the real QZ Tray client script from the
        // local QZ Tray webserver (port 8181). If that fails, fall back to
        // the local stub served at `/qz-tray.js`.
        const remoteScript = document.createElement('script');
        const remoteUrl = `${location.protocol}//localhost:8181/qz-tray.js`;
        remoteScript.src = remoteUrl;
        remoteScript.async = true;
        let remoteLoaded = false;
        remoteScript.onload = () => { remoteLoaded = true; console.log('qz-tray script loaded from', remoteUrl); initQZ().catch(()=>{}); };
        remoteScript.onerror = (e) => {
          console.warn('Failed to load qz-tray.js from', remoteUrl, e);
          // Fall back to local stub
          try {
            const s = document.createElement('script');
            s.src = '/qz-tray.js';
            s.async = true;
            s.onload = () => { console.log('qz-tray script loaded from /qz-tray.js (fallback)'); initQZ().catch(()=>{}); };
            s.onerror = (err) => { console.warn('Failed to load local /qz-tray.js fallback', err); initQZ().catch(()=>{}); };
            document.head.appendChild(s);
          } catch (err) {
            console.warn('qz-tray websocket probe failed; skipping script injection and calling initQZ fallback', err);
            initQZ().catch(()=>{});
          }
        };
        document.head.appendChild(remoteScript);
        return;
      } catch (e) {
        console.warn('qz-tray websocket probe failed; skipping script injection and calling initQZ fallback', e);
        initQZ().catch(()=>{});
      }
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