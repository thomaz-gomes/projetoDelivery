# Menu Announcements — Design

**Data:** 2026-06-05
**Módulo:** Marketing
**Status:** Aprovado, pronto para plano de implementação.

## Objetivo

Permitir ao admin configurar, por cardápio, dois tipos de notificação
exibidos no PublicMenu:

1. **Modal de aviso** — pop-up exibido 1x por dia para cada visitante,
   com mensagem personalizável.
2. **Faixa promocional** — barra de texto persistente no topo do
   PublicMenu (visível em mobile abaixo do banner de install do PWA).

Cada cardápio (`Menu`) tem no máximo 1 modal e 1 faixa configurados.

## Decisões

- 1 modal + 1 faixa por cardápio (sem múltiplas campanhas / agendamento).
- Modelagem unificada em **uma** tabela 1-1 com `Menu`
  (`MenuAnnouncement`) — evita duplicação de CRUD e os dois conceitos
  sempre andam juntos na mesma tela.
- Localização no módulo **Marketing** (não em `/settings/`).
- Dismiss do modal versionado por `updatedAt` — admin edita a mensagem
  → modal reaparece para quem já fechou.
- Sem rich text. Textos sanitizados (strip tags) no backend.

## Schema (Prisma)

```prisma
model MenuAnnouncement {
  id              String   @id @default(uuid())
  menuId          String   @unique
  menu            Menu     @relation(fields: [menuId], references: [id], onDelete: Cascade)

  // ---- Popup (modal 1x/dia) ----
  popupEnabled    Boolean  @default(false)
  popupTitle      String?
  popupMessage    String   @default("")
  popupButtonText String?  // app default: "Entendi"
  popupCtaUrl     String?
  popupCtaLabel   String?
  popupImageUrl   String?  // /public/uploads/announcements/<file>

  // ---- Banner (faixa topo PublicMenu) ----
  bannerEnabled   Boolean  @default(false)
  bannerText      String   @default("")
  bannerBgColor   String?  // hex "#RRGGBB"; cor do texto via luminância

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt  // chave do dismiss
}
```

Em `Menu`, adicionar inversa: `announcement MenuAnnouncement?`.

## API

Novo arquivo `src/routes/menuAnnouncements.js`, montado em
`app.use('/menu-announcements', router)`.

| Método | Rota                                  | Auth  | Função                       |
|--------|---------------------------------------|-------|------------------------------|
| GET    | `/menu-announcements/:menuId`         | ADMIN | retorna registro ou `null`   |
| PUT    | `/menu-announcements/:menuId`         | ADMIN | upsert                       |
| POST   | `/menu-announcements/:menuId/image`   | ADMIN | upload imagem do popup       |
| DELETE | `/menu-announcements/:menuId/image`   | ADMIN | remove imagem (unlink + null)|

### Validações no PUT

- `menuId` pertence à `companyId` do JWT (guard padrão).
- `bannerBgColor` matches `^#[0-9A-Fa-f]{6}$` ou null.
- `popupCtaUrl` é URL válida ou null.
- `popupMessage` / `bannerText` ≤ 500 / 200 chars.
- `popupTitle` / `popupButtonText` / `popupCtaLabel` ≤ 100 chars.
- Strip de tags HTML em todos os campos de texto.

### Exposição pública

Estender o handler `GET /public/menu/:slug` em `publicMenu.js` para
incluir um objeto `announcement` no payload **apenas com campos
habilitados** (popup ou banner). Se ambos estão off, omite `announcement`.
Incluir `announcement.updatedAt` (ISO) — usado como chave do dismiss
no client.

Evita uma chamada HTTP extra no carregamento do cardápio público.

## Upload de imagem

- Endpoint `POST /menu-announcements/:menuId/image`.
- `multer.diskStorage` → `public/uploads/announcements/`.
- Filtros: `image/png`, `image/jpeg`, `image/webp`; máx 2 MB.
- Nome final: `<menuId>-<timestamp>.<ext>`.
- Otimização via `sharp`: resize máx 1080px largura, qualidade 80
  (mesmo padrão do upload de produtos).
- Resposta `{ url: "/public/uploads/announcements/<file>" }`.
- Ao trocar de imagem (novo upload com `popupImageUrl` populado), o
  backend remove a anterior antes de gravar a nova.
- `DELETE` faz `fs.unlink` best-effort e seta `popupImageUrl = null`.

## Frontend Admin

