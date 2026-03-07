---
name: frontend-deliverywl
description: >
  Design system and UI consistency guide for the Delivery SaaS Vue 3 + Bootstrap 5 project.
  Use this skill whenever writing, editing, or reviewing ANY frontend code in delivery-saas-frontend/ —
  including new views, components, forms, tables, cards, tabs, buttons, or CSS.
  Also use when the user asks about styling, layout, spacing, colors, or component usage.
  Even small changes like adding a badge or adjusting padding should consult this skill
  to ensure visual consistency across the entire application.
---

# Delivery SaaS — Frontend Design System

This skill defines every visual convention for the project. Follow it strictly to keep the UI consistent.

## Stack

- **Vue 3** (Composition API + `<script setup>`)
- **Bootstrap 5.3** (CSS only, no JS plugins except modals)
- **Bootstrap Icons 1.13** (`bi-*` classes)
- **Vite** build, **Pinia** state, **Axios** HTTP (`api` instance from `src/api.js`)
- **SweetAlert2** for confirmations/alerts
- **Flatpickr** for date pickers (optional, DateInput has fallback)

## Architecture: CSS Override Layers

All styling lives in four ordered CSS files imported in `main.js`:

1. `src/assets/overrides/_variables.css` — design tokens (`:root` variables)
2. `src/assets/overrides/_bootstrap.css` — Bootstrap class overrides
3. `src/assets/overrides/_components.css` — custom component classes
4. `src/assets/overrides/_responsive.css` — breakpoint-specific adjustments

Never add global styles to individual Vue components when they can go in these files.
Use `<style scoped>` only for component-specific layout that doesn't belong in the global system.

---

## Color Palette

| Token | Value | Usage |
|-------|-------|-------|
| `--primary` | `#105784` | Main actions, links, active states |
| `--primary-dark` | `#0B3D5E` | Hover/pressed states |
| `--primary-light` | `#1A6FA8` | Secondary tints |
| `--success` | `#89D136` | Positive actions, confirms, green accents |
| `--success-dark` | `#6DAE1E` | Success hover |
| `--success-light` | `#A8E866` | Disabled/background green |
| `--bg-app` | `#EEFFED` | Page background (light green) |
| `--bg-card` | `#FFFFFF` | Card/panel background |
| `--bg-hover` | `#F0F0F0` | Hover states |
| `--bg-zebra` | `#FAFAFA` | Striped table rows |
| `--bg-input` | `#F8F9FA` | Input field idle background |
| `--text-primary` | `#212529` | Main text |
| `--text-secondary` | `#6C757D` | Secondary text, labels |
| `--text-muted` | `#ADB5BD` | Disabled, placeholders |
| `--border-color` | `#E6E6E6` | Standard borders |
| `--border-color-soft` | `rgba(0,0,0,0.06)` | Card borders, dividers |

**Rule**: Never use hardcoded hex colors for these purposes. Always reference the CSS variable.
The only exceptions are one-off accent colors for specific features (e.g., AI Studio purple `#7c3aed`).

---

## Spacing

Use Bootstrap utility classes (`gap-2`, `mb-3`, `px-4`, etc.) based on multiples of `0.25rem`:

| Class suffix | Value | Pixels |
|-------------|-------|--------|
| 1 | 0.25rem | 4px |
| 2 | 0.5rem | 8px |
| 3 | 1rem | 16px |
| 4 | 1.5rem | 24px |
| 5 | 3rem | 48px |

Standard gaps between elements:
- Between form fields: `mb-3`
- Between sections: `mb-4` or `mt-4`
- Inside flex rows: `gap-2`
- Card body padding: `1.25rem`
- Table cell padding: `0.85rem`

---

## Border Radius

| Token | Value | Usage |
|-------|-------|-------|
| `--border-radius` | `1rem` (16px) | Cards, panels, modals |
| `--border-radius-sm` | `0.625rem` (10px) | Buttons, inputs, dropdowns |
| `--border-radius-pill` | `2rem` (32px) | Badges, chips, pills |

---

## Shadows

| Token | Value | Usage |
|-------|-------|-------|
| `--shadow-card` | `0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)` | Cards, panels |
| `--shadow-dropdown` | `0 0.5rem 1.5rem rgba(0,0,0,0.1)` | Dropdowns, modals |
| `--shadow-hover` | `0 4px 12px rgba(0,0,0,0.08)` | Hover elevation |
| `--shadow-tab` | `0 1px 3px rgba(0,0,0,0.08)` | Active tab pill |

---

## Typography

**Font**: Roboto (system-ui fallback)

