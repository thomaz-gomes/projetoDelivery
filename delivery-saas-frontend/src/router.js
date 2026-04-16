import { createRouter, createWebHistory } from 'vue-router';
import Login from './views/Login.vue';
import LoginRider from './views/LoginRider.vue';
import LoginAffiliate from './views/LoginAffiliate.vue';
import Register from './views/Register.vue';
import VerifyEmail from './views/VerifyEmail.vue';
import SetupCompany from './views/SetupCompany.vue';
import Orders from './views/Orders.vue';
import Claim from './views/Claim.vue';
import Receipt from './views/Receipt.vue';
import WhatsAppConnect from './views/whatsapp/WhatsAppConnect.vue';
import Inbox from './views/inbox/Inbox.vue';
const QuickReplies = () => import('./views/inbox/settings/QuickReplies.vue');
const InboxAutomation = () => import('./views/inbox/settings/InboxAutomation.vue');
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
import PurchaseImports from './views/stock/PurchaseImports.vue';
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
import IntegrationCodes from './views/IntegrationCodes.vue';
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
import SaasSettings from './views/SaasSettings.vue';
import SaasAiUsage from './views/SaasAiUsage.vue';
const SaasGatewayConfig = () => import('./views/SaasGatewayConfig.vue')
const SaasSuperAdmins = () => import('./views/SaasSuperAdmins.vue')
const AdminBilling = () => import('./views/AdminBilling.vue')
import CashbackSettings from './views/cashback/CashbackSettings.vue';
import NfeEmissao from './views/NfeEmissao.vue';
import NfeEmissoesRelatorio from './views/NfeEmissoesRelatorio.vue';
import DadosFiscaisSettings from './views/DadosFiscaisSettings.vue';
import DadosFiscaisForm from './views/DadosFiscaisForm.vue';
import FinancialDashboard from './views/financial/FinancialDashboard.vue';
import FinancialAccounts from './views/financial/FinancialAccounts.vue';
import FinancialTransactions from './views/financial/FinancialTransactions.vue';
import FinancialCashFlow from './views/financial/FinancialCashFlow.vue';
import FinancialDRE from './views/financial/FinancialDRE.vue';
import FinancialGateways from './views/financial/FinancialGateways.vue';
import FinancialOFX from './views/financial/FinancialOFX.vue';
import FinancialCostCenters from './views/financial/FinancialCostCenters.vue';
import PayablePaymentMethods from './views/financial/PayablePaymentMethods.vue';
import ProductsReport from './views/reports/ProductsReport.vue';
import MenuPerformanceReport from './views/reports/MenuPerformanceReport.vue';
import RidersDashboard from './views/reports/RidersDashboard.vue';
import StudioIA from './views/StudioIA.vue';
import AddOnStore from './views/AddOnStore.vue';
import AddOnDetail from './views/AddOnDetail.vue';
import CreditPackStore from './views/CreditPackStore.vue';
import PaymentResult from './views/PaymentResult.vue';
import TrialActivationWizard from './views/TrialActivationWizard.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: Login },
    { path: '/login/rider', component: LoginRider },
    { path: '/login/affiliate', component: LoginAffiliate },
    { path: '/register', component: Register },
    { path: '/termos-de-servico', component: () => import('./views/TermosDeServico.vue') },
    { path: '/politica-de-privacidade', component: () => import('./views/PoliticaDePrivacidade.vue') },
    { path: '/verify-email', component: VerifyEmail },
    { path: '/setup', component: SetupCompany, meta: { requiresAuth: true, noSidebar: true } },
    { path: '/', component: () => import('./views/LandingPage.vue'), beforeEnter: async () => {
        const token = localStorage.getItem('token')
        if (!token) return true
        // Riders should go to their own dashboard, not admin panels
        const auth = useAuthStore()
        if (!auth.user && token) {
          try { const { data } = await api.get('/auth/me'); if (data && data.user) auth.user = data.user } catch {}
        }
        if (String(auth.user?.role || '').toUpperCase() === 'RIDER') return { path: '/rider' }
        const { useModulesStore } = await import('./stores/modules')
        const modules = useModulesStore()
        if (!modules.enabled.length) {
          try { await modules.fetchEnabled() } catch {}
        }
        const isSimples = modules.has('CARDAPIO_SIMPLES') && !modules.has('CARDAPIO_COMPLETO')
        return { path: isSimples ? '/menu/menus' : '/orders' }
      }
    },
    { path: '/orders', component: Orders, meta: { requiresAuth: true, requiresModule: 'CARDAPIO_COMPLETO' } },
    { path: '/orders/:id/receipt', component: Receipt, meta: { requiresAuth: true, requiresModule: 'CARDAPIO_COMPLETO' } },
  { path: '/customers', component: CustomersList, meta: { requiresAuth: true, requiresModule: 'CARDAPIO_COMPLETO' } },
  { path: '/customers/new', component: CustomerForm, meta: { requiresAuth: true, requiresModule: 'CARDAPIO_COMPLETO' } },
  { path: '/customers/:id', component: CustomerProfile, meta: { requiresAuth: true, requiresModule: 'CARDAPIO_COMPLETO' } },
  { path: '/customer-groups', component: CustomerGroupsList, meta: { requiresAuth: true, role: 'ADMIN', requiresModule: 'CARDAPIO_COMPLETO' } },
  { path: '/customer-groups/new', component: CustomerGroupForm, meta: { requiresAuth: true, role: 'ADMIN', requiresModule: 'CARDAPIO_COMPLETO' } },
  { path: '/customer-groups/:id', component: CustomerGroupForm, meta: { requiresAuth: true, role: 'ADMIN', requiresModule: 'CARDAPIO_COMPLETO' } },
  { path: '/riders', component: Riders, meta: { requiresAuth: true, role: 'ADMIN', requiresModule: 'RIDERS' } },
  { path: '/riders/new', component: RiderForm, meta: { requiresAuth: true, role: 'ADMIN', requiresModule: 'RIDERS' } },
  { path: '/riders/:id', component: RiderForm, meta: { requiresAuth: true, role: 'ADMIN', requiresModule: 'RIDERS' } },
  { path: '/riders/:id/account', component: RiderAccountAdmin, meta: { requiresAuth: true, role: 'ADMIN', requiresModule: 'RIDERS' } },
  { path: '/rider-adjustments', component: RiderAdjustments, meta: { requiresAuth: true, role: 'ADMIN', requiresModule: 'RIDERS' } },
  { path: '/settings/neighborhoods', component: Neighborhoods, meta: { requiresAuth: true, role: 'ADMIN', requiresModule: 'CARDAPIO_COMPLETO' } },
  { path: '/settings/dados-fiscais', component: DadosFiscaisSettings, meta: { requiresAuth: true, role: 'ADMIN', requiresModule: 'FISCAL' } },
  { path: '/settings/dados-fiscais/new', component: DadosFiscaisForm, meta: { requiresAuth: true, role: 'ADMIN', requiresModule: 'FISCAL' } },
  { path: '/settings/dados-fiscais/:id', component: DadosFiscaisForm, meta: { requiresAuth: true, role: 'ADMIN', requiresModule: 'FISCAL' } },
  { path: '/ingredient-groups', component: IngredientGroups, meta: { requiresAuth: true, role: 'ADMIN', requiresModule: 'STOCK' } },
  { path: '/ingredient-groups/new', component: IngredientGroupForm, meta: { requiresAuth: true, role: 'ADMIN', requiresModule: 'STOCK' } },
  { path: '/ingredient-groups/:id/edit', component: IngredientGroupForm, meta: { requiresAuth: true, role: 'ADMIN', requiresModule: 'STOCK' } },
  { path: '/ingredients', component: Ingredients, meta: { requiresAuth: true, role: 'ADMIN', requiresModule: 'STOCK' } },
  { path: '/ingredients/new', component: IngredientForm, meta: { requiresAuth: true, role: 'ADMIN', requiresModule: 'STOCK' } },
  { path: '/ingredients/:id', component: IngredientForm, meta: { requiresAuth: true, role: 'ADMIN', requiresModule: 'STOCK' } },
  { path: '/technical-sheets', component: TechnicalSheets, meta: { requiresAuth: true, role: 'ADMIN', requiresModule: 'STOCK' } },
  { path: '/technical-sheets/:id/edit', component: TechnicalSheetEdit, meta: { requiresAuth: true, role: 'ADMIN', requiresModule: 'STOCK' } },
  { path: '/stock-movements', component: StockMovements, meta: { requiresAuth: true, role: 'ADMIN', requiresModule: 'STOCK' } },
  { path: '/stock-movements/new', component: StockMovementForm, meta: { requiresAuth: true, role: 'ADMIN', requiresModule: 'STOCK' } },
  { path: '/stock-movements/:id', component: StockMovementForm, meta: { requiresAuth: true, role: 'ADMIN', requiresModule: 'STOCK' } },
  { path: '/stock/purchase-imports', component: PurchaseImports, meta: { requiresAuth: true, role: 'ADMIN', requiresModule: 'STOCK' } },
    { path: '/inbox', component: Inbox, meta: { requiresAuth: true, requiresModule: 'WHATSAPP' } },
    { path: '/inbox/quick-replies', component: QuickReplies, meta: { requiresAuth: true, role: 'ADMIN', requiresModule: 'WHATSAPP' } },
    { path: '/inbox/automation', component: InboxAutomation, meta: { requiresAuth: true, role: 'ADMIN', requiresModule: 'WHATSAPP' } },
    { path: '/settings/whatsapp', component: WhatsAppConnect, meta: { requiresAuth: true, role: 'ADMIN', requiresModule: 'WHATSAPP' } },
  { path: '/settings/ifood', component: IFoodIntegration, meta: { requiresAuth: true, role: 'ADMIN', requiresModule: 'CARDAPIO_COMPLETO' } },
  { path: '/settings/integrations/aiqfome', component: () => import('./components/AiqfomeConfig.vue'), meta: { requiresAuth: true, role: 'ADMIN' } },
  { path: '/settings/meta-pixel', component: MetaPixelIntegration, meta: { requiresAuth: true, role: 'ADMIN', requiresModule: 'CARDAPIO_COMPLETO' } },
  { path: '/integrations', component: Integrations, meta: { requiresAuth: true, role: 'ADMIN', requiresModule: 'CARDAPIO_COMPLETO' } },
  { path: '/integrations/new', component: IntegrationForm, meta: { requiresAuth: true, role: 'ADMIN', requiresModule: 'CARDAPIO_COMPLETO' } },
  { path: '/integrations/:id', component: IntegrationForm, meta: { requiresAuth: true, role: 'ADMIN', requiresModule: 'CARDAPIO_COMPLETO' } },
  { path: '/settings/stores', component: Stores, meta: { requiresAuth: true, role: 'ADMIN' } },
  { path: '/settings/stores/new', component: StoreForm, meta: { requiresAuth: true, role: 'ADMIN' } },
  { path: '/settings/stores/:id', component: StoreForm, meta: { requiresAuth: true, role: 'ADMIN' } },
  { path: '/settings/devtools', component: TestTools, meta: { requiresAuth: true, role: 'ADMIN' } },
  { path: '/settings/printer-setup', component: PrinterSetup, meta: { requiresAuth: true, role: 'ADMIN' } },
  { path: '/settings/agent-token', component: AgentTokenAdmin, meta: { requiresAuth: true, role: 'ADMIN' } },
  { path: '/settings/file-source', component: FileSourceSettings, meta: { requiresAuth: true, role: 'ADMIN' } },
  { path: '/settings/file-source/preview', component: FileSourcePreview, meta: { requiresAuth: true, role: 'ADMIN' } },
  { path: '/affiliates', component: AffiliateListing, meta: { requiresAuth: true, role: 'ADMIN', requiresModule: 'AFFILIATES' } },
  { path: '/affiliates/new', component: AffiliateCreate, meta: { requiresAuth: true, role: 'ADMIN', requiresModule: 'AFFILIATES' } },
  { path: '/affiliates/:id/edit', component: AffiliateEdit, meta: { requiresAuth: true, role: 'ADMIN', requiresModule: 'AFFILIATES' } },
  { path: '/affiliates/:id/sales/new', component: AffiliateSaleNew, meta: { requiresAuth: true, role: 'ADMIN', requiresModule: 'AFFILIATES' } },
  { path: '/affiliates/:id/payments/new', component: AffiliatePaymentNew, meta: { requiresAuth: true, role: 'ADMIN', requiresModule: 'AFFILIATES' } },
  { path: '/affiliates/:id/statement', component: AffiliateStatement, meta: { requiresAuth: true, role: 'ADMIN', requiresModule: 'AFFILIATES' } },
  { path: '/marketing/studio-ia', component: StudioIA, meta: { requiresAuth: true, role: 'ADMIN' } },
  { path: '/coupons', component: CouponsList, meta: { requiresAuth: true, role: 'ADMIN', requiresModule: 'COUPONS' } },
  { path: '/coupons/new', component: CouponForm, meta: { requiresAuth: true, role: 'ADMIN', requiresModule: 'COUPONS' } },
  { path: '/coupons/:id/edit', component: CouponForm, meta: { requiresAuth: true, role: 'ADMIN', requiresModule: 'COUPONS' } },
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
  ,{ path: '/menu/admin', component: MenuAdmin, meta: { requiresAuth: true, role: 'ATTENDANT' } }
  ,{ path: '/menu/menus', component: Menus, meta: { requiresAuth: true, role: 'ATTENDANT' } }
  ,{ path: '/menu/menus/new', component: MenuEdit, meta: { requiresAuth: true, role: 'ADMIN' } }
  ,{ path: '/menu/menus/:id', component: MenuEdit, meta: { requiresAuth: true, role: 'ADMIN' } }
   ,{ path: '/menu/integration', component: IntegrationCodes, meta: { requiresAuth: true, role: 'ADMIN', requiresModule: 'CARDAPIO_COMPLETO' } }
   ,{ path: '/menu/options', component: MenuOptions, meta: { requiresAuth: true, role: 'ADMIN' } }
  ,{ path: '/menu/options/groups/new', component: OptionGroupForm, meta: { requiresAuth: true, role: 'ADMIN' } }
  ,{ path: '/menu/options/groups/:id', component: OptionGroupForm, meta: { requiresAuth: true, role: 'ADMIN' } }
  ,{ path: '/menu/options/new', component: OptionForm, meta: { requiresAuth: true, role: 'ADMIN' } }
  ,{ path: '/menu/options/:id', component: OptionForm, meta: { requiresAuth: true, role: 'ADMIN' } }
  ,{ path: '/menu/payment-methods', redirect: '/settings/payment-methods' }
  ,{ path: '/settings/payment-methods', component: PaymentMethods, meta: { requiresAuth: true, role: 'ADMIN' } }
  ,{ path: '/settings/payment-methods/new', component: PaymentMethodForm, meta: { requiresAuth: true, role: 'ADMIN' } }
  ,{ path: '/settings/payment-methods/:id', component: PaymentMethodForm, meta: { requiresAuth: true, role: 'ADMIN' } }
  ,{ path: '/settings/users', component: Users, meta: { requiresAuth: true, role: 'ADMIN' } }
  ,{ path: '/settings/access-control', component: AccessControl, meta: { requiresAuth: true, role: 'ADMIN' } }
  ,{ path: '/rider/orders', component: RiderOrders, meta: { requiresAuth: true, noSidebar: true } }
  ,{ path: '/rider/home', component: RiderQrCode, meta: { requiresAuth: true, noSidebar: true } }
  ,{ path: '/rider/account', component: RiderAccountSelf, meta: { requiresAuth: true, role: 'RIDER', noSidebar: true } }
  ,{ path: '/rider/checkin', component: () => import('./views/rider/Checkin.vue'), meta: { requiresAuth: true, role: 'RIDER', noSidebar: true } }
  ,{ path: '/rider/ranking', component: () => import('./views/rider/Ranking.vue'), meta: { requiresAuth: true, role: 'RIDER', noSidebar: true } }
  ,{ path: '/rider', component: RiderDashboard, meta: { requiresAuth: true, role: 'RIDER', noSidebar: true } }
  ,{ path: '/riders/map', component: () => import('./views/RiderMap.vue'), meta: { requiresAuth: true, role: 'ADMIN', requiresModule: 'RIDERS' } }
  ,{ path: '/settings/rider-tracking', component: () => import('./views/RiderTracking.vue'), meta: { requiresAuth: true, role: 'ADMIN', requiresModule: 'RIDERS' } }
  ,{ path: '/settings/rider-shifts', component: () => import('./views/RiderShifts.vue'), meta: { requiresAuth: true, role: 'ADMIN', requiresModule: 'RIDERS' } }
  ,{ path: '/settings/rider-bonus-rules', component: () => import('./views/RiderBonusRules.vue'), meta: { requiresAuth: true, role: 'ADMIN', requiresModule: 'RIDERS' } }
  ,{ path: '/affiliate', component: AffiliateHome, meta: { requiresAuth: true, noSidebar: true } }
  ,{ path: '/affiliate/statement', component: AffiliateStatementSelf, meta: { requiresAuth: true, noSidebar: true } }
  ,{ path: '/menu/products/new', component: ProductForm, meta: { requiresAuth: true, role: 'ADMIN' } }
  ,{ path: '/menu/products/:id', component: ProductForm, meta: { requiresAuth: true, role: 'ADMIN' } }
  ,{ path: '/menu/categories/new', component: CategoryForm, meta: { requiresAuth: true, role: 'ADMIN' } }
  ,{ path: '/menu/categories/:id', component: CategoryForm, meta: { requiresAuth: true, role: 'ADMIN' } }
  ,{ path: '/sales', component: SalesHistory, meta: { requiresAuth: true, role: 'ADMIN', requiresModule: 'CARDAPIO_COMPLETO' } }
  ,{ path: '/sales/:id', component: SaleDetails, meta: { requiresAuth: true, role: 'ADMIN', requiresModule: 'CARDAPIO_COMPLETO' } }
  ,{ path: '/reports/cash-fronts', component: CashFronts, meta: { requiresAuth: true, role: 'ADMIN', requiresModule: 'CARDAPIO_COMPLETO' } }
  ,{ path: '/reports/products', component: ProductsReport, meta: { requiresAuth: true, role: 'ADMIN', requiresModule: 'CARDAPIO_COMPLETO' } }
  ,{ path: '/reports/menu-performance', component: MenuPerformanceReport, meta: { requiresAuth: true, role: 'ADMIN', requiresModule: 'CARDAPIO_COMPLETO' } }
  ,{ path: '/reports/riders-dashboard', component: RidersDashboard, meta: { requiresAuth: true, role: 'ADMIN', requiresModule: 'RIDERS' } }
  ,{ path: '/reports/rider-checkins', component: () => import('./views/RiderCheckins.vue'), meta: { requiresAuth: true, role: 'ADMIN', requiresModule: 'RIDERS' } }
  ,{ path: '/reports/rider-ranking', component: () => import('./views/RiderRanking.vue'), meta: { requiresAuth: true, role: 'ADMIN', requiresModule: 'RIDERS' } }
  ,{ path: '/saas/plans', component: SaasPlans, meta: { requiresAuth: true, role: 'SUPER_ADMIN' } }
  ,{ path: '/saas/companies', component: SaasCompanies, meta: { requiresAuth: true, role: 'SUPER_ADMIN' } }
  ,{ path: '/saas/companies/new', component: SaasCompanyNew, meta: { requiresAuth: true, role: 'SUPER_ADMIN' } }
  ,{ path: '/saas/companies/:id/edit', component: SaasCompanyEdit, meta: { requiresAuth: true, role: ['ADMIN', 'SUPER_ADMIN'] } }
  ,{ path: '/saas/modules', component: SaasModules, meta: { requiresAuth: true, role: 'SUPER_ADMIN' } }
  ,{ path: '/saas/billing', component: SaasBilling, meta: { requiresAuth: true, role: ['ADMIN','SUPER_ADMIN'] } }
  ,{ path: '/saas/settings', component: SaasSettings, meta: { requiresAuth: true, role: 'SUPER_ADMIN' } }
  ,{ path: '/saas/ai-usage', component: SaasAiUsage, meta: { requiresAuth: true, role: 'SUPER_ADMIN' } }
  ,{ path: '/saas/gateway', component: SaasGatewayConfig, meta: { requiresAuth: true, role: 'SUPER_ADMIN' } }
  ,{ path: '/saas/super-admins', component: SaasSuperAdmins, meta: { requiresAuth: true, role: 'MASTER' } }
  ,{ path: '/saas', component: SaasAdmin, meta: { requiresAuth: true, role: 'SUPER_ADMIN' } },
    { path: '/settings/cashback', component: CashbackSettings, meta: { requiresAuth: true, role: 'ADMIN', requiresModule: 'CASHBACK' } },
    { path: '/nfe/emissao', component: NfeEmissao, meta: { requiresAuth: true, role: 'ADMIN', requiresModule: 'FISCAL' } },
    { path: '/relatorios/nfe-emissoes', component: NfeEmissoesRelatorio, meta: { requiresAuth: true, role: ['ADMIN', 'SUPER_ADMIN'], requiresModule: 'FISCAL' } },
    // ---- Módulo Financeiro ----
    { path: '/financial', redirect: '/financial/health' },
    { path: '/financial/health', name: 'BusinessHealth', component: () => import('@/views/financial/BusinessHealth.vue'), meta: { requiresAuth: true, role: 'ADMIN', requiresModule: 'FINANCIAL' } },
    { path: '/financial/dashboard', name: 'FinancialDashboard', component: FinancialDashboard, meta: { requiresAuth: true, role: 'ADMIN', requiresModule: 'FINANCIAL' } },
    { path: '/financial/accounts', component: FinancialAccounts, meta: { requiresAuth: true, role: 'ADMIN', requiresModule: 'FINANCIAL' } },
    { path: '/financial/transactions', component: FinancialTransactions, meta: { requiresAuth: true, role: 'ADMIN', requiresModule: 'FINANCIAL' } },
    { path: '/financial/cash-flow', component: FinancialCashFlow, meta: { requiresAuth: true, role: 'ADMIN', requiresModule: 'FINANCIAL' } },
    { path: '/financial/dre', component: FinancialDRE, meta: { requiresAuth: true, role: 'ADMIN', requiresModule: 'FINANCIAL' } },
    { path: '/financial/gateways', component: FinancialGateways, meta: { requiresAuth: true, role: 'ADMIN', requiresModule: 'FINANCIAL' } },
    { path: '/financial/ofx', component: FinancialOFX, meta: { requiresAuth: true, role: 'ADMIN', requiresModule: 'FINANCIAL' } },
    { path: '/financial/cost-centers', component: FinancialCostCenters, meta: { requiresAuth: true, role: 'ADMIN', requiresModule: 'FINANCIAL' } },
    { path: '/financial/payment-methods', component: PayablePaymentMethods, meta: { requiresAuth: true, role: 'ADMIN', requiresModule: 'FINANCIAL' } },
    // ---- Loja de Complementos ----
    { path: '/store', component: AddOnStore, meta: { requiresAuth: true, role: 'ADMIN' } },
    { path: '/store/credits', component: CreditPackStore, meta: { requiresAuth: true, role: 'ADMIN' } },
    { path: '/payment/result', component: PaymentResult, meta: { requiresAuth: true } },
    { path: '/trial/activate', component: TrialActivationWizard, meta: { requiresAuth: true, noSidebar: true } },
    { path: '/store/:moduleKey', component: AddOnDetail, meta: { requiresAuth: true, role: 'ADMIN' } },
    { path: '/billing', component: AdminBilling, meta: { requiresAuth: true, role: 'ADMIN' } },
    { path: '/:pathMatch(.*)*', name: 'NotFound', component: () => import('./views/NotFound.vue') },
  ]
});

