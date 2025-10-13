import { createApp } from 'vue';
import { createPinia } from 'pinia';
import router from './router';
import App from './App.vue';

// ✅ Import Bootstrap CSS e JS
import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap/dist/js/bootstrap.bundle.min.js';
import './assets/main.css';

// componentes globais
import BaseButton from './components/BaseButton.vue';
import BaseIconButton from './components/BaseIconButton.vue';

const app = createApp(App);

// registra componentes globais
app.component('BaseButton', BaseButton);
app.component('BaseIconButton', BaseIconButton);

// plugins
app.use(createPinia());
app.use(router);

// monta
app.mount('#app');