- **Rota:** `/marketing/menu-notifications`
- **Componente:** `src/views/marketing/MenuNotifications.vue`
- **Sidebar:** entrada nova no grupo Marketing, label
  "Avisos no Cardápio".
- Segue [frontend-deliverywl](skill) — usa `<SelectInput>`/`<TextInput>`,
  Bootstrap 5, sem inputs HTML crus.

### Layout

1. Header com `<SelectInput>` de cardápios da company.
   Trocar carrega `GET /menu-announcements/:menuId`.
2. Card "Modal de aviso" — toggle `popupEnabled`; quando ligado:
   título, mensagem, texto do botão, link CTA, label do CTA, upload
   de imagem com preview, **preview ao vivo** do modal.
3. Card "Faixa promocional" — toggle `bannerEnabled`; quando ligado:
   texto, color picker, **preview ao vivo** com texto auto-contraste.
4. Botão "Salvar" sticky no rodapé → `PUT /menu-announcements/:menuId`.

### Comportamento

- Trocar cardápio com edits não salvos → confirma descarte via
  `beforeRouteLeave`.
- Toggle off salva o flag mas mantém os textos no DB — facilita
  reativar depois sem perder o conteúdo.

## PublicMenu — renderização

### Faixa promocional

Em `PublicMenu.vue`, inserir **abaixo** do `pwa-install-banner`:

```vue
<div
  v-if="announcement?.bannerEnabled && announcement.bannerText"
  class="menu-announcement-bar"
  :style="{ background: announcement.bannerBgColor, color: announcementBarTextColor }"
>
  {{ announcement.bannerText }}
</div>
```

- `announcementBarTextColor` = computed via luminância YIQ:
  `((r*299 + g*587 + b*114) / 1000) >= 128 ? '#111' : '#fff'`.
- Persistente, sem botão de fechar.
- Fluxo natural (sai com o scroll, não é sticky).

### Modal (1x/dia)

Chave no localStorage versionada por `updatedAt`:

```js
const dismissKey = `menu_announcement_dismiss_${menuId}`
const today = new Date().toISOString().slice(0,10)
const versionKey = announcement.updatedAt

const stored = JSON.parse(localStorage.getItem(dismissKey) || '{}')
const shouldShow =
  announcement.popupEnabled &&
  (stored.date !== today || stored.version !== versionKey)
```

- Ao fechar (botão "Entendi" ou X): gravar
  `{ date: today, version: versionKey }`.
- Modal Bootstrap, estrutura: imagem (se houver) → título →
  mensagem → botão primário (fecha) + CTA secundário (abre URL em
  nova aba).
- `setTimeout` ~400ms após mount para não competir com o PWA banner.

## Testes

### Backend (`node:test` + ESM, mocks Prisma)

`tests/menuAnnouncements.test.js`:

- GET retorna `null` quando não existe.
- PUT cria registro novo.
- PUT atualiza registro existente — `updatedAt` muda.
- Multi-tenant: PUT em menu de outra company → 403.
- Validação: `bannerBgColor` inválido → 400; `popupCtaUrl` inválida
  → 400; texto > limite → 400.
- Sanitização: tags HTML strippadas de `popupMessage` / `bannerText`.

Extensão de `publicMenu.test.js`:

- Payload inclui `announcement` quando `popupEnabled` ou
  `bannerEnabled` é true.
- Omite `announcement` quando ambos são false.

### Frontend (verificação manual — projeto não tem runner)

- Toggle on/off, salvar, reabrir → estado preserva.
- Trocar de cardápio com edits → confirma descarte.
- Preview ao vivo atualiza em tempo real.
- PublicMenu: faixa renderiza com cor + contraste correto; modal
  aparece, fecha, não reaparece no mesmo dia; admin edita → modal
  reaparece imediatamente no próximo refresh.

## Trade-offs e alternativas rejeitadas

- **Múltiplas campanhas com agendamento:** rejeitado — usuário pediu
  "1 por cardápio". Se necessário no futuro, evolução adiciona
  `startsAt` / `endsAt` na mesma tabela e troca o handler `GET` para
  retornar a campanha ativa atual.
- **Duas tabelas separadas (`MenuPopup`, `MenuBanner`):** dobra o
  boilerplate de CRUD sem ganho — sempre editados juntos.
- **Colunas direto no `Menu`:** `Menu` já tem 60+ colunas misturando
  domínios; piora o problema.
- **`/settings/`:** usuário preferiu Marketing por ser ferramenta de
  comunicação/promoção, não configuração operacional.
