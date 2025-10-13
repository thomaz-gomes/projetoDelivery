import { createRouter, createWebHistory } from 'vue-router';
import Login from './views/Login.vue';
import Orders from './views/Orders.vue';
import Claim from './views/Claim.vue';
import Receipt from './views/Receipt.vue';
import WhatsAppConnect from './views/WhatsAppConnect.vue';
import Riders from './views/Riders.vue';
import CustomersList from './views/CustomersList.vue';
import CustomerForm from './views/CustomerForm.vue';
import CustomerProfile from './views/CustomerProfile.vue';
import IFoodIntegration from './views/IFoodIntegration.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: Login },
    { path: '/', redirect: '/orders' },
    { path: '/orders', component: Orders, meta: { requiresAuth: true } },
    { path: '/orders/:id/receipt', component: Receipt, meta: { requiresAuth: true } },
    { path: '/customers', component: CustomersList },
    { path: '/customers/new', component: CustomerForm },
    { path: '/customers/:id', component: CustomerProfile },
    { path: '/riders', component: Riders, meta: { requiresAuth: true } },
    { path: '/settings/whatsapp', component: WhatsAppConnect, meta: { requiresAuth: true } },
    { path: '/settings/ifood', component: IFoodIntegration }, // 👈 AQUI
    { path: '/claim/:token', component: Claim, meta: { requiresAuth: true } }
  ]
});

router.beforeEach((to) => {
  const token = localStorage.getItem('token');
  if (to.meta.requiresAuth && !token) {
    return { path: '/login', query: { redirect: to.fullPath } };
  }
});

export default router;