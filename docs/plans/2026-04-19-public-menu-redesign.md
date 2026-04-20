# PublicMenu Visual Redesign — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Modernize PublicMenu.vue visual design to match the "Cardápio Lanchão" prototype — warm delivery-app aesthetic with improved spacing, typography, and refined components.

**Architecture:** CSS-first approach — new CSS variable system for warm theme, template restructuring for hero/info card/category pills/product cards, new featured carousel section. Backend adds `featured` flag to Product model and exposes it in public menu API. Admin gets star toggle icon.

**Tech Stack:** Vue 3 SFC (scoped CSS), Prisma (PostgreSQL), Express.js, Bootstrap 5, Google Fonts (Inter)

---

## Task 1: Add `featured` field to Product model (Backend)

**Files:**
- Modify: `delivery-saas-backend/prisma/schema.prisma` (Product model, ~line 1045)
- Modify: `delivery-saas-backend/src/routes/menu.js` (~lines 405, 495)
- Modify: `delivery-saas-backend/src/routes/publicMenu.js` (~line 348)

**Step 1: Add field to Prisma schema**

In `schema.prisma`, Product model (~line 1045), add after `highlightOnSlip`:

```prisma
  featured        Boolean  @default(false)
```

**Step 2: Push schema to dev DB**

```bash
cd delivery-saas-backend && npx prisma db push --skip-generate && npx prisma generate
```

Expected: Schema synced, no errors.

**Step 3: Add `featured` to PATCH /products/:id**

In `delivery-saas-backend/src/routes/menu.js`, in the PATCH handler (~line 495), add `featured` to the destructured fields:

```javascript
const { name, description, price, categoryId, position, isActive, image, menuId, technicalSheetId, stockIngredientId, cashbackPercent, dadosFiscaisId, highlightOnSlip, alwaysAvailable, weeklySchedule, featured } = req.body;
```

And in the `data` object construction (~line 578), add:

```javascript
if (featured !== undefined) data.featured = featured;
```

**Step 4: Add `featured` to POST /products**

In the POST handler (~line 405), add `featured` to the destructured fields, and include `featured: featured || false` in the create data (~line 433).

**Step 5: Ensure featured is returned in public menu**

In `publicMenu.js`, the product response already uses spread (`...p`) so `featured` will be included automatically. Verify by checking ~line 348.

**Step 6: Add recently-ordered endpoint for public customers**

In `publicMenu.js`, add a new route before the orders endpoint (~line 1660):

```javascript
router.get('/:companyId/recently-ordered-products', async (req, res) => {
  try {
    const { companyId } = req.params;
    const phone = req.query.phone || req.session?.public_phone;
    if (!phone) return res.json([]);

    const recentOrders = await prisma.order.findMany({
      where: { companyId, customerPhone: phone },
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: { items: { select: { productId: true } } },
    });

    const productIds = [...new Set(
      recentOrders.flatMap(o => o.items.map(i => i.productId).filter(Boolean))
    )];

    res.json(productIds);
  } catch (err) {
    console.error('recently-ordered-products error:', err);
    res.json([]);
  }
});
```

**Step 7: Commit**

```bash
git add prisma/schema.prisma src/routes/menu.js src/routes/publicMenu.js
git commit -m "feat(menu): add featured flag to Product model and recently-ordered endpoint"
```

---

## Task 2: Add featured star toggle in MenuAdmin (Frontend)

**Files:**
- Modify: `delivery-saas-frontend/src/views/MenuAdmin.vue` (~lines 116-125)

**Step 1: Add star toggle button**

In MenuAdmin.vue, in the product actions div (~line 120), add before the edit button:

```vue
<button
  v-if="isAdmin"
  class="btn btn-sm"
  :class="p.featured ? 'btn-warning' : 'btn-outline-warning'"
  @click.stop="toggleFeatured(p)"
  :aria-label="`${p.featured ? 'Remover destaque' : 'Destacar'} ${p.name || 'produto'}`"
  :title="p.featured ? 'Remover dos destaques' : 'Destacar produto'"
>
  <i :class="['bi', p.featured ? 'bi-star-fill' : 'bi-star']"></i>
</button>
```

