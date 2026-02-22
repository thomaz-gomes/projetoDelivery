// navigation structure shared between Sidebar and App
export const nav = [
  { name: 'Pedidos', to: '/orders', icon: 'bi bi-box-seam' },
  { name: 'Relatórios', to: '/reports', icon: 'bi bi-file-earmark-bar-graph', children: [
    { name: 'Histórico de vendas', to: '/sales', icon: 'bi bi-clock-history' },
    { name: 'Frentes de caixa', to: '/reports/cash-fronts', icon: 'bi bi-cash-stack' },
    { name: 'Produtos mais vendidos', to: '/reports/products', icon: 'bi bi-bar-chart-line' },
    { name: 'Notas Fiscais', to: '/relatorios/nfe-emissoes', icon: 'bi bi-receipt' },
    { name: 'Movimentos de Estoque', to: '/stock-movements', icon: 'bi bi-arrow-repeat', moduleKey: 'stock' }
  ] },
  { name: 'Clientes', to: '/customers', icon: 'bi bi-person', children: [
    { name: 'Listar clientes', to: '/customers', icon: 'bi bi-people' },
    { name: 'Grupos de clientes', to: '/customer-groups', icon: 'bi bi-people-fill' }
  ] },
  { name: 'Entregadores', to: '/riders', icon: 'bi bi-bicycle', moduleKey: 'riders', children: [
    { name: 'Lista', to: '/riders', icon: 'bi bi-people' },
    { name: 'Créditos/Débitos', to: '/rider-adjustments', icon: 'bi bi-credit-card' },
  ] },
  { name: 'Marketing', to: '/marketing', icon: 'bi bi-megaphone', children: [
    { name: 'Afiliados', to: '/affiliates', icon: 'bi bi-people-fill', moduleKey: 'affiliates' },
    { name: 'Cupons', to: '/coupons', icon: 'bi bi-ticket-perforated', moduleKey: 'coupons' },
    { name: 'Cashback', to: '/settings/cashback', icon: 'bi bi-cash-stack', moduleKey: 'cashback' },
    { name: 'Meta Pixel', to: '/settings/meta-pixel', icon: 'bi bi-bullseye' },
  ] },
  { name: 'Ingredientes', to: '/ingredient-groups', icon: 'bi bi-box', moduleKey: 'stock', children: [
    { name: 'Grupos de Ingredientes', to: '/ingredient-groups', icon: 'bi bi-list' },
    { name: 'Ingredientes', to: '/ingredients', icon: 'bi bi-basket' },
    { name: 'Fichas Técnicas', to: '/technical-sheets', icon: 'bi bi-file-earmark-text' }
  ] },
  { name: 'Financeiro', to: '/financial', icon: 'bi bi-cash-coin', moduleKey: 'financial', children: [
    { name: 'Dashboard', to: '/financial', icon: 'bi bi-speedometer2' },
    { name: 'Contas a Pagar/Receber', to: '/financial/transactions', icon: 'bi bi-receipt' },
    { name: 'Fluxo de Caixa', to: '/financial/cash-flow', icon: 'bi bi-graph-up' },
    { name: 'Contas Bancárias', to: '/financial/accounts', icon: 'bi bi-bank' },
  ] },
  { name: 'Lista de cardápios', to: '/menu/menus', icon: 'bi bi-list' },
  { name: 'Configurações', to: '/settings/neighborhoods', icon: 'bi bi-gear', children: [
    { name: 'Bairros', to: '/settings/neighborhoods', icon: 'bi bi-geo-alt' },
    { name: 'Dados Fiscais', to: '/settings/dados-fiscais', icon: 'bi bi-receipt' },
    { name: 'Integrações', to: '/integrations', icon: 'bi bi-plug' },
    { name: 'Lojas', to: '/settings/stores', icon: 'bi bi-shop-window' },
    { name: 'WhatsApp', to: '/settings/whatsapp', icon: 'bi bi-whatsapp', moduleKey: 'whatsapp' },
    { name: 'Usuários', to: '/settings/users', icon: 'bi bi-people' }
  ] },
  { name: 'SaaS', to: '/saas', icon: 'bi bi-grid-3x3-gap', role: 'SUPER_ADMIN', children: [
    { name: 'Planos', to: '/saas/plans', icon: 'bi bi-list-check' },
    { name: 'Módulos', to: '/saas/modules', icon: 'bi bi-box-seam' },
    { name: 'Empresas', to: '/saas/companies', icon: 'bi bi-building' }
  ] }
];

export default nav;
