# Design: Controle de acesso por módulo via `meta.requiresModule`

**Data:** 2026-03-11
**Status:** Aprovado

## Objetivo

Migrar o controle de acesso de rotas frontend de uma lista hardcoded (`SIMPLES_BLOCKED_PREFIXES`) para um sistema declarativo onde cada rota declara qual módulo necessita via `meta.requiresModule`. Usuários sem o módulo são redirecionados silenciosamente.

## Regras de redirect

- Usuário com apenas `CARDAPIO_SIMPLES` (sem `CARDAPIO_COMPLETO`) → `/menu/menus`
- Demais usuários sem módulo específico → `/orders`

## Mapeamento rota → módulo

| Módulo | Rotas |
|--------|-------|
| `CARDAPIO_COMPLETO` | `/orders`, `/customers`, `/customer-groups`, `/integrations`, `/settings/neighborhoods`, `/settings/meta-pixel`, `/menu/integration`, `/sales`, `/reports/cash-fronts`, `/reports/products` |
| `RIDERS` | `/riders`, `/rider-adjustments`, `/riders/map`, `/settings/rider-tracking` |
| `AFFILIATES` | `/affiliates` |
| `COUPONS` | `/coupons` |
| `CASHBACK` | `/settings/cashback` |
| `STOCK` | `/ingredient-groups`, `/ingredients`, `/technical-sheets`, `/stock-movements`, `/stock/purchase-imports` |
| `FINANCIAL` | `/financial` (e sub-rotas) |
| `FISCAL` | `/nfe/emissao`, `/relatorios/nfe-emissoes`, `/settings/dados-fiscais` |
| `WHATSAPP` | `/settings/whatsapp` |

### Rotas sem módulo (acessíveis a todos os planos)

`/menu/menus`, `/menu/products`, `/menu/categories`, `/menu/options`, `/settings/stores`, `/settings/payment-methods`, `/settings/users`, `/settings/access-control`, `/store`, `/store/:moduleKey`, `/store/credits`, `/marketing/studio-ia`, `/payment/result`, `/settings/printer-setup`, `/settings/agent-token`, `/settings/devtools`, `/settings/file-source`

## Implementação

### 1. Rotas (`router.js`)

Adicionar `meta.requiresModule` em cada rota conforme o mapeamento acima. Exemplo:

```js
{ path: '/orders', component: Orders, meta: { requiresAuth: true, requiresModule: 'CARDAPIO_COMPLETO' } }
{ path: '/riders', component: Riders, meta: { requiresAuth: true, requiresModule: 'RIDERS' } }
{ path: '/financial', component: FinancialDashboard, meta: { requiresAuth: true, role: 'ADMIN', requiresModule: 'FINANCIAL' } }
```

### 2. Guard (`router.beforeEach`)

Substituir o bloco `SIMPLES_BLOCKED_PREFIXES` (linhas 294-318) por:

```js
if (token && to.meta.requiresModule) {
  const auth = useAuthStore()
  const userRole = String(auth.user?.role || '').toUpperCase()
  if (userRole === 'ADMIN') {
    const { useModulesStore } = await import('./stores/modules')
    const modules = useModulesStore()
    if (!modules.enabled.length) {
      try { await modules.fetchEnabled() } catch {}
    }
    if (!modules.has(to.meta.requiresModule)) {
      const isSimples = modules.has('CARDAPIO_SIMPLES') && !modules.has('CARDAPIO_COMPLETO')
      return { path: isSimples ? '/menu/menus' : '/orders' }
    }
  }
}
```

### 3. Redirect `/` dinâmico

Substituir `{ path: '/', redirect: '/orders' }` por uma função que verifica módulos:

```js
{
  path: '/',
  redirect: () => '/orders',
  meta: { requiresAuth: true }
}
```

E no guard, tratar `/` antes do module guard: se `isCardapioSimplesOnly` → redirecionar para `/menu/menus`.

### 4. O que NÃO muda

- **Sidebar/nav**: `nav.js` e `navVisibility.js` continuam iguais (moduleKey + lockable)
- **Backend**: `requireModule()` middleware já protege as APIs
- **Login redirect**: lógica em `Login.vue` já trata `isCardapioSimplesOnly`

## Escopo fora

- Não adiciona novos módulos (ex: `META_PIXEL`, `CUSTOMER_GROUPS`)
- Não altera o backend
- Não altera a sidebar/nav