**Step 2: Add toggleFeatured function**

In the script section of MenuAdmin.vue, add the function near the existing `toggleActive`:

```javascript
async function toggleFeatured(product) {
  try {
    const newVal = !product.featured;
    await api.patch(`/menu/products/${product.id}`, { featured: newVal });
    product.featured = newVal;
  } catch (err) {
    console.error('toggleFeatured error:', err);
  }
}
```

**Step 3: Commit**

```bash
git add src/views/MenuAdmin.vue
git commit -m "feat(admin): add featured star toggle on product cards"
```

---

## Task 3: Add Inter font + CSS variable system in PublicMenu

**Files:**
- Modify: `delivery-saas-frontend/src/views/PublicMenu.vue` (template line ~1, style section ~line 4209)

**Step 1: Add Inter font import**

At the very top of the `<style scoped>` section (~line 4209), add:

```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
```

**Step 2: Add CSS variable definitions**

After the import, add the new variable system:

```css
#mainMenu {
  --pm-bg: #FFF8F0;
  --pm-surface: #FFFFFF;
  --pm-surface-alt: #FBF3E8;
  --pm-border: #F0E6D2;
  --pm-text: #1A1410;
  --pm-text-muted: #7A6E62;
  --pm-text-dim: #A89C90;
  --pm-radius-card: 18px;
  --pm-radius-pill: 999px;
  --pm-radius-modal: 24px;
  --pm-cashback-bg: #E8F5E9;
  --pm-cashback-fg: #1B5E20;
  --pm-cashback-pill: #2E7D32;
  --pm-shadow-card: 0 2px 12px rgba(0,0,0,0.06);
  --pm-shadow-elevated: 0 12px 32px rgba(0,0,0,0.12), 0 2px 6px rgba(0,0,0,0.06);
  --pm-font: 'Inter', -apple-system, system-ui, sans-serif;

  font-family: var(--pm-font);
  background: var(--pm-bg);
  color: var(--pm-text);
  -webkit-font-smoothing: antialiased;
}
```

**Step 3: Commit**

```bash
git add src/views/PublicMenu.vue
git commit -m "feat(public-menu): add Inter font and warm CSS variable system"
```

---

## Task 4: Modernize Hero + Info Card

**Files:**
- Modify: `delivery-saas-frontend/src/views/PublicMenu.vue` (template ~lines 19-116, style ~lines 4216-4310)

**Step 1: Update hero gradient overlay**

Replace the hero-image inline style (`filter: brightness(0.6)`) with a gradient overlay div. In template ~line 21, change the hero structure to:

```html
<div class="public-hero position-relative text-white" ref="heroRef">
  <div class="hero-image" :style="{ backgroundImage: 'url(' + heroBannerUrl + ')' }" style="position:absolute;inset:0;background-size:cover;background-position:center"></div>
  <div class="hero-gradient"></div>
  <!-- existing top-public-nav stays the same -->
```

Add CSS:

```css
.hero-gradient {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.15) 30%, rgba(0,0,0,0.75) 100%);
  z-index: 1;
}
```

**Step 2: Modernize info card (hero-panel)**

Restructure the hero-panel template (~lines 84-116) to include:
- Logo in rounded square with brand bg
- Company name + subtitle
- Rating/distance row (if data available)
- Status pill with animated dot (open=green glow, closed=red)
- 3-column delivery stats divider (Entrega time | Taxa | Mínimo)
- "Mais informações" link with chevron icon

Replace hero-panel CSS:

```css
.hero-panel {
  background: var(--pm-surface);
  margin-top: -48px;
  padding: 18px;
  border-radius: 20px;
  max-width: 980px;
  box-shadow: var(--pm-shadow-elevated);
  position: relative;
  z-index: 1046;
}
```

Add status pill CSS:

