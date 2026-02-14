import { createApp } from 'vue';
import { createPinia } from 'pinia';
import router from './router';
import App from './App.vue';
import PrinterWatcher from "./components/PrinterWatcher.vue";

import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap/dist/js/bootstrap.bundle.min.js';
import 'bootstrap-icons/font/bootstrap-icons.css';
import './assets/overrides/_variables.css';
import './assets/overrides/_bootstrap.css';
import './assets/overrides/_components.css';
import './assets/overrides/_responsive.css';
import './assets/overrides/_media-library.css';
import './assets/main.css';
import './assets/admin-shared.css';

// componentes globais
import TextInput from './components/form/input/TextInput.vue';
import TextareaInput from './components/form/input/TextareaInput.vue';
import BaseButton from './components/BaseButton.vue';
import BaseIconButton from './components/BaseIconButton.vue';
import CurrencyInput from './components/form/input/CurrencyInput.vue';
import SelectInput from './components/form/select/SelectInput.vue';

const app = createApp(App);

// During local development, if a dev JWT is provided via VITE_DEV_JWT,
// populate localStorage so the dev session is authenticated automatically.
try {
  const devToken = import.meta.env.VITE_DEV_JWT || '';
  if (devToken && typeof window !== 'undefined') {
    try { if (!localStorage.getItem('token')) localStorage.setItem('token', devToken); } catch(e){}
  }
} catch(e) {}

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