| Context | Size | Weight | Extra |
|---------|------|--------|-------|
| Page title (h4) | 1.1rem | 700 | `--text-primary` |
| Card header | — | 600 | — |
| Form label | 0.8rem | 500 | `--text-secondary`, letter-spacing 0.01em |
| Body text / input | 0.875rem | 400 | `--text-primary` |
| Table header (th) | 0.78rem | 500 | Uppercase, letter-spacing 0.04em, `--text-muted` |
| Small/secondary | 0.78-0.85rem | 400 | `--text-secondary` |
| Badge/chip | 0.72rem | 500 | — |
| Stat value (KPI) | 1.5rem | 700 | `--text-primary` |
| Stat label | 0.75rem | 500 | Uppercase, `--text-muted` |

---

## Components — When and How to Use

### Form Inputs

Always use the project's wrapper components, never raw `<input>` or `<select>`:

```vue
<TextInput v-model="name" label="Nome" placeholder="Digite o nome" />
<TextInput v-model="email" type="email" label="Email" />
<TextInput v-model="qty" type="number" min="1" max="100" />
<SelectInput v-model="status" :options="statusOptions" placeholder="Selecione..." />
<CurrencyInput v-model="price" label="Preco" />
<DateInput v-model="date" />
<TextareaInput v-model="description" rows="4" placeholder="Descricao..." />
```

All render with `.form-control` / `.form-select` which inherit the global styling:
- Padding: `0.55rem 0.875rem`
- Background: `var(--bg-input)` idle, `var(--bg-card)` focused
- Border: `var(--border-color)`, focus ring `3px rgba(16,87,132,0.1)`
- Hover: border darkens to `var(--text-muted)`

### Buttons

Use `<BaseButton>` with variant prop:

```vue
<BaseButton variant="primary" @click="save">Salvar</BaseButton>
<BaseButton variant="secondary" @click="confirm">Confirmar</BaseButton>
<BaseButton variant="outline" @click="cancel">Cancelar</BaseButton>
<BaseButton variant="danger" @click="remove">Excluir</BaseButton>
<BaseButton variant="ghost" @click="toggle">Mais</BaseButton>
<BaseButton variant="primary" size="sm" icon="+" @click="add">Novo</BaseButton>
<BaseButton variant="primary" :loading="saving" @click="save">Salvar</BaseButton>
```

| Variant | Bootstrap Class | Visual |
|---------|----------------|--------|
| primary | `.btn-primary` | White on `--primary` blue |
| secondary | `.btn-secondary` | White on `--success` green |
| outline | `.btn-outline-secondary` | Gray border, transparent bg |
| danger | `.btn-danger` | Red |
| ghost | `.btn-link.text-secondary` | Link style, gray |

Sizes: `sm` (compact), `md` (default), `lg` (hero).
Use `block` prop for full-width.

For icon-only buttons, use `<BaseIconButton>`:

```vue
<BaseIconButton color="danger" title="Excluir" @click="remove">
  <i class="bi-trash"></i>
</BaseIconButton>
```

### Cards

Use `.card` for panels. For list/management screens, use `<ListCard>`:

```vue
<ListCard
  title="Clientes (42)"
  subtitle="42 clientes cadastrados"
  icon="bi-people"
  quick-search
  quick-search-placeholder="Buscar por nome, CPF..."
  @quick-search="onSearch"
>
  <template #actions>
    <BaseButton variant="primary" size="sm" icon="+">Novo</BaseButton>
  </template>
  <template #filters>
    <!-- filter chips or selects -->
  </template>

  <!-- table or content -->

  <template #footer>
    <!-- pagination -->
  </template>
</ListCard>
```

Variants: `card-style`, `compact`, `no-padding`.

### Tables

Pattern for data tables inside cards:

```html
<div class="table-responsive">
  <table class="table table-hover align-middle">
    <thead>
      <tr>
        <th>Nome</th>
        <th>Status</th>
        <th class="text-end">Acoes</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="item in items" :key="item.id">
        <td>{{ item.name }}</td>
        <td><span class="badge bg-success">Ativo</span></td>
        <td class="text-end">
          <BaseIconButton color="primary" title="Editar">
            <i class="bi-pencil"></i>
          </BaseIconButton>
        </td>
      </tr>
    </tbody>
  </table>
</div>
```

Table headers are styled globally: uppercase, muted, 0.78rem, weight 500.
Row borders are nearly invisible (`rgba(0,0,0,0.04)`). Last row has no border.
Hover is a subtle primary tint.

### Tabs

Use Bootstrap `nav-tabs` — styled globally as segment pills:

```html
<ul class="nav nav-tabs mb-4">
  <li class="nav-item">
    <a class="nav-link" :class="{ active: tab === 'dados' }" href="#"
       @click.prevent="tab = 'dados'">
      <i class="bi bi-person-vcard me-1"></i> Dados
    </a>
  </li>
  <li class="nav-item">
    <a class="nav-link" :class="{ active: tab === 'pedidos' }" href="#"
       @click.prevent="tab = 'pedidos'">
      <i class="bi bi-bag me-1"></i> Pedidos
    </a>
  </li>
</ul>

<div v-show="tab === 'dados'">...</div>
<div v-show="tab === 'pedidos'">...</div>
```