```css
.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-radius: var(--pm-radius-pill);
  font-size: 12.5px;
  font-weight: 600;
  letter-spacing: -0.1px;
}
.status-pill.open { background: #0E6B1F; color: #fff; }
.status-pill.closed { background: #2A1A0E; color: #fff; }
.status-dot {
  width: 7px; height: 7px; border-radius: 50%;
}
.status-dot.open { background: #6EE787; box-shadow: 0 0 8px #6EE787; }
.status-dot.closed { background: #FF9B9B; }

.delivery-stats {
  display: flex;
  align-items: center;
  padding: 12px 0 0;
  border-top: 1px solid var(--pm-border);
  margin-top: 14px;
}
.delivery-stat {
  flex: 1;
  text-align: center;
}
.delivery-stat-label {
  font-size: 11px;
  color: var(--pm-text-muted);
  margin-bottom: 2px;
}
.delivery-stat-value {
  font-size: 13px;
  font-weight: 700;
  color: var(--pm-text);
}
.delivery-stat-divider {
  width: 1px;
  height: 28px;
  background: var(--pm-border);
}
```

**Step 3: Update company-logo-wrapper**

```css
.company-logo-wrapper {
  width: 56px; height: 56px;
  background: var(--pm-surface);
  border-radius: 10px;
  overflow: hidden;
  box-shadow: 0 4px 12px rgba(0,0,0,0.1);
  flex: 0 0 56px;
}
```

**Step 4: Commit**

```bash
git add src/views/PublicMenu.vue
git commit -m "feat(public-menu): modernize hero section and info card with warm design"
```

---

## Task 5: Modernize Category Pills

**Files:**
- Modify: `delivery-saas-frontend/src/views/PublicMenu.vue` (template ~lines 183-192, style ~lines 4786-4800)

**Step 1: Update category pill template**

Replace the nav-link classes to use rounded pill styling. In template ~line 186:

```html
<a :href="`#cat-${cat.id}`"
   class="category-pill"
   :class="{ active: activeCategoryId === cat.id }"
   @click.prevent="selectCategory(cat.id)">
  {{ cat.name }}
</a>
```

**Step 2: Replace nav-pills CSS with category-pill styles**

```css
.categories-pills .nav {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding: 0 16px;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
}
.categories-pills .nav::-webkit-scrollbar { display: none; }

