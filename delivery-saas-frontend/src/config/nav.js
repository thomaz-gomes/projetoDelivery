// navigation structure shared between Sidebar and App
// moduleKey: guards visibility by enabled module
// lockable: true → show as "locked" with upgrade badge instead of hiding completely
export const nav = [
  { name: 'Pedidos', to: '/orders', icon: 'bi bi-box-seam', moduleKey: 'cardapio_completo', lockable: true },
  { name: 'Relatórios', to: '/reports', icon: 'bi bi-file-earmark-bar-graph', moduleKey: 'cardapio_completo', lockable: true, children: [
    { name: 'Histórico de vendas', to: '/sales', icon: 'bi bi-clock-history' },
    { name: 'Frentes de caixa', to: '/reports/cash-fronts', icon: 'bi bi-cash-stack' },
    { name: 'Produtos mais vendidos', to: '/reports/products', icon: 'bi bi-bar-chart-line' },
    { name: 'Desempenho do Cardápio', to: '/reports/menu-performance', icon: 'bi bi-graph-up' },
    { name: 'Notas Fiscais', to: '/relatorios/nfe-emissoes', icon: 'bi bi-receipt', moduleKey: 'fiscal', lockable: true },
    { name: 'Movimentos de Estoque', to: '/stock-movements', icon: 'bi bi-arrow-repeat', moduleKey: 'stock', lockable: true }
  ] },
  { name: 'Clientes', to: '/customers', icon: 'bi bi-person', moduleKey: 'cardapio_completo', lockable: true, children: [
    { name: 'Listar clientes', to: '/customers', icon: 'bi bi-people' },
    { name: 'Grupos de clientes', to: '/customer-groups', icon: 'bi bi-people-fill' }
  ] },
  { name: 'Entregadores', to: '/riders', icon: 'bi bi-bicycle', moduleKey: 'riders', lockable: true, children: [
    { name: 'Lista', to: '/riders', icon: 'bi bi-people' },
    { name: 'Créditos/Débitos', to: '/rider-adjustments', icon: 'bi bi-credit-card' },
    { name: 'Dashboard', to: '/reports/riders-dashboard', icon: 'bi bi-speedometer2' },
    { name: 'Mapa de Entregas', to: '/riders/map', icon: 'bi bi-map' },
    { name: 'Configurações', to: '/settings/rider-tracking', icon: 'bi bi-gear' },
  ] },
  { name: 'Marketing', to: '/marketing', icon: 'bi bi-megaphone', children: [
    { name: 'Studio IA', to: '/marketing/studio-ia', icon: 'bi bi-stars' },
    { name: 'Afiliados', to: '/affiliates', icon: 'bi bi-people-fill', moduleKey: 'affiliates', lockable: true },
    { name: 'Cupons', to: '/coupons', icon: 'bi bi-ticket-perforated', moduleKey: 'coupons', lockable: true },
    { name: 'Cashback', to: '/settings/cashback', icon: 'bi bi-cash-stack', moduleKey: 'cashback', lockable: true },
    { name: 'Meta Pixel', to: '/settings/meta-pixel', icon: 'bi bi-bullseye', moduleKey: 'cardapio_completo', lockable: true },
  ] },
  { name: 'Ingredientes', to: '/ingredient-groups', icon: 'bi bi-box', moduleKey: 'stock', lockable: true, children: [
    { name: 'Grupos de Ingredientes', to: '/ingredient-groups', icon: 'bi bi-list' },
    { name: 'Ingredientes', to: '/ingredients', icon: 'bi bi-basket' },
    { name: 'Fichas Técnicas', to: '/technical-sheets', icon: 'bi bi-file-earmark-text' },
    { name: 'Importação de Compras', to: '/stock/purchase-imports', icon: 'bi bi-receipt' }
  ] },
  { name: 'Financeiro', to: '/financial', icon: 'bi bi-cash-coin', moduleKey: 'financial', lockable: true, children: [
    { name: 'Dashboard', to: '/financial', icon: 'bi bi-speedometer2' },
    { name: 'Contas a Pagar/Receber', to: '/financial/transactions', icon: 'bi bi-receipt' },
    { name: 'Fluxo de Caixa', to: '/financial/cash-flow', icon: 'bi bi-graph-up' },
    { name: 'Contas Bancárias', to: '/financial/accounts', icon: 'bi bi-bank' },
  ] },
  { name: 'Configurações', to: '/settings/neighborhoods', icon: 'bi bi-gear', children: [
    { name: 'Lista de cardápios', to: '/menu/menus', icon: 'bi bi-list' },
    { name: 'Códigos de Integração', to: '/menu/integration', icon: 'bi bi-upc-scan', moduleKey: 'cardapio_completo', lockable: true },
    { name: 'Bairros', to: '/settings/neighborhoods', icon: 'bi bi-geo-alt', moduleKey: 'cardapio_completo', lockable: true },
    { name: 'Dados Fiscais', to: '/settings/dados-fiscais', icon: 'bi bi-receipt', moduleKey: 'fiscal', lockable: true },
    { name: 'Integrações', to: '/integrations', icon: 'bi bi-plug', moduleKey: 'cardapio_completo', lockable: true },
    { name: 'Formas de Pagamento', to: '/settings/payment-methods', icon: 'bi bi-credit-card' },
    { name: 'Lojas', to: '/settings/stores', icon: 'bi bi-shop-window' },
    { name: 'WhatsApp', to: '/settings/whatsapp', icon: 'bi bi-whatsapp', moduleKey: 'whatsapp', lockable: true },
    { name: 'Usuários', to: '/settings/users', icon: 'bi bi-people' }
  ] },
  {
    name: 'Loja de Add-ons',
    to: '/store',
    icon: 'bi-shop',
  },
  { name: 'SaaS', to: '/saas', icon: 'bi bi-grid-3x3-gap', role: 'SUPER_ADMIN', children: [
    { name: 'Planos', to: '/saas/plans', icon: 'bi bi-list-check' },
    { name: 'Módulos', to: '/saas/modules', icon: 'bi bi-box-seam' },
    { name: 'Empresas', to: '/saas/companies', icon: 'bi bi-building' },
    { name: 'Gateway', to: '/saas/gateway', icon: 'bi bi-credit-card-2-front' }
  ] }
];

export default nav;