// Custom domain detection: if the hostname is not a known system domain,
// resolve it via backend and redirect to the public menu.
let _customDomainResolved = false
const SYSTEM_HOSTS = ['localhost', '127.0.0.1']

function isSystemDomain(hostname) {
  const h = hostname.toLowerCase()
  if (SYSTEM_HOSTS.includes(h)) return true
  // IP addresses
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) return true
  // Check VITE_API_URL domain — if the app domain matches the API domain's base, it's system
  try {
    const apiUrl = import.meta.env.VITE_API_URL
    if (apiUrl) {
      const apiHost = new URL(apiUrl).hostname.toLowerCase()
      // Same base domain (e.g., api.deliverysaas.com.br → deliverysaas.com.br)
      const apiBase = apiHost.replace(/^api\./, '')
      if (h === apiHost || h === apiBase || h.endsWith('.' + apiBase)) return true
    }
  } catch {}
  return false
}

// Role hierarchy: higher roles inherit access from lower roles
const ROLE_HIERARCHY = { MASTER: 5, SUPER_ADMIN: 4, ADMIN: 3, ATTENDANT: 2, RIDER: 1 }

function roleLevel(role) {
  return ROLE_HIERARCHY[String(role || '').toUpperCase()] || 0
}

function isRoleAllowed(userRole, allowedRoles) {
  const ur = String(userRole || '').toUpperCase()
  const userLevel = roleLevel(ur)
  // Use hierarchy: user passes if their level >= any of the allowed roles
  const list = Array.isArray(allowedRoles)
    ? allowedRoles.map(r => String(r).toUpperCase())
    : String(allowedRoles || '').split(/[,|]/).map(s => s.trim().toUpperCase()).filter(Boolean)
  return list.some(r => userLevel >= roleLevel(r))
}

