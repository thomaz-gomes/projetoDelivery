# Landing Page — Core Delivery — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a conversion-focused landing page at `/` that captures leads (name + WhatsApp), redirects to Kiwify checkout, and promotes the R$ 47/year digital menu plan.

**Architecture:** Vue SPA component (`LandingPage.vue`) as lazy-loaded route at `/`. Backend endpoint `POST /public/leads` saves lead data. No new dependencies — CSS scoped, mobile-first.

**Tech Stack:** Vue 3, Express.js, Prisma (PostgreSQL)

**Design doc:** `docs/plans/2026-03-12-landing-page-design.md`

---

### Task 1: Add Lead model to Prisma schema

**Files:**
- Modify: `delivery-saas-backend/prisma/schema.prisma` (append at end)

**Step 1: Add the Lead model**

Add at the end of `schema.prisma`:

```prisma
model Lead {
  id        Int      @id @default(autoincrement())
  name      String
  phone     String
  source    String   @default("landing")
  createdAt DateTime @default(now())
}
```

**Step 2: Push schema to dev DB**

Run inside backend container:
```bash
docker compose exec backend npx prisma db push
```
Expected: "Your database is now in sync with your Prisma schema."

**Step 3: Regenerate Prisma client**

```bash
docker compose exec backend npx prisma generate
```

**Step 4: Commit**

```bash
git add delivery-saas-backend/prisma/schema.prisma
git commit -m "feat(schema): add Lead model for landing page capture"
```

---

### Task 2: Create backend leads route

**Files:**
- Create: `delivery-saas-backend/src/routes/leads.js`
- Modify: `delivery-saas-backend/src/index.js:182` (add route mount after `app.use('/public', publicMenuRouter)`)

**Step 1: Create the leads route file**

Create `delivery-saas-backend/src/routes/leads.js`:

```javascript
import { Router } from 'express';
import { prisma } from '../prisma.js';

const router = Router();

router.post('/leads', async (req, res) => {
  try {
    const { name, phone } = req.body;
    if (!name || !phone) {
      return res.status(400).json({ error: 'name and phone are required' });
    }
    const cleanPhone = String(phone).replace(/\D/g, '');
    if (cleanPhone.length < 10 || cleanPhone.length > 13) {
      return res.status(400).json({ error: 'Invalid phone number' });
    }
    const lead = await prisma.lead.create({
      data: { name: String(name).trim(), phone: cleanPhone, source: 'landing' }
    });
    return res.json({ ok: true, id: lead.id });
  } catch (err) {
    console.error('POST /public/leads error:', err);
    return res.status(500).json({ error: 'Failed to save lead' });
  }
});

export default router;
```

**Step 2: Mount the route in index.js**

In `delivery-saas-backend/src/index.js`, after line 182 (`app.use('/public', publicMenuRouter);`), add:

```javascript
import leadsRouter from './routes/leads.js'
```
(at the imports section, around line 27)

And mount it:
```javascript
app.use('/public', leadsRouter);
```
(after line 182)

**Step 3: Test the endpoint**

```bash
curl -X POST http://localhost:3000/public/leads \
  -H "Content-Type: application/json" \
  -d '{"name":"Test","phone":"71999999999"}'
```
Expected: `{"ok":true,"id":1}`

**Step 4: Commit**

```bash
git add delivery-saas-backend/src/routes/leads.js delivery-saas-backend/src/index.js
git commit -m "feat(api): add POST /public/leads endpoint for landing page"
```

---

### Task 3: Create LandingPage.vue component

**Files:**
- Create: `delivery-saas-frontend/src/views/LandingPage.vue`

**Step 1: Create the full landing page component**

Create `delivery-saas-frontend/src/views/LandingPage.vue` with:

- **Template:** All 8 sections from design doc (Hero, Dor, Como Funciona, Showcase, Preço+Form, Upsell, FAQ, Footer)
- **Script:** Reactive form (name, phone), phone mask (xx) xxxxx-xxxx, form validation, POST to `/public/leads` via `api`, redirect to `https://pay.kiwify.com.br/YmuEZ57`
- **Style:** Scoped CSS using admin palette colors (#105784, #89D136, #EEFFED, etc.), mobile-first responsive, smooth scroll, Appzen-inspired layout with alternating white/gray sections

Key implementation details:

```javascript
// Script
import { ref } from 'vue'
import api from '../api'

const name = ref('')
const phone = ref('')
const loading = ref(false)
const error = ref('')

function formatPhone(value) {
  const digits = value.replace(/\D/g, '').slice(0, 11)
  if (digits.length <= 2) return `(${digits}`
  if (digits.length <= 7) return `(${digits.slice(0,2)}) ${digits.slice(2)}`
  return `(${digits.slice(0,2)}) ${digits.slice(2,7)}-${digits.slice(7)}`
}

function onPhoneInput(e) {
  phone.value = formatPhone(e.target.value)
}

async function submitLead() {
  error.value = ''
  if (!name.value.trim()) { error.value = 'Preencha seu nome'; return }
  const digits = phone.value.replace(/\D/g, '')
  if (digits.length < 10) { error.value = 'WhatsApp inválido'; return }
  loading.value = true
  try {
    await api.post('/public/leads', { name: name.value.trim(), phone: digits })
    window.location.href = 'https://pay.kiwify.com.br/YmuEZ57'
  } catch {
    error.value = 'Erro ao enviar. Tente novamente.'
    loading.value = false
  }
}

function scrollToForm() {
  document.getElementById('pricing')?.scrollIntoView({ behavior: 'smooth' })
}
```

CSS structure (scoped):
- `.landing` — wrapper, font-family system stack
- `.hero` — gradient bg (#105784 → #1A6FA8), white text, centered
- `.section` — max-width 1140px, padding, alternating bg
- `.card` — white bg, border-radius 1rem, shadow
- `.btn-cta` — bg #89D136, white text, border-radius 2rem, hover #6DAE1E
- `.btn-hero` — white bg, color #105784, bold
- `.badge-ai` — bg #7C3AED, white text, small pill
- `.form-group` — input with border-radius 0.625rem, bg #F8F9FA
- `.faq-item` — collapsible with details/summary HTML
- All responsive via `@media (max-width: 768px)`

**Step 2: Commit**

```bash
git add delivery-saas-frontend/src/views/LandingPage.vue
git commit -m "feat(frontend): add LandingPage.vue with copywriting and lead capture"
```

---

### Task 4: Wire up the Vue Router

**Files:**
- Modify: `delivery-saas-frontend/src/router.js:123-134` (replace root route)
- Modify: `delivery-saas-frontend/src/App.vue:124-132` (hide sidebar for `/`)

**Step 1: Update router.js — replace root route**

Replace lines 123-134 in `delivery-saas-frontend/src/router.js`:

```javascript
// OLD:
{ path: '/', beforeEnter: async () => {
    const token = localStorage.getItem('token')
    if (!token) return { path: '/login' }
    ...
  }
},

// NEW:
{ path: '/', component: () => import('./views/LandingPage.vue'), beforeEnter: async () => {
    const token = localStorage.getItem('token')
    if (!token) return true  // show landing page
    const { useModulesStore } = await import('./stores/modules')
    const modules = useModulesStore()
    if (!modules.enabled.length) {
      try { await modules.fetchEnabled() } catch {}
    }
    const isSimples = modules.has('CARDAPIO_SIMPLES') && !modules.has('CARDAPIO_COMPLETO')
    return { path: isSimples ? '/menu/menus' : '/orders' }
  }
},
```

Logic: authenticated users still redirect to dashboard; unauthenticated see landing page.

**Step 2: Update App.vue — hide sidebar for root**

In `delivery-saas-frontend/src/App.vue`, in the `showLayout` computed (line 124-133), add after line 127:

```javascript
if(route.path === '/') return false
```

**Step 3: Verify in browser**

- Open `http://localhost:5173/` without being logged in → should see landing page
- Login → navigate to `/` → should redirect to dashboard

**Step 4: Commit**

```bash
git add delivery-saas-frontend/src/router.js delivery-saas-frontend/src/App.vue
git commit -m "feat(router): wire LandingPage as root route for unauthenticated users"
```

---

### Task 5: Polish and responsive testing

**Files:**
- Modify: `delivery-saas-frontend/src/views/LandingPage.vue` (if adjustments needed)

**Step 1: Test mobile layout**

Open browser DevTools, test at:
- 375px (iPhone SE)
- 414px (iPhone 12)
- 768px (iPad)
- 1440px (desktop)

Verify: hero text readable, form usable, sections stack properly, CTAs visible.

**Step 2: Test the full flow**

1. Visit `/` (not logged in) → landing page renders
2. Fill name + WhatsApp → click CTA
3. Check backend logs for lead created
4. Browser redirects to Kiwify checkout

**Step 3: Final commit**

```bash
git add -A
git commit -m "feat(landing): polish responsive layout and final adjustments"
```