The global CSS renders these as pill segments: light gray container, white active pill with shadow.
Never use custom tab components — always `nav nav-tabs` so the global style applies.

### Badges

```html
<span class="badge bg-primary">Ativo</span>
<span class="badge bg-success">Concluido</span>
<span class="badge bg-light text-dark">Pendente</span>
```

Pill-shaped, 0.72rem, weight 500.

### Action Chips (Filters)

```html
<button class="action-chip" :class="{ 'action-chip--active': isActive }">
  <i class="bi-filter me-1"></i> Filtro
</button>
```

### Stat Cards (KPIs)

```html
<div class="stat-grid">
  <div class="stat-card">
    <div class="stat-icon stat-icon--primary"><i class="bi-cart"></i></div>
    <div class="stat-body">
      <div class="stat-label">Pedidos</div>
      <div class="stat-value">342</div>
      <div class="stat-change stat-change--up">+12%</div>
    </div>
  </div>
</div>
```

Icon variants: `--primary`, `--success`, `--warning`, `--danger`.
Stat grid is responsive: 4 cols desktop, 2 tablet, 1 mobile.

### Pagination

Manual pattern (not Bootstrap pagination component):

```html
<div class="d-flex align-items-center justify-content-between">
  <small class="text-muted">Mostrando 1-10 de 42</small>
  <div class="d-flex gap-1">
    <button class="btn btn-sm btn-outline-secondary" :disabled="page === 1" @click="page--">
      <i class="bi-chevron-left"></i>
    </button>
    <button class="btn btn-sm btn-outline-secondary" :disabled="page >= totalPages" @click="page++">
      <i class="bi-chevron-right"></i>
    </button>
  </div>
</div>
```

---

## Responsive Rules

| Breakpoint | Width | Key behavior |
|------------|-------|-------------|
| Mobile | <768px | Single column, full-width buttons, stacked forms |
| Tablet | 768-1199px | 2-column stat grid, horizontal nav |
| Desktop | >=1200px | 4-column stat grid, sidebar visible |

On mobile (<768px):
- Wrap `<table>` in `.table-responsive`
- Use `col-12` for form fields, `col-12 col-lg-6` for side-by-side
- Button actions go full-width inside `<ListCard>`
- Cards lose border-radius on full-bleed layouts

---

## Icons

Always use Bootstrap Icons: `<i class="bi-{name}"></i>`

Common icons:
- Actions: `bi-pencil` (edit), `bi-trash` (delete), `bi-plus` (add), `bi-download`, `bi-eye`
- Navigation: `bi-house` (home), `bi-chevron-left/right`, `bi-arrow-left`
- Status: `bi-check-circle`, `bi-x-circle`, `bi-exclamation-triangle`
- Objects: `bi-cart`, `bi-bag`, `bi-person`, `bi-people`, `bi-wallet2`

With text: `<i class="bi-pencil me-1"></i> Editar`
Icon-only: use `<BaseIconButton>` with `title` for accessibility.

---

## Anti-Patterns (Do NOT)

- Use raw `<input>` or `<select>` — always use `TextInput`, `SelectInput`, etc.
- Use `fetch()` — always use `api` (axios instance from `src/api.js`)
- Hardcode colors — always use CSS variables
- Add global styles in component `<style scoped>` — put them in the override files
- Create new button styles — use `BaseButton` variant prop
- Use custom tab components — use `nav nav-tabs` with standard Bootstrap markup
- Use `!important` in scoped styles (the override files already handle specificity)
- Import Bootstrap JS — the project uses CSS-only Bootstrap + Vue for interactivity

---

## File Naming

- Views: `PascalCase.vue` (e.g., `CustomersList.vue`, `OrderHistory.vue`)
- Components: `PascalCase.vue` (e.g., `BaseButton.vue`, `ListCard.vue`)
- CSS: `_kebab-case.css` with underscore prefix for overrides
- Stores: `camelCase.js` (e.g., `customers.js`, `auth.js`)

---

## SweetAlert2 Patterns

Confirmations:
```js
const result = await Swal.fire({
  title: 'Excluir item?',
  text: 'Esta acao e irreversivel.',
  icon: 'warning',
  showCancelButton: true,
  confirmButtonText: 'Excluir',
  cancelButtonText: 'Cancelar',
  confirmButtonColor: '#dc3545',
})
if (!result.isConfirmed) return
```

Success toast:
```js
Swal.fire({ icon: 'success', text: 'Salvo com sucesso', timer: 1500, showConfirmButton: false })
```

Error:
```js
Swal.fire({ icon: 'error', text: e.response?.data?.message || 'Erro ao salvar' })
```