// Ensure auth.user is populated (single call per navigation)
async function ensureUser(auth, token) {
  if (auth.user || !token) return
  try {
    const { data } = await api.get('/auth/me')
    if (data && data.user) auth.user = data.user
  } catch (e) {
    console.warn('router.beforeEach: /auth/me failed', e?.message || e)
  }
}

router.beforeEach(async (to) => {
  // Custom domain resolution: redirect to public menu if on a custom domain
  if (!_customDomainResolved && typeof window !== 'undefined') {
    _customDomainResolved = true
    const hostname = window.location.hostname
    if (!isSystemDomain(hostname) && !to.path.startsWith('/public/')) {
      try {
        const res = await fetch(`/api/custom-domains/resolve-public?domain=${encodeURIComponent(hostname)}`)
        if (res.ok) {
          const data = await res.json()
          if (data && data.companyId) {
            const query = {}
            if (data.menuId) query.menuId = data.menuId
            return { path: `/public/${data.companyId}/menu`, query }
          }
        }
      } catch (e) {
        console.warn('Custom domain resolve failed:', e?.message || e)
      }
    }
  }

  const token = localStorage.getItem('token');
  if (to.meta.requiresAuth && !token) {
    return { path: '/login', query: { redirect: to.fullPath } };
  }

  // Populate user once for all subsequent checks
  if (token && to.meta.requiresAuth) {
    const auth = useAuthStore()
    await ensureUser(auth, token)
    const userRole = String(auth.user?.role || '').toUpperCase()

    // Redirect users without company to setup (except SUPER_ADMIN)
    if (to.path !== '/setup' && auth.user && !auth.user.companyId && userRole !== 'SUPER_ADMIN' && userRole !== 'MASTER') {
      return { path: '/setup' }
    }

    // Rider containment: riders may ONLY access /rider/*, /public/*, /login*
    if (userRole === 'RIDER' && !to.path.startsWith('/rider') && !to.path.startsWith('/public') && !to.path.startsWith('/login') && to.path !== '/' && to.path !== '/setup') {
      return { path: '/rider' }
    }

    // Attendant containment: attendants may only access allowed paths
    if (userRole === 'ATTENDANT') {
      const attendantAllowed = ['/orders', '/customers', '/inbox', '/menu/admin', '/menu/menus', '/public', '/login', '/setup', '/billing', '/payment']
      const isAllowed = attendantAllowed.some(p => to.path === p || to.path.startsWith(p + '/'))
      if (!isAllowed && to.path !== '/') {
        return { path: '/orders' }
      }
    }

    // Role-based guard: if route requires a role, check with hierarchy
    if (to.meta.role) {
      if (!auth.user || !isRoleAllowed(userRole, to.meta.role)) {
        if (userRole === 'RIDER') return { path: '/rider/account' }
        if (userRole === 'ATTENDANT') return { path: '/orders' }
        return { path: '/' }
      }
    }

    // Module guard: block routes requiring a module the user doesn't have (applies to all non-SUPER_ADMIN roles)
    if (to.meta.requiresModule && userRole !== 'SUPER_ADMIN' && userRole !== 'MASTER') {
      const { useModulesStore } = await import('./stores/modules')
      const modules = useModulesStore()
      if (!modules.enabled.length) {
        try { await modules.fetchEnabled() } catch {}
      }
      if (!modules.has(to.meta.requiresModule)) {
        const isSimples = modules.has('CARDAPIO_SIMPLES') && !modules.has('CARDAPIO_COMPLETO')
        if (userRole === 'ATTENDANT') return { path: '/orders' }
        return { path: isSimples ? '/menu/menus' : '/orders' }
      }
    }
  }
});

export default router;