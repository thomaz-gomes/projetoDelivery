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
import CurrencyInput from './components/form/input/CurrencyInput.vue';
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

    // Improved loader: first fetch the resource to inspect headers/body so
    // failures (HTML page served instead of JS, redirects, TLS issues) are
    // visible in console. If the response looks like JS, we inject a script
    // element normally. Otherwise treat as failure and continue to next URL.
    const loadScript = (url) => new Promise(async (resolve) => {
      try {
        console.log('Attempting to fetch', url);
        let res;
        try {
          res = await fetch(url, { cache: 'no-store', mode: 'cors' });
        } catch (fetchErr) {
          console.warn('Fetch to', url, 'failed', fetchErr);
          resolve(false);
          return;
        }

        const cType = res.headers.get('content-type') || '';
        console.log('Fetch response', url, 'status', res.status, 'content-type', cType);

        // If server returned an HTML status page instead of JS, try to parse it
        // and locate an actual qz-tray script path (some QZ installs serve demo
        // files under /js/qz-tray.js). Otherwise, fail and let caller try
        // alternate URLs.
        if (!cType.includes('javascript')) {
          const body = await res.text().catch(()=>'');
          console.warn('Non-JS response for', url, '— preview:', body.slice(0,300));

          // Try to parse HTML and find a script tag that references qz-tray.js
          try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(body, 'text/html');
            const candidates = Array.from(doc.querySelectorAll('script[src]'))
              .map(s => s.getAttribute('src'))
              .filter(Boolean)
              .filter(src => src.includes('qz-tray'))
              .map(src => new URL(src, url).href);

            // Also try some common paths used by QZ demo installs
            const common = [
              new URL('/js/qz-tray.js', url).href,
              new URL('/demo/js/qz-tray.js', url).href,
              new URL('/qz-tray.js', url).href
            ];

            const tryList = [...new Set([...candidates, ...common])];
            for (const candidate of tryList) {
              console.log('Attempting candidate qz-tray path', candidate);

              // Fetch candidate first to ensure it's actually JS (some servers
              // return HTML status pages on these paths). If content-type is
              // not JS, look for JS markers in the body before injecting.
              let cres;
              try {
                cres = await fetch(candidate, { cache: 'no-store', mode: 'cors' });
              } catch (cf) {
                console.warn('Fetch to candidate failed', candidate, cf);
                continue;
              }

              const ccType = (cres.headers.get('content-type')||'').toLowerCase();
              const body = await cres.text().catch(()=>'');
              const looksLikeJs = ccType.includes('javascript') || /\bvar qz\b|\bfunction qz\b|\bqz\.print\b/.test(body.slice(0,2000));
              if (!looksLikeJs) {
                console.warn('Candidate does not appear to be JS, skipping', candidate, 'content-type', ccType);
                continue;
              }

              // Inject script element and wait for load. After load, ensure
              // `window.qz` is available; if not, treat as failure.
              const injected = await new Promise((injResolve) => {
                const s2 = document.createElement('script');
                s2.src = candidate;
                s2.async = true;
                s2.crossOrigin = 'anonymous';
                const cleanup = () => { s2.onload = s2.onerror = null; };
                s2.onload = () => {
                  console.log('qz-tray script element loaded from', candidate);
                  // wait briefly for the script to initialize `window.qz`
                  setTimeout(() => {
                    if (window.qz) { cleanup(); injResolve(true); }
                    else { console.warn('Script loaded but window.qz not defined for', candidate); cleanup(); injResolve(false); }
                  }, 300);
                };
                s2.onerror = (e) => { console.warn('Candidate script failed', candidate, e); cleanup(); injResolve(false); };
                document.head.appendChild(s2);
              });

              if (injected) { resolve(true); return; }
            }
          } catch (parseErr) {
            console.warn('Failed to parse HTML response for', url, parseErr);
          }

          resolve(false);
          return;
        }

        // Looks like a JS file — inject script tag. Use crossorigin to surface CORS errors.
        const s = document.createElement('script');
        s.src = url;
        s.async = true;
        s.crossOrigin = 'anonymous';
        s.onload = () => { console.log('qz-tray script loaded from', url); resolve(true); };
        s.onerror = (e) => { console.error('qz-tray script element error for', url, e); resolve(false); };
        document.head.appendChild(s);
      } catch (e) {
        console.error('Unexpected loader error for', url, e);
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