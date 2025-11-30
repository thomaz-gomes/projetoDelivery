import { createRouter, createWebHistory } from 'vue-router';
import Login from './views/Login.vue';
import Orders from './views/Orders.vue';
import Claim from './views/Claim.vue';
import Receipt from './views/Receipt.vue';
import WhatsAppConnect from './views/WhatsAppConnect.vue';
import Riders from './views/Riders.vue';
import RiderForm from './views/RiderForm.vue';
import Neighborhoods from './views/Neighborhoods.vue';
import RiderAccount from './views/RiderAccount.vue';
import RiderAccountAdmin from './views/RiderAccountAdmin.vue';
import RiderAccountRider from './views/RiderAccountRider.vue';
import api from './api';
import { useAuthStore } from './stores/auth';
import RiderAdjustments from './views/RiderAdjustments.vue';
import CustomersList from './views/CustomersList.vue';
import CustomerForm from './views/CustomerForm.vue';
import CustomerProfile from './views/CustomerProfile.vue';
import IFoodIntegration from './views/IFoodIntegration.vue';
import Integrations from './views/Integrations.vue';
import IntegrationForm from './views/IntegrationForm.vue';
import Stores from './views/Stores.vue';
import TestTools from './views/TestTools.vue';
import PrinterSetup from './components/PrinterSetup.vue';
import AgentTokenAdmin from './views/AgentTokenAdmin.vue';
import StoreForm from './views/StoreForm.vue';
import FileSourceSettings from './views/FileSourceSettings.vue';
import CompanySettings from './views/CompanySettings.vue';
import FileSourcePreview from './views/FileSourcePreview.vue';
import AffiliateListing from './views/AffiliateListing.vue';
import AffiliateCreate from './views/AffiliateCreate.vue';
import AffiliateEdit from './views/AffiliateEdit.vue';
import AffiliateSaleNew from './views/AffiliateSaleNew.vue';
import AffiliatePaymentNew from './views/AffiliatePaymentNew.vue';
import AffiliateStatement from './views/AffiliateStatement.vue';
import CouponsList from './views/CouponsList.vue';
import CouponForm from './views/CouponForm.vue';
import PublicMenu from './views/PublicMenu.vue';
import PublicSlugResolver from './views/PublicSlugResolver.vue';
import OrderStatus from './views/OrderStatus.vue';
import OrderHistory from './views/OrderHistory.vue';
import MenuAdmin from './views/MenuAdmin.vue';
import Menus from './views/Menus.vue';
import MenuEdit from './views/MenuEdit.vue';
import MenuOptions from './views/MenuOptions.vue';
import OptionGroupForm from './views/OptionGroupForm.vue';
import OptionForm from './views/OptionForm.vue';
import PaymentMethods from './views/PaymentMethods.vue';
import PaymentMethodForm from './views/PaymentMethodForm.vue';
import ProductForm from './views/ProductForm.vue';
import CategoryForm from './views/CategoryForm.vue';
import Users from './views/Users.vue';
import AccessControl from './views/AccessControl.vue';
import RiderOrders from './views/RiderOrders.vue';
import RiderQrCode from './views/RiderQrCode.vue';
import RiderAccountSelf from './views/RiderAccountSelf.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: Login },
    { path: '/', redirect: '/orders' },
    { path: '/orders', component: Orders, meta: { requiresAuth: true } },
    { path: '/orders/:id/receipt', component: Receipt, meta: { requiresAuth: true } },
  { path: '/customers', component: CustomersList, meta: { requiresAuth: true } },
  { path: '/customers/new', component: CustomerForm, meta: { requiresAuth: true } },
  { path: '/customers/:id/edit', component: CustomerForm, meta: { requiresAuth: true } },
  { path: '/customers/:id', component: CustomerProfile, meta: { requiresAuth: true } },
  { path: '/riders', component: Riders, meta: { requiresAuth: true } },
  { path: '/riders/new', component: RiderForm, meta: { requiresAuth: true } },
  { path: '/riders/:id', component: RiderForm, meta: { requiresAuth: true } },
  { path: '/riders/:id/account', component: RiderAccountAdmin, meta: { requiresAuth: true, role: 'ADMIN' } },
  { path: '/rider-adjustments', component: RiderAdjustments, meta: { requiresAuth: true } },
  { path: '/settings/neighborhoods', component: Neighborhoods, meta: { requiresAuth: true } },
  { path: '/settings/company', component: CompanySettings, meta: { requiresAuth: true } },
    { path: '/settings/whatsapp', component: WhatsAppConnect, meta: { requiresAuth: true } },
  { path: '/settings/ifood', component: IFoodIntegration }, // 👈 AQUI
  { path: '/integrations', component: Integrations, meta: { requiresAuth: true } },
  { path: '/integrations/new', component: IntegrationForm, meta: { requiresAuth: true } },
  { path: '/integrations/:id', component: IntegrationForm, meta: { requiresAuth: true } },
  { path: '/settings/stores', component: Stores, meta: { requiresAuth: true } },
  { path: '/settings/stores/new', component: StoreForm, meta: { requiresAuth: true } },
  { path: '/settings/stores/:id', component: StoreForm, meta: { requiresAuth: true } },
  { path: '/settings/devtools', component: TestTools, meta: { requiresAuth: true } },
  { path: '/settings/printer-setup', component: PrinterSetup, meta: { requiresAuth: true } },
  { path: '/settings/agent-token', component: AgentTokenAdmin, meta: { requiresAuth: true, role: 'ADMIN' } },
  { path: '/settings/file-source', component: FileSourceSettings, meta: { requiresAuth: true } },
  { path: '/settings/file-source/preview', component: FileSourcePreview, meta: { requiresAuth: true } },
  { path: '/affiliates', component: AffiliateListing, meta: { requiresAuth: true } },
  { path: '/affiliates/new', component: AffiliateCreate, meta: { requiresAuth: true } },
  { path: '/affiliates/:id/edit', component: AffiliateEdit, meta: { requiresAuth: true } },
  { path: '/affiliates/:id/sales/new', component: AffiliateSaleNew, meta: { requiresAuth: true } },
  { path: '/affiliates/:id/payments/new', component: AffiliatePaymentNew, meta: { requiresAuth: true } },
  { path: '/affiliates/:id/statement', component: AffiliateStatement, meta: { requiresAuth: true } },
  { path: '/coupons', component: CouponsList, meta: { requiresAuth: true } },
  { path: '/coupons/new', component: CouponForm, meta: { requiresAuth: true } },
  { path: '/coupons/:id/edit', component: CouponForm, meta: { requiresAuth: true } },
  { path: '/claim/:token', component: Claim, meta: { requiresAuth: true } }
   ,{ path: '/rider/claim/:token', component: () => import('./views/RiderClaim.vue'), meta: { requiresAuth: true, noSidebar: true } }
   ,{ path: '/public/:storeSlug', component: PublicSlugResolver }
   ,{ path: '/public/:companyId/menu', component: PublicMenu }
  ,{ path: '/public/:companyId/order/:orderId', component: OrderStatus }
  ,{ path: '/public/:companyId/history', component: OrderHistory }
  ,{ path: '/public/:companyId/orders', redirect: to => ({ path: `/public/${to.params.companyId}/history`, query: to.query }) }
  ,{ path: '/menu/admin', component: MenuAdmin, meta: { requiresAuth: true } }
  ,{ path: '/menu/menus', component: Menus, meta: { requiresAuth: true } }
  ,{ path: '/menu/menus/new', component: MenuEdit, meta: { requiresAuth: true } }
  ,{ path: '/menu/menus/:id', component: MenuEdit, meta: { requiresAuth: true } }
   ,{ path: '/menu/options', component: MenuOptions, meta: { requiresAuth: true } }
  ,{ path: '/menu/options/groups/new', component: OptionGroupForm, meta: { requiresAuth: true } }
  ,{ path: '/menu/options/groups/:id', component: OptionGroupForm, meta: { requiresAuth: true } }
  ,{ path: '/menu/options/new', component: OptionForm, meta: { requiresAuth: true } }
  ,{ path: '/menu/options/:id', component: OptionForm, meta: { requiresAuth: true } }
  ,{ path: '/menu/payment-methods', redirect: '/settings/payment-methods' }
  ,{ path: '/settings/payment-methods', component: PaymentMethods, meta: { requiresAuth: true } }
  ,{ path: '/settings/payment-methods/new', component: PaymentMethodForm, meta: { requiresAuth: true } }
  ,{ path: '/settings/payment-methods/:id', component: PaymentMethodForm, meta: { requiresAuth: true } }
  ,{ path: '/settings/users', component: Users, meta: { requiresAuth: true } }
  ,{ path: '/settings/access-control', component: AccessControl, meta: { requiresAuth: true } }
  ,{ path: '/rider/orders', component: RiderOrders, meta: { requiresAuth: true, noSidebar: true } }
  ,{ path: '/rider/home', component: RiderQrCode, meta: { requiresAuth: true, noSidebar: true } }
  ,{ path: '/rider/account', component: RiderAccountRider, meta: { requiresAuth: true, role: 'RIDER', noSidebar: true } }
  ,{ path: '/menu/products/new', component: ProductForm, meta: { requiresAuth: true } }
  ,{ path: '/menu/products/:id', component: ProductForm, meta: { requiresAuth: true } }
  ,{ path: '/menu/categories/new', component: CategoryForm, meta: { requiresAuth: true } }
  ,{ path: '/menu/categories/:id', component: CategoryForm, meta: { requiresAuth: true } }
  ]
});

router.beforeEach(async (to) => {
  const token = localStorage.getItem('token');
  if (to.meta.requiresAuth && !token) {
    return { path: '/login', query: { redirect: to.fullPath } };
  }

  // role-based guard: if route requires a role, ensure current user has it
  if (to.meta && to.meta.role) {
    const auth = useAuthStore();
    // try to populate user if token exists but store is empty
    if (!auth.user && token) {
      try {
        const { data } = await api.get('/auth/me');
        if (data && data.user) auth.user = data.user;
      } catch (e) {
        // ignore — user will be treated as not authorized
        console.warn('router.beforeEach: /auth/me failed', e?.message || e);
      }
    }
    const roleNeeded = String(to.meta.role || '').toUpperCase();
    const userRole = String(auth.user?.role || '').toUpperCase();
    if (!auth.user || userRole !== roleNeeded) {
      // if rider trying to access admin route, send them to rider self page
      if (userRole === 'RIDER') return { path: '/rider/account' };
      return { path: '/' };
    }
  }
});

export default router;