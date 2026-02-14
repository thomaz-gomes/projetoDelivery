import { createRouter, createWebHistory } from 'vue-router';
import Login from './views/Login.vue';
import Register from './views/Register.vue';
import VerifyEmail from './views/VerifyEmail.vue';
import SetupCompany from './views/SetupCompany.vue';
import Orders from './views/Orders.vue';
import Claim from './views/Claim.vue';
import Receipt from './views/Receipt.vue';
import WhatsAppConnect from './views/whatsapp/WhatsAppConnect.vue';
import Riders from './views/Riders.vue';
import RiderForm from './views/RiderForm.vue';
import Neighborhoods from './views/Neighborhoods.vue';
import IngredientGroups from './views/stock/IngredientGroups.vue';
import Ingredients from './views/stock/Ingredients.vue';
import IngredientGroupForm from './views/stock/IngredientGroupForm.vue';
import IngredientForm from './views/stock/IngredientForm.vue';
import TechnicalSheets from './views/stock/TechnicalSheets.vue';
import TechnicalSheetEdit from './views/stock/TechnicalSheetEdit.vue';
import StockMovements from './views/stock/StockMovements.vue';
import StockMovementForm from './views/stock/StockMovementForm.vue';
import RiderAccount from './views/RiderAccount.vue';
import RiderAccountAdmin from './views/RiderAccountAdmin.vue';
import api from './api';
import { useAuthStore } from './stores/auth';
import RiderAdjustments from './views/RiderAdjustments.vue';
import CustomersList from './views/CustomersList.vue';
import CustomerForm from './views/CustomerForm.vue';
import CustomerProfile from './views/CustomerProfile.vue';
import CustomerGroupsList from './views/CustomerGroupsList.vue';
import CustomerGroupForm from './views/CustomerGroupForm.vue';
import IFoodIntegration from './views/IFoodIntegration.vue';
import MetaPixelIntegration from './views/MetaPixelIntegration.vue';
import Integrations from './views/Integrations.vue';
import IntegrationForm from './views/IntegrationForm.vue';
import Stores from './views/Stores.vue';
import TestTools from './views/TestTools.vue';
import PrinterSetup from './components/PrinterSetup.vue';
import AgentTokenAdmin from './views/AgentTokenAdmin.vue';
import StoreForm from './views/StoreForm.vue';
import FileSourceSettings from './views/FileSourceSettings.vue';
import FileSourcePreview from './views/FileSourcePreview.vue';
import AffiliateListing from './views/affiliates/AffiliateListing.vue';
import AffiliateCreate from './views/affiliates/AffiliateCreate.vue';
import AffiliateEdit from './views/affiliates/AffiliateEdit.vue';
import AffiliateSaleNew from './views/affiliates/AffiliateSaleNew.vue';
import AffiliatePaymentNew from './views/affiliates/AffiliatePaymentNew.vue';
import AffiliateStatement from './views/affiliates/AffiliateStatement.vue';
import AffiliateHome from './views/affiliates/AffiliateHome.vue';
import AffiliateStatementSelf from './views/affiliates/StatementSelf.vue';
import CouponsList from './views/coupons/CouponsList.vue';
import CouponForm from './views/coupons/CouponForm.vue';
import PublicMenu from './views/PublicMenu.vue';
import PublicSlugResolver from './views/PublicSlugResolver.vue';
import PublicProfile from './views/PublicProfile.vue';
import PublicTransactions from './views/PublicTransactions.vue';
import PublicProfileEdit from './views/PublicProfileEdit.vue';
import PublicProfilePassword from './views/PublicProfilePassword.vue';
import PublicAddresses from './views/PublicAddresses.vue';
import PublicOrderPrint from './views/PublicOrderPrint.vue';
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
import SalesHistory from './views/SalesHistory.vue';
import SaleDetails from './views/SaleDetails.vue';
import CashFronts from './views/CashFronts.vue';
import RiderOrders from './views/rider/Orders.vue';
import RiderQrCode from './views/rider/QrReader.vue';
import RiderAccountSelf from './views/rider/Account.vue';
import RiderDashboard from './views/rider/Dashboard.vue';
import SaasPlans from './views/SaasPlans.vue';
import SaasCompanies from './views/SaasCompanies.vue';
import SaasCompanyNew from './views/SaasCompanyNew.vue';
import SaasCompanyEdit from './views/SaasCompanyEdit.vue';
import SaasBilling from './views/SaasBilling.vue';
import SaasModules from './views/SaasModules.vue';
import SaasAdmin from './views/SaasAdmin.vue';
import CashbackSettings from './views/cashback/CashbackSettings.vue';
import FinancialDashboard from './views/financial/FinancialDashboard.vue';
import FinancialAccounts from './views/financial/FinancialAccounts.vue';
import FinancialTransactions from './views/financial/FinancialTransactions.vue';
import FinancialCashFlow from './views/financial/FinancialCashFlow.vue';
import FinancialDRE from './views/financial/FinancialDRE.vue';
import FinancialGateways from './views/financial/FinancialGateways.vue';
import FinancialOFX from './views/financial/FinancialOFX.vue';
import FinancialCostCenters from './views/financial/FinancialCostCenters.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: Login },
    { path: '/register', component: Register },
    { path: '/verify-email', component: VerifyEmail },
    { path: '/setup', component: SetupCompany, meta: { requiresAuth: true, noSidebar: true } },
    { path: '/', redirect: '/orders' },
    { path: '/orders', component: Orders, meta: { requiresAuth: true } },
    { path: '/orders/:id/receipt', component: Receipt, meta: { requiresAuth: true } },
  { path: '/customers', component: CustomersList, meta: { requiresAuth: true } },
  { path: '/customers/new', component: CustomerForm, meta: { requiresAuth: true } },
  { path: '/customers/:id/edit', component: CustomerForm, meta: { requiresAuth: true } },
  { path: '/customers/:id', component: CustomerProfile, meta: { requiresAuth: true } },
  { path: '/customer-groups', component: CustomerGroupsList, meta: { requiresAuth: true } },
  { path: '/customer-groups/new', component: CustomerGroupForm, meta: { requiresAuth: true } },
  { path: '/customer-groups/:id', component: CustomerGroupForm, meta: { requiresAuth: true } },
  { path: '/riders', component: Riders, meta: { requiresAuth: true } },
  { path: '/riders/new', component: RiderForm, meta: { requiresAuth: true } },
  { path: '/riders/:id', component: RiderForm, meta: { requiresAuth: true } },
  { path: '/riders/:id/account', component: RiderAccountAdmin, meta: { requiresAuth: true, role: 'ADMIN' } },
  { path: '/rider-adjustments', component: RiderAdjustments, meta: { requiresAuth: true } },
  { path: '/settings/neighborhoods', component: Neighborhoods, meta: { requiresAuth: true } },
  { path: '/ingredient-groups', component: IngredientGroups, meta: { requiresAuth: true } },
  { path: '/ingredient-groups/new', component: IngredientGroupForm, meta: { requiresAuth: true } },
  { path: '/ingredient-groups/:id/edit', component: IngredientGroupForm, meta: { requiresAuth: true } },
  { path: '/ingredients', component: Ingredients, meta: { requiresAuth: true } },
  { path: '/ingredients/new', component: IngredientForm, meta: { requiresAuth: true } },
  { path: '/ingredients/:id', component: IngredientForm, meta: { requiresAuth: true } },
  { path: '/technical-sheets', component: TechnicalSheets, meta: { requiresAuth: true } },
  { path: '/technical-sheets/:id/edit', component: TechnicalSheetEdit, meta: { requiresAuth: true } },
  { path: '/stock-movements', component: StockMovements, meta: { requiresAuth: true } },
  { path: '/stock-movements/new', component: StockMovementForm, meta: { requiresAuth: true } },
  { path: '/stock-movements/:id', component: StockMovementForm, meta: { requiresAuth: true } },
    { path: '/settings/whatsapp', component: WhatsAppConnect, meta: { requiresAuth: true } },
  { path: '/settings/ifood', component: IFoodIntegration },
  { path: '/settings/meta-pixel', component: MetaPixelIntegration, meta: { requiresAuth: true } },
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
  ,{ path: '/public/:companyId/profile', component: PublicProfile }
  ,{ path: '/public/:companyId/profile/transactions', component: PublicTransactions }
  ,{ path: '/public/:companyId/profile/edit', component: PublicProfileEdit }
  ,{ path: '/public/:companyId/profile/password', component: PublicProfilePassword }
  ,{ path: '/public/:companyId/addresses', component: PublicAddresses }
  ,{ path: '/public/:companyId/order/:orderId', component: OrderStatus }
  ,{ path: '/public/:companyId/order/:orderId/print', component: PublicOrderPrint }
  ,{ path: '/public/:companyId/history', component: OrderHistory }
  ,{ path: '/public/:companyId/orders', redirect: (to) => {
      if(!to || !to.params) return '/';
      return { path: `/public/${to.params.companyId}/history`, query: to.query || {} };
    } }
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
  ,{ path: '/rider/account', component: RiderAccountSelf, meta: { requiresAuth: true, role: 'RIDER', noSidebar: true } }
  ,{ path: '/rider', component: RiderDashboard, meta: { requiresAuth: true, role: 'RIDER', noSidebar: true } }
  ,{ path: '/affiliate', component: AffiliateHome, meta: { requiresAuth: true, noSidebar: true } }
  ,{ path: '/affiliate/statement', component: AffiliateStatementSelf, meta: { requiresAuth: true, noSidebar: true } }
  ,{ path: '/menu/products/new', component: ProductForm, meta: { requiresAuth: true } }
  ,{ path: '/menu/products/:id', component: ProductForm, meta: { requiresAuth: true } }
  ,{ path: '/menu/categories/new', component: CategoryForm, meta: { requiresAuth: true } }
  ,{ path: '/menu/categories/:id', component: CategoryForm, meta: { requiresAuth: true } }
  ,{ path: '/sales', component: SalesHistory, meta: { requiresAuth: true } }
  ,{ path: '/sales/:id', component: SaleDetails, meta: { requiresAuth: true } }
  ,{ path: '/reports/cash-fronts', component: CashFronts, meta: { requiresAuth: true } }
  ,{ path: '/saas/plans', component: SaasPlans, meta: { requiresAuth: true, role: 'SUPER_ADMIN' } }
  ,{ path: '/saas/companies', component: SaasCompanies, meta: { requiresAuth: true, role: 'SUPER_ADMIN' } }
  ,{ path: '/saas/companies/new', component: SaasCompanyNew, meta: { requiresAuth: true, role: 'SUPER_ADMIN' } }
  ,{ path: '/saas/companies/:id/edit', component: SaasCompanyEdit, meta: { requiresAuth: true, role: ['ADMIN', 'SUPER_ADMIN'] } }
  ,{ path: '/saas/modules', component: SaasModules, meta: { requiresAuth: true, role: 'SUPER_ADMIN' } }
  ,{ path: '/saas/billing', component: SaasBilling, meta: { requiresAuth: true, role: ['ADMIN','SUPER_ADMIN'] } }
  ,{ path: '/saas', component: SaasAdmin, meta: { requiresAuth: true, role: 'SUPER_ADMIN' } },
    { path: '/settings/cashback', component: CashbackSettings, meta: { requiresAuth: true } },
    // ---- Módulo Financeiro ----
    { path: '/financial', component: FinancialDashboard, meta: { requiresAuth: true, role: 'ADMIN' } },
    { path: '/financial/accounts', component: FinancialAccounts, meta: { requiresAuth: true, role: 'ADMIN' } },
    { path: '/financial/transactions', component: FinancialTransactions, meta: { requiresAuth: true, role: 'ADMIN' } },
    { path: '/financial/cash-flow', component: FinancialCashFlow, meta: { requiresAuth: true, role: 'ADMIN' } },
    { path: '/financial/dre', component: FinancialDRE, meta: { requiresAuth: true, role: 'ADMIN' } },
    { path: '/financial/gateways', component: FinancialGateways, meta: { requiresAuth: true, role: 'ADMIN' } },
    { path: '/financial/ofx', component: FinancialOFX, meta: { requiresAuth: true, role: 'ADMIN' } },
    { path: '/financial/cost-centers', component: FinancialCostCenters, meta: { requiresAuth: true, role: 'ADMIN' } },
  ]
});

router.beforeEach(async (to) => {
  const token = localStorage.getItem('token');
  if (to.meta.requiresAuth && !token) {
    return { path: '/login', query: { redirect: to.fullPath } };
  }

  // Redirect users without company to setup (except if already on /setup)
  if (token && to.meta.requiresAuth && to.path !== '/setup') {
    const auth = useAuthStore();
    if (!auth.user && token) {
      try {
        const { data } = await api.get('/auth/me');
        if (data && data.user) auth.user = data.user;
      } catch (e) { /* ignore */ }
    }
    if (auth.user && !auth.user.companyId && auth.user.role !== 'SUPER_ADMIN') {
      return { path: '/setup' };
    }
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
    const allowed = Array.isArray(to.meta.role) ? to.meta.role.map(r => String(r).toUpperCase()) : String(to.meta.role || '').split(/[,|]/).map(s => s.trim().toUpperCase()).filter(Boolean)
    const userRole = String(auth.user?.role || '').toUpperCase();
    if (!auth.user || !allowed.includes(userRole)) {
      // if rider trying to access admin route, send them to rider self page
      if (userRole === 'RIDER') return { path: '/rider/account' };
      return { path: '/' };
    }
  }
});

export default router;