.category-pill {
  all: unset;
  cursor: pointer;
  flex-shrink: 0;
  padding: 8px 14px;
  border-radius: var(--pm-radius-pill);
  background: var(--pm-surface);
  color: var(--pm-text);
  border: 1px solid var(--pm-border);
  font-size: 13px;
  font-weight: 600;
  letter-spacing: -0.1px;
  transition: all 0.2s;
  white-space: nowrap;
  text-decoration: none;
}
.category-pill.active {
  background: var(--brand, #0d6efd);
  color: #fff;
  border-color: var(--brand, #0d6efd);
}
```

**Step 3: Commit**

```bash
git add src/views/PublicMenu.vue
git commit -m "feat(public-menu): modernize category pills to rounded pill style"
```

---

## Task 6: Modernize Product Cards + Cashback Badge

**Files:**
- Modify: `delivery-saas-frontend/src/views/PublicMenu.vue` (template ~lines 246-276, style ~lines 4331-4372)

**Step 1: Update product card template**

Replace the product card structure (~lines 246-276) with the modernized design:

```html
<div class="col-12 col-lg-6" v-for="p in cat.products" :key="p.id">
  <div class="product-card" @click="openProductModal(p)" tabindex="0" @keydown.enter="openProductModal(p)">
    <div class="product-card-body">
      <div>
        <div v-if="p.featured" class="product-tag">Destaque</div>
        <h6 class="product-title">{{ p.name }}</h6>
        <div class="product-desc">{{ p.description }}</div>
      </div>
      <div>
        <div v-if="getProductCashbackPercent(p) > 0" class="cashback-pill">
          <span class="cashback-coin">$</span>
          <span>{{ getProductCashbackPercent(p) }}% cashback · {{ formatCurrency(Number(p.price || 0) * getProductCashbackPercent(p) / 100) }}</span>
        </div>
        <strong class="product-price">
          <span v-if="getStartingPrice(p) > Number(p.price || 0)"><small>A partir de</small> {{ formatCurrency(getStartingPrice(p)) }}</span>
          <span v-else>{{ formatCurrency(p.price) }}</span>
        </strong>
      </div>
    </div>
    <div class="product-card-media">
      <div class="product-image-wrap">
        <img v-if="p.image" :src="assetUrl(p.image)" class="product-image" loading="lazy" />
        <div v-else class="product-image-placeholder"></div>
      </div>
      <button v-if="!isCatalogMode" class="product-add-btn" @click.stop="quickAdd(p)" aria-label="Adicionar ao carrinho">
        <i class="bi bi-plus"></i>
      </button>
    </div>
  </div>
</div>
```

**Step 2: Add quickAdd function in script**

In the script section, add a simple quick-add function that adds 1x product with no options:

```javascript
function quickAdd(p) {
  openProductModal(p);
}
```

(Keep it simple — opening the modal is the safest approach since products may have required options.)

**Step 3: Replace product card CSS**

```css
.product-card {
  display: flex;
  align-items: stretch;
  gap: 14px;
  padding: 14px;
  background: var(--pm-surface);
  border-radius: var(--pm-radius-card);
  border: 1px solid var(--pm-border);
  cursor: pointer;
  position: relative;
  transition: box-shadow 0.2s;
}
.product-card:hover {
  box-shadow: 0 4px 16px rgba(0,0,0,0.08);
}
.product-card-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  min-height: 100px;
}
.product-tag {
  display: inline-flex;
  padding: 2px 8px;
  border-radius: 4px;
  background: var(--brand-lightest, #FFE8EC);
  color: var(--brand-dark, #C8102E);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.4px;
  text-transform: uppercase;
  margin-bottom: 6px;
}
.product-title {
  font-size: 15.5px;
  font-weight: 700;
  color: var(--pm-text);
  letter-spacing: -0.2px;
  margin-bottom: 4px;
  line-height: 1.25;
}
.product-desc {
  font-size: 12.5px;
  color: var(--pm-text-muted);
  line-height: 1.4;
  margin-bottom: 10px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.product-price {
  font-size: 17px;
  font-weight: 800;
  color: var(--brand-dark, #C8102E);
  letter-spacing: -0.3px;
  line-height: 1;
}
.product-price small { font-size: 0.75rem; }

/* Cashback pill */
.cashback-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 9px 4px 7px;
  border-radius: var(--pm-radius-pill);
  background: var(--pm-cashback-bg);
  color: var(--pm-cashback-fg);
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: -0.1px;
  border: 1px solid rgba(30,90,30,0.12);
  margin-bottom: 8px;
}
.cashback-coin {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--pm-cashback-pill);
  color: #fff;
  font-size: 10px;
  font-weight: 800;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

/* Product image */
.product-card-media {
  position: relative;
  width: 104px;
  flex-shrink: 0;
}
.product-image-wrap {
  width: 104px;
  height: 104px;
  border-radius: 14px;
  overflow: hidden;
  background: var(--pm-surface-alt);
}
.product-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.product-image-placeholder {
  width: 100%;
  height: 100%;
  background: var(--pm-surface-alt);
}
.product-add-btn {
  all: unset;
  cursor: pointer;
  position: absolute;
  right: -6px;
  bottom: -6px;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--brand, #0d6efd);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 12px rgba(0,0,0,0.2);
  border: 2px solid var(--pm-surface);
  font-size: 18px;
  transition: transform 0.15s;
}
.product-add-btn:hover { transform: scale(1.1); }

@media (max-width: 991px) {
  .product-card { border-radius: 14px; }
  .product-card-media { width: 100px; }
  .product-image-wrap { width: 100px; height: 100px; border-radius: 12px; }
}
```

**Step 4: Commit**

```bash
git add src/views/PublicMenu.vue
git commit -m "feat(public-menu): modernize product cards with warm design and cashback pill"
```

---

## Task 7: Add Featured Carousel Section

**Files:**
- Modify: `delivery-saas-frontend/src/views/PublicMenu.vue` (template ~line 230, script for featured logic)

**Step 1: Add featured data logic in script**

In the script section, add computed and fetch for featured products:

```javascript
const featuredProducts = computed(() => {
  const allProducts = categories.value.flatMap(c => c.products || []);
  return allProducts.filter(p => p.featured && p.isActive !== false);
});

const recentProductIds = ref([]);

async function fetchRecentlyOrdered() {
  if (!publicCustomerConnected.value) return;
  try {
    const phone = publicCustomerConnected.value.contact || publicCustomerConnected.value.phone;
    if (!phone) return;
    const digits = phone.replace(/\D/g, '');
    const { data } = await api.get(`/public/${companyId}/recently-ordered-products?phone=${encodeURIComponent(digits)}`);
    recentProductIds.value = data || [];
  } catch (e) {
    recentProductIds.value = [];
  }
}

const highlightedProducts = computed(() => {
  const allProducts = categories.value.flatMap(c => c.products || []);
  const featured = allProducts.filter(p => p.featured && p.isActive !== false);

  if (recentProductIds.value.length > 0) {
    const recentProducts = recentProductIds.value
      .map(id => allProducts.find(p => p.id === id))
      .filter(p => p && p.isActive !== false && !featured.some(f => f.id === p.id));
    return [...featured, ...recentProducts.slice(0, 6)];
  }

  return featured;
});
```

Call `fetchRecentlyOrdered()` inside the existing `onMounted` after menu data is loaded.

**Step 2: Add featured carousel template**

Insert before the categories-pills container (~line 181), inside the `v-else` block:

```html
<!-- Featured carousel -->
<div v-if="highlightedProducts.length > 0 && !productSearchTerm" class="featured-section mb-3">
  <div class="featured-header">
    <span class="featured-title">Destaques da casa</span>
    <i class="bi bi-star-fill featured-star"></i>
  </div>
  <div class="featured-scroll">
    <div v-for="p in highlightedProducts" :key="'feat-'+p.id" class="featured-card" @click="openProductModal(p)">
      <div class="featured-card-image">
        <img v-if="p.image" :src="assetUrl(p.image)" loading="lazy" />
        <div v-else class="featured-card-placeholder"></div>
        <div v-if="p.featured" class="featured-card-tag">Destaque</div>
        <div v-else class="featured-card-tag recent">Pedido recente</div>
      </div>
      <div class="featured-card-body">
        <div class="featured-card-name">{{ p.name }}</div>
        <div class="featured-card-footer">
          <strong class="featured-card-price">{{ formatCurrency(p.price) }}</strong>
          <button v-if="!isCatalogMode" class="featured-card-add" @click.stop="openProductModal(p)" aria-label="Adicionar">
            <i class="bi bi-plus"></i>
          </button>
        </div>
      </div>
    </div>
  </div>
</div>
```

**Step 3: Add featured section CSS**

```css
.featured-section { margin-top: 22px; }
.featured-header {
  padding: 0 16px 10px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.featured-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--pm-text);
  letter-spacing: -0.2px;
}
.featured-star { color: #F2A900; font-size: 14px; }
.featured-scroll {
  display: flex;
  gap: 12px;
  overflow-x: auto;
  padding: 0 16px 4px;
  scroll-snap-type: x mandatory;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
}
.featured-scroll::-webkit-scrollbar { display: none; }
.featured-card {
  flex-shrink: 0;
  width: 220px;
  scroll-snap-align: start;
  background: var(--pm-surface);
  border-radius: 16px;
  overflow: hidden;
  border: 1px solid var(--pm-border);
  cursor: pointer;
  transition: box-shadow 0.2s;
}
.featured-card:hover { box-shadow: 0 6px 20px rgba(0,0,0,0.1); }
.featured-card-image {
  position: relative;
  width: 100%;
  height: 120px;
  background: var(--pm-surface-alt);
}
.featured-card-image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.featured-card-placeholder {
  width: 100%;
  height: 100%;
  background: var(--pm-surface-alt);
}
.featured-card-tag {
  position: absolute;
  top: 8px;
  left: 8px;
  padding: 3px 8px;
  border-radius: 4px;
  background: #F2A900;
  color: #2A1A0E;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.3px;
  text-transform: uppercase;
}
.featured-card-tag.recent {
  background: var(--pm-cashback-bg);
  color: var(--pm-cashback-fg);
}
.featured-card-body { padding: 12px; }
.featured-card-name {
  font-size: 13.5px;
  font-weight: 700;
  color: var(--pm-text);
  letter-spacing: -0.2px;
  margin-bottom: 6px;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.featured-card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.featured-card-price {
  font-size: 15px;
  font-weight: 800;
  color: var(--brand-dark, #C8102E);
  letter-spacing: -0.2px;
}
.featured-card-add {
  all: unset;
  cursor: pointer;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: var(--brand, #0d6efd);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 3px 8px rgba(0,0,0,0.2);
  font-size: 16px;
}
.featured-card-add:hover { transform: scale(1.1); }
```

**Step 4: Commit**

```bash
git add src/views/PublicMenu.vue
git commit -m "feat(public-menu): add featured carousel with admin highlights and recent orders"
```

---

## Task 8: Modernize Product Modal CSS

**Files:**
- Modify: `delivery-saas-frontend/src/views/PublicMenu.vue` (style section ~lines 4392-4605)

**Step 1: Update modal visual styles**

Replace/update the following CSS rules:

```css
/* Modal bottom-sheet modernization */
.product-modal .modal-content {
  width: 920px;
  max-width: 95%;
  max-height: 90vh;
  overflow: auto;
  border-radius: var(--pm-radius-modal);
  margin: 0 auto;
  padding: 0;
  border: none;
}

.modal-product-hero {
  width: 100%;
  height: 220px;
  overflow: hidden;
  border-radius: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--pm-surface-alt);
}

/* Option group header */
.group-header {
  background-color: var(--pm-surface-alt);
  padding: 14px 20px 10px;
  border-radius: 0;
  font-size: 14px;
}
.group-header .badge.bg-secondary,
.group-header .badge.bg-danger {
  background: var(--pm-text) !important;
  color: var(--pm-surface) !important;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.4px;
  text-transform: uppercase;
  padding: 3px 9px;
  border-radius: 4px;
}

.option-row {
  padding: 12px 20px;
  border-bottom: 1px solid var(--pm-border);
  font-size: 14px;
}

/* Qty stepper in modal footer */
.qty-control {
  background: var(--pm-surface-alt);
  border-radius: var(--pm-radius-pill);
  padding: 4px;
}
.qty-control .btn-qty {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--pm-surface);
  border: none;
}

/* Add button */
.add-btn {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 0 20px;
  height: 52px;
  border-radius: 14px;
  background: var(--brand, #0d6efd);
  color: #fff;
  border: none;
  font-weight: 700;
  font-size: 15px;
  box-shadow: 0 6px 16px rgba(0,0,0,0.2);
}

/* Mobile bottom-sheet handle */
@media (max-width: 767px) {
  .product-modal .modal-content {
    border-radius: var(--pm-radius-modal) var(--pm-radius-modal) 0 0 !important;
  }
}
```

**Step 2: Commit**

```bash
git add src/views/PublicMenu.vue
git commit -m "feat(public-menu): modernize product modal with warm design tokens"
```

---

## Task 9: Modernize Cart Drawer

**Files:**
- Modify: `delivery-saas-frontend/src/views/PublicMenu.vue` (template ~lines 824-926, style ~lines 4628-4720)

**Step 1: Update drawer header template**

Update the drawer header (~line 827-832) to include store name:

```html
<div class="drawer-header d-flex justify-content-between align-items-center p-3 border-bottom">
  <div>
    <div class="drawer-subtitle">Sacola</div>
    <h5 class="m-0">{{ displayName }}</h5>
  </div>
  <button class="btn-icon-round" @click="closeCartModal" aria-label="Fechar">
    <i class="bi bi-x-lg"></i>
  </button>
</div>
```

**Step 2: Add cashback summary in cart**

In the cart-summary section (~line 887), update the cashback line:

```html
<div v-if="cashbackEnabled && estimatedCashbackTotal > 0" class="cashback-summary-row">
  <div class="cashback-pill">
    <span class="cashback-coin">$</span>
    <span>Você receberá {{ formatCurrency(estimatedCashbackTotal) }} de cashback</span>
  </div>
</div>
```

**Step 3: Update drawer CSS**

```css
.drawer-subtitle {
  font-size: 11px;
  font-weight: 600;
  color: var(--pm-text-muted);
  letter-spacing: 0.5px;
  text-transform: uppercase;
  margin-bottom: 2px;
}
.btn-icon-round {
  all: unset;
  cursor: pointer;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: var(--pm-surface-alt);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--pm-text);
  font-size: 14px;
}
.btn-icon-round:hover { background: var(--pm-border); }

.cart-drawer {
  background: var(--pm-bg);
  border-radius: 0;
}
.cart-drawer .drawer-header {
  background: var(--pm-surface);
  border-bottom: 1px solid var(--pm-border) !important;
}
.cart-drawer .drawer-footer {
  background: var(--pm-surface);
  border-top: 1px solid var(--pm-border) !important;
}
.cashback-summary-row {
  padding: 8px 0;
  margin-bottom: 12px;
}
```

**Step 4: Commit**

```bash
git add src/views/PublicMenu.vue
git commit -m "feat(public-menu): modernize cart drawer with warm design"
```

---

## Task 10: Modernize Floating Cart Bar + Bottom Nav

**Files:**
- Modify: `delivery-saas-frontend/src/views/PublicMenu.vue` (template ~lines 125-157, style ~lines 4725-4740)

**Step 1: Update mobile cart bar template**

Replace the mobile cart bar (~lines 125-138):

```html
<div v-if="!isCatalogMode && cart.length > 0 && !cartModalOpen && !modalOpen && !checkoutModalOpen"
     class="mobile-cart-bar d-lg-none" @click="openCartModal">
  <div class="cart-bar-count">{{ cart.length }}</div>
  <div class="cart-bar-label">Ver sacola</div>
  <div class="cart-bar-total">{{ formatCurrency(subtotal) }}</div>
</div>
```

**Step 2: Update CSS for floating cart bar**

```css
.mobile-cart-bar {
  position: fixed;
  left: 12px;
  right: 12px;
  bottom: 76px;
  z-index: 1048;
  height: 56px;
  border-radius: 16px;
  background: var(--brand, #0d6efd);
  color: #fff;
  padding: 0 16px;
  display: flex;
  align-items: center;
  gap: 12px;
  box-shadow: 0 10px 24px rgba(0,0,0,0.25);
  cursor: pointer;
  animation: pm-pop 0.3s ease;
}
.cart-bar-count {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  background: rgba(255,255,255,0.22);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 800;
}
.cart-bar-label {
  flex: 1;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: -0.1px;
}
.cart-bar-total {
  font-size: 15px;
  font-weight: 800;
}
@keyframes pm-pop {
  0% { transform: scale(0.85); opacity: 0; }
  100% { transform: scale(1); opacity: 1; }
}
```

**Step 3: Update bottom nav CSS**

```css
.mobile-bottom-nav {
  display: flex;
  position: fixed;
  left: 0; right: 0; bottom: 0;
  height: 64px;
  background: var(--pm-surface);
  border-top: 1px solid var(--pm-border);
  z-index: 10800;
  align-items: center;
  justify-content: space-around;
}
.mobile-bottom-nav .nav-item {
  background: transparent;
  border: none;
  padding: 6px 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  color: var(--pm-text-muted);
}
.mobile-bottom-nav .nav-icon { font-size: 22px; line-height: 1; }
.mobile-bottom-nav .nav-label { font-size: 10.5px; }
.mobile-bottom-nav .nav-item.active,
.mobile-bottom-nav .nav-item.active .nav-label,
.mobile-bottom-nav .nav-item.active .nav-icon {
  color: var(--brand, #0d6efd) !important;
  font-weight: 700;
}
```

**Step 4: Commit**

```bash
git add src/views/PublicMenu.vue
git commit -m "feat(public-menu): modernize floating cart bar and bottom nav"
```

---

## Task 11: General Typography + Remaining CSS Cleanup

**Files:**
- Modify: `delivery-saas-frontend/src/views/PublicMenu.vue` (style section)

**Step 1: Update section titles**

```css
/* Section titles */
#mainMenu h5, #mainMenu .h5 {
  font-size: 19px;
  font-weight: 800;
  color: var(--pm-text);
  letter-spacing: -0.4px;
  text-align: left;
  margin-bottom: 4px;
}
```

**Step 2: Update background/borders globally**

```css
/* Global warm overrides */
#mainMenu .hero-panel { background: var(--pm-surface); }
#mainMenu .list-group-item {
  border: 1px solid var(--pm-border) !important;
  border-radius: 14px !important;
}
#mainMenu .list-group-item.selected {
  border-color: var(--brand) !important;
  background-color: var(--brand-lightest, #d6ffb3) !important;
}
#mainMenu .form-control {
  border: 1px solid var(--pm-border);
  border-radius: 12px;
}
#mainMenu .form-control:focus {
  border-color: var(--brand, #0d6efd);
  box-shadow: 0 0 0 3px rgba(var(--brand-rgb, 13,110,253), 0.12);
}
```

**Step 3: Update search box to match warm palette**

```css
.search-toggle-btn {
  border: 1px solid var(--pm-border);
  background: var(--pm-surface);
  border-radius: 14px;
}
.search-input-container .search-input {
  border: 1px solid var(--pm-border) !important;
  border-radius: 14px !important;
  background: var(--pm-surface);
}
```

**Step 4: Remove old add-to-card-plus animation (replaced by product-add-btn)**

Delete the old `.add-to-card-plus` CSS rules (~lines 5185-5219).

**Step 5: Commit**

```bash
git add src/views/PublicMenu.vue
git commit -m "feat(public-menu): apply warm typography and final CSS cleanup"
```

---

## Task 12: Visual smoke test

**Step 1: Start dev environment**

```bash
docker compose up -d
```

**Step 2: Open PublicMenu in browser**

Navigate to the public menu URL and verify:
- [ ] Warm cream background applied
- [ ] Hero with gradient overlay
- [ ] Info card with status pill, delivery stats
- [ ] Category pills (rounded, active = brand color)
- [ ] Product cards with photo-right, cashback pill, "+" button
- [ ] Featured carousel shows above categories (if products are marked)
- [ ] Cart drawer opens with store name
- [ ] Floating cart bar with pill shape
- [ ] Bottom nav with brand active color
- [ ] Product modal with modernized styling
- [ ] Mobile responsive looks good

**Step 3: Test admin featured toggle**

- Go to MenuAdmin, click star on a product
- Refresh PublicMenu — product should appear in "Destaques da casa"

**Step 4: Final commit if adjustments needed**

```bash
git add -A
git commit -m "fix(public-menu): visual adjustments from smoke test"
```

---

Plan complete and saved to `docs/plans/2026-04-19-public-menu-redesign.md`. Two execution options:

**1. Subagent-Driven (this session)** — I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** — Open new session with executing-plans, batch execution with checkpoints

Which approach?