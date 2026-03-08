# PWA Install Banner por Loja — Design

**Data:** 2026-03-08
**Status:** Aprovado

## Objetivo

Permitir que clientes acessando o cardápio público pelo smartphone salvem um atalho na tela inicial com o ícone/logo da loja. Banner automático ao detectar mobile sem instalação prévia.

## Abordagem

Manifest dinâmico gerado pelo backend por loja (abordagem A — mais robusta cross-browser).

## Componentes

### 1. Backend — Rota `GET /public/:companyId/manifest.json`

- Query params: `?storeId=X&menuId=Y`
- Busca nome e logo (prioridade: menu > store > company)
- Retorna JSON manifest com `name`, `short_name`, `start_url`, `display: standalone`, `icons` (logo da loja), `theme_color`, `background_color`

### 2. Frontend — Manifest Dinâmico (PublicMenu.vue)

- Após carregar dados da loja no `onMounted`, injeta `<link rel="manifest">` apontando para a rota backend
- Remove/substitui o manifest estático do `index.html`

### 3. Frontend — Banner de Instalação (PublicMenu.vue)

- **Android/Chrome:** Captura `beforeinstallprompt`, mostra banner no topo com logo + "Adicionar [Loja] à tela inicial" + botão Instalar
- **iOS/Safari:** Detecta iOS sem standalone, mostra instrução "Toque em Compartilhar e 'Adicionar à Tela de Início'"
- Apenas mobile, dismissível (salva no `localStorage` por companyId)
- Desaparece após instalação (`appinstalled`)

### 4. index.html

- Remove `<link rel="manifest">` estático (será injetado dinamicamente pelo PublicMenu)
- Manifest estático `public/manifest.webmanifest` permanece no disco como fallback do painel admin

## Arquivos Modificados

| Arquivo | Mudança |
|---------|---------|
| `delivery-saas-backend/src/routes/publicMenu.js` | Nova rota manifest.json |
| `delivery-saas-frontend/src/views/PublicMenu.vue` | Inject manifest + banner install |
| `delivery-saas-frontend/index.html` | Remover link manifest estático |