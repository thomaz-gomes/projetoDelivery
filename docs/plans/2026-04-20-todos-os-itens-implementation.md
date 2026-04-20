# "Todos os Itens" — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create N:N relationship between categories and menus, then add a virtual "Todos os itens" entry in the menu list for unified category/product management with menu badges.

**Architecture:** New `MenuCategoryMenu` join table replaces `MenuCategory.menuId` FK. Backend routes updated to query through join table. Frontend `Menus.vue` gets a fixed row; `MenuAdmin.vue` gains menu-badge display and a menu-link dropdown per category.

**Tech Stack:** Prisma (PostgreSQL), Express.js, Vue 3, Bootstrap 5

---

### Task 1: Prisma Schema — Add `MenuCategoryMenu` join table

**Files:**
- Modify: `delivery-saas-backend/prisma/schema.prisma:590-620` (Menu model)
- Modify: `delivery-saas-backend/prisma/schema.prisma:1000-1020` (MenuCategory model)

**Step 1: Add the `MenuCategoryMenu` model and update relations**

In `schema.prisma`, add the new model after `MenuCategory` (around line 1020):

```prisma
model MenuCategoryMenu {
  id             String       @id @default(uuid())
  menuCategoryId String
  menuCategory   MenuCategory @relation(fields: [menuCategoryId], references: [id], onDelete: Cascade)
  menuId         String
  menu           Menu         @relation(fields: [menuId], references: [id], onDelete: Cascade)
  position       Int          @default(0)
  createdAt      DateTime     @default(now())

  @@unique([menuCategoryId, menuId])
  @@index([menuId])
}
```

In the `Menu` model (~line 613), replace:
```prisma
  categories     MenuCategory[]
```
with:
```prisma
  categoryLinks  MenuCategoryMenu[]
```

In the `MenuCategory` model (~line 1005-1006), remove:
```prisma
  // optional: associate category to a specific Menu (for multi-menu support)
  menuId         String?
  menu           Menu?         @relation(fields: [menuId], references: [id])
```
and add:
```prisma
  menuLinks      MenuCategoryMenu[]
```

**Step 2: Push schema to dev DB**

Run: `docker compose exec backend npx prisma db push`
Expected: Schema applied successfully (may warn about data loss for `menuId` column — we'll handle migration in Task 2)

**IMPORTANT:** Before pushing, we need the migration script first (Task 2). Do Task 2 BEFORE this step.

---

### Task 2: Data Migration — Move `menuId` FK to join table

**Files:**
- Create: `delivery-saas-backend/prisma/migrations/manual-menu-category-n2n.js`

**Step 1: Write the migration script**

```js
// Run BEFORE removing menuId column from schema
// Usage: node prisma/migrations/manual-menu-category-n2n.js
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  // Find all categories that have a menuId set
  const categories = await prisma.$queryRaw`
    SELECT id, "menuId", position FROM "MenuCategory" WHERE "menuId" IS NOT NULL
  `
  console.log(`Found ${categories.length} categories with menuId to migrate`)

  for (const cat of categories) {
    // Check if link already exists
    const existing = await prisma.$queryRaw`
      SELECT id FROM "MenuCategoryMenu"
      WHERE "menuCategoryId" = ${cat.id} AND "menuId" = ${cat.menuId}
    `
    if (existing.length > 0) {
      console.log(`  Skip ${cat.id} -> ${cat.menuId} (already exists)`)
      continue
    }
    await prisma.$queryRaw`
      INSERT INTO "MenuCategoryMenu" (id, "menuCategoryId", "menuId", position, "createdAt")
      VALUES (gen_random_uuid(), ${cat.id}, ${cat.menuId}, ${cat.position}, NOW())
    `
    console.log(`  Migrated ${cat.id} -> ${cat.menuId}`)
  }
  console.log('Migration complete')
}

main().catch(console.error).finally(() => prisma.$disconnect())
```

**Step 2: Execute migration**

The migration must run in two phases:

1. First, add the `MenuCategoryMenu` model to schema WITHOUT removing `menuId` yet. Push:
   `docker compose exec backend npx prisma db push`

2. Run the migration script:
   `docker compose exec backend node prisma/migrations/manual-menu-category-n2n.js`

3. Then remove `menuId` from `MenuCategory` in schema and push again:
   `docker compose exec backend npx prisma db push`

4. Regenerate client:
   `docker compose exec backend npx prisma generate`

**Step 3: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/manual-menu-category-n2n.js
git commit -m "feat(schema): add MenuCategoryMenu N:N join table, migrate data from menuId FK"
```

---

### Task 3: Backend — Update `GET /categories` to include menu links

**Files:**
- Modify: `delivery-saas-backend/src/routes/menu.js:182-189`

**Step 1: Update the categories list endpoint**

Replace the `GET /categories` handler (lines 182-189):

```js
router.get('/categories', async (req, res) => {
  const companyId = req.user.companyId
  const { menuId } = req.query || {}
  const where = { companyId }
  // If menuId specified, filter through join table
  if (menuId) {
    where.menuLinks = { some: { menuId } }
  }
  const rows = await prisma.menuCategory.findMany({
    where,
    orderBy: { position: 'asc' },
    include: {
      menuLinks: {
        include: { menu: { select: { id: true, name: true } } },
        orderBy: { position: 'asc' }
      }
    }
  })
  res.json(rows)
})
```

**Step 2: Update `GET /categories/:id` to include menu links**

Update lines 192-202 to add `include`:

```js
router.get('/categories/:id', async (req, res) => {
  const { id } = req.params
  const companyId = req.user.companyId
  try {
    const row = await prisma.menuCategory.findFirst({
      where: { id, companyId },
      include: {
        menuLinks: {
          include: { menu: { select: { id: true, name: true } } }
        }
      }
    })
    if (!row) return res.status(404).json({ message: 'Categoria não encontrada' })
    return res.json(row)
  } catch (e) {
    console.error('GET /categories/:id error', e)
    return res.status(500).json({ message: 'Erro ao carregar categoria', error: String(e && e.message) })
  }
})
```

**Step 3: Commit**

```bash
git add delivery-saas-backend/src/routes/menu.js
git commit -m "feat(api): update GET /categories to use N:N join table with menu links"
```

---

### Task 4: Backend — Update category CRUD for N:N

**Files:**
- Modify: `delivery-saas-backend/src/routes/menu.js:205-249` (POST/PATCH categories)

**Step 1: Update `POST /categories`**

Replace lines 205-217. The endpoint now accepts `menuIds` array instead of `menuId`:

```js
router.post('/categories', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId
  const { name, position = 0, isActive = true, menuIds = [], dadosFiscaisId = null, description = null, alwaysAvailable = true, weeklySchedule = null } = req.body || {}
  if (!name) return res.status(400).json({ message: 'Nome é obrigatório' })
  // Validate all menuIds belong to company
  if (menuIds.length > 0) {
    const menus = await prisma.menu.findMany({
      where: { id: { in: menuIds } },
      include: { store: true }
    })
    const valid = menus.every(m => m.store && m.store.companyId === companyId)
    if (!valid || menus.length !== menuIds.length) return res.status(400).json({ message: 'Menu inválido para esta empresa' })
  }
  const created = await prisma.menuCategory.create({
    data: {
      companyId, name, position: Number(position || 0),
      isActive: Boolean(isActive),
      dadosFiscaisId: dadosFiscaisId || null,
      alwaysAvailable: alwaysAvailable !== false,
      weeklySchedule: alwaysAvailable === false ? (weeklySchedule || null) : null,
      menuLinks: menuIds.length > 0 ? {
        create: menuIds.map((mid, i) => ({ menuId: mid, position: Number(position || 0) }))
      } : undefined
    },
    include: {
      menuLinks: { include: { menu: { select: { id: true, name: true } } } }
    }
  })
  res.status(201).json(created)
})
```

**Step 2: Update `PATCH /categories/:id`**

Replace lines 219-249. Remove `menuId` handling, keep other fields:

```js
router.patch('/categories/:id', requireRole('ADMIN', 'ATTENDANT'), async (req, res) => {
  const { id } = req.params
  const companyId = req.user.companyId
  const userRole = String(req.user.role || '').toUpperCase()
  const existing = await prisma.menuCategory.findFirst({ where: { id, companyId } })
  if (!existing) return res.status(404).json({ message: 'Categoria não encontrada' })
  if (userRole === 'ATTENDANT') {
    if (req.body && Object.keys(req.body).some(k => k !== 'isActive')) {
      return res.status(403).json({ message: 'Atendentes só podem pausar/ativar itens' })
    }
  }
  const { name, position, isActive, dadosFiscaisId, alwaysAvailable, weeklySchedule } = req.body || {}
  const updated = await prisma.menuCategory.update({
    where: { id },
    data: {
      name: name ?? existing.name,
      position: position !== undefined ? Number(position) : existing.position,
      isActive: isActive !== undefined ? Boolean(isActive) : existing.isActive,
      dadosFiscaisId: dadosFiscaisId !== undefined ? (dadosFiscaisId || null) : existing.dadosFiscaisId,
      alwaysAvailable: alwaysAvailable !== undefined ? Boolean(alwaysAvailable) : existing.alwaysAvailable,
      weeklySchedule: alwaysAvailable !== undefined
        ? (alwaysAvailable === false ? (weeklySchedule || null) : null)
        : (weeklySchedule !== undefined ? weeklySchedule : existing.weeklySchedule),
    },
    include: {
      menuLinks: { include: { menu: { select: { id: true, name: true } } } }
    }
  })
  res.json(updated)
})
```

**Step 3: Commit**

```bash
git add delivery-saas-backend/src/routes/menu.js
git commit -m "feat(api): update POST/PATCH categories for N:N menu relationship"
```

---

### Task 5: Backend — Add `POST /categories/:id/menus` for menu link management

**Files:**
- Modify: `delivery-saas-backend/src/routes/menu.js` (add after PATCH /categories/:id, before reorder route)

**Step 1: Add the new route**

Insert before the `POST /reorder` route (~line 251):

```js
// POST /menu/categories/:id/menus — sync menu links for a category
router.post('/categories/:id/menus', requireRole('ADMIN'), async (req, res) => {
  const { id } = req.params
  const companyId = req.user.companyId
  const { menuIds = [] } = req.body || {}

  const existing = await prisma.menuCategory.findFirst({ where: { id, companyId } })
  if (!existing) return res.status(404).json({ message: 'Categoria não encontrada' })

  // Validate all menuIds belong to company
  if (menuIds.length > 0) {
    const menus = await prisma.menu.findMany({
      where: { id: { in: menuIds } },
      include: { store: true }
    })
    const valid = menus.every(m => m.store && m.store.companyId === companyId)
    if (!valid || menus.length !== menuIds.length) {
      return res.status(400).json({ message: 'Menu inválido para esta empresa' })
    }
  }

  // Sync: delete removed links, create new ones
  await prisma.$transaction(async (tx) => {
    // Remove links not in new list
    await tx.menuCategoryMenu.deleteMany({
      where: { menuCategoryId: id, menuId: { notIn: menuIds } }
    })
    // Get existing links
    const currentLinks = await tx.menuCategoryMenu.findMany({
      where: { menuCategoryId: id }
    })
    const currentMenuIds = currentLinks.map(l => l.menuId)
    // Create new links
    const toCreate = menuIds.filter(mid => !currentMenuIds.includes(mid))
    if (toCreate.length > 0) {
      await tx.menuCategoryMenu.createMany({
        data: toCreate.map(mid => ({
          menuCategoryId: id,
          menuId: mid,
          position: existing.position || 0
        }))
      })
    }
  })

  // Return updated category with links
  const updated = await prisma.menuCategory.findFirst({
    where: { id, companyId },
    include: {
      menuLinks: { include: { menu: { select: { id: true, name: true } } } }
    }
  })
  res.json(updated)
})
```

**Step 2: Commit**

```bash
git add delivery-saas-backend/src/routes/menu.js
git commit -m "feat(api): add POST /categories/:id/menus for N:N menu link sync"
```

---

### Task 6: Backend — Update duplicate category, delete category, and menuImport

**Files:**
- Modify: `delivery-saas-backend/src/routes/menu.js:290-360` (delete + duplicate)
- Modify: `delivery-saas-backend/src/routes/menuImport.js:662,715-717`

**Step 1: Update `DELETE /categories/:id`**

The delete route (line 290-299) needs no changes — `onDelete: Cascade` on `MenuCategoryMenu` will clean up join rows automatically.

**Step 2: Update `POST /categories/:id/duplicate`**

In the duplicate handler (~line 314), after creating the new category, also duplicate the menu links:

```js
const newCat = await tx.menuCategory.create({ data: {
  companyId,
  name: makeCopyName(existing.name),
  position: (existing.position ?? 0) + 1,
  isActive: existing.isActive ?? true
} })

// duplicate menu links
const existingLinks = await tx.menuCategoryMenu.findMany({ where: { menuCategoryId: id } })
if (existingLinks.length > 0) {
  await tx.menuCategoryMenu.createMany({
    data: existingLinks.map(l => ({
      menuCategoryId: newCat.id,
      menuId: l.menuId,
      position: l.position
    }))
  })
}
```

**Step 3: Update `menuImport.js`**

In `menuImport.js` line 662, the `deleteMany` for `menuCategory` with `menuId` filter needs updating.
Replace:
```js
await prisma.menuCategory.deleteMany({ where: { menuId, companyId } });
```
With:
```js
// Delete categories that are ONLY linked to this menu (not shared)
const exclusiveCategories = await prisma.menuCategory.findMany({
  where: {
    companyId,
    menuLinks: { some: { menuId } }
  },
  include: { menuLinks: true }
})
const exclusiveIds = exclusiveCategories
  .filter(c => c.menuLinks.length === 1 && c.menuLinks[0].menuId === menuId)
  .map(c => c.id)
// Remove join table entries for this menu
await prisma.menuCategoryMenu.deleteMany({ where: { menuId } })
// Delete categories that were exclusive to this menu
if (exclusiveIds.length > 0) {
  await prisma.menuCategory.deleteMany({ where: { id: { in: exclusiveIds } } })
}
```

In line 715-716, when creating new categories during import, also create the join link:
```js
const newCat = await prisma.menuCategory.create({
  data: { companyId, name: String(cat.name || 'Geral').trim(), isActive: true, position: ci },
})
// Link to menu
await prisma.menuCategoryMenu.create({
  data: { menuCategoryId: newCat.id, menuId, position: ci }
})
```

**Step 4: Commit**

```bash
git add delivery-saas-backend/src/routes/menu.js delivery-saas-backend/src/routes/menuImport.js
git commit -m "feat(api): update duplicate, delete, and import to use N:N join table"
```

---

### Task 7: Backend — Update public menu routes

**Files:**
- Modify: `delivery-saas-backend/src/routes/publicMenu.js:154-155,181,267-268,388`

**Step 1: Update all `where: { menuId }` filters on categories**

Every occurrence of `where: { companyId, isActive: true, menuId }` on `menuCategory.findMany` needs to change to use the join table.

Replace pattern:
```js
where: { companyId, isActive: true, menuId }
```
With:
```js
where: { companyId, isActive: true, menuLinks: { some: { menuId } } }
```

This applies to approximately 3 locations in publicMenu.js (lines ~154, ~267, ~268).

For products within the include, keep filtering by `menuId` directly since products still have `menuId` FK.

**Step 2: Commit**

```bash
git add delivery-saas-backend/src/routes/publicMenu.js
git commit -m "fix(public-menu): query categories through N:N join table"
```

---

### Task 8: Backend — Update products `menuId` handling

**Files:**
- Modify: `delivery-saas-backend/src/routes/menu.js:405,433,495` (product create/update)

**Step 1: Review product menuId usage**

Products still have their own `menuId` FK — this is intentional. A product belongs to a category, and when the category is in multiple menus, the product appears in all of them via the category. The product's own `menuId` serves as a direct association for products not assigned to a category.

**No changes needed** to the Product model or product routes for this task. Products in categories automatically appear in all menus the category is linked to.

**Step 2: Commit (if any changes were needed)**

Skip — no changes for products.

---

### Task 9: Frontend — Add "Todos os itens" fixed row in `Menus.vue`

**Files:**
- Modify: `delivery-saas-frontend/src/views/Menus.vue:35-80`

**Step 1: Add the fixed row before the menu table body**

In the `<tbody>` section (after line 46), add a fixed row before the `v-for`:

```html
<!-- Fixed "Todos os itens" row -->
<tr class="table-light">
  <td>
    <div><strong><a role="button" class="text-white" @click.prevent="openAllItems"><i class="bi bi-grid-3x3-gap me-2"></i>Todos os itens</a></strong></div>
    <div class="desc small text-muted">Gestão unificada de categorias e produtos</div>
  </td>
  <td><span class="text-muted">—</span></td>
  <td><span class="text-muted">—</span></td>
  <td></td>
</tr>
```

**Step 2: Add the `openAllItems` function**

In the `<script setup>` section, add:

```js
function openAllItems() {
  router.push({ path: '/menu/admin' })
}
```

Note: navigating to `/menu/admin` WITHOUT `menuId` query param will load all categories.

**Step 3: Commit**

```bash
git add delivery-saas-frontend/src/views/Menus.vue
git commit -m "feat(ui): add 'Todos os itens' fixed row in menu list"
```

---

### Task 10: Frontend — Add menu badges in `MenuAdmin.vue`

**Files:**
- Modify: `delivery-saas-frontend/src/views/MenuAdmin.vue:26-57` (category header template)
- Modify: `delivery-saas-frontend/src/views/MenuAdmin.vue:241-270` (load function)

**Step 1: Update the title in unified mode**

Change the `<h2>` tag (line 3) to show "Todos os itens" when no menuId:

```html
<h2>{{ menuId ? 'Cardápio (Admin)' : 'Todos os itens' }} <small v-if="menuInfo">- {{ menuInfo.name }}</small></h2>
```

**Step 2: Add menu badges in category header**

After the category name/item count div (around line 48), add badges:

```html
<div>
  <div class="category-title">{{ cat.name || 'Sem categoria' }}</div>
  <div class="d-flex align-items-center gap-1 flex-wrap">
    <span class="small text-muted">{{ cat.products.length }} itens</span>
    <template v-if="!menuId && cat.menuLinks && cat.menuLinks.length > 0">
      <span v-for="ml in cat.menuLinks" :key="ml.id" class="badge bg-info text-dark" style="font-size:0.7em">
        {{ ml.menu.name }}
      </span>
    </template>
    <span v-if="!menuId && (!cat.menuLinks || cat.menuLinks.length === 0)" class="badge bg-secondary" style="font-size:0.7em">
      Sem cardápio
    </span>
  </div>
</div>
```

**Step 3: Store menuLinks data from API response**

The `load()` function already fetches categories from `GET /menu/categories` which now includes `menuLinks`. The `categoriesList` ref will have `menuLinks` data automatically.

Update `groupedCategories` computed to pass `menuLinks` through:

In the line that builds ordered entries (~line 384):
```js
categoriesList.value.forEach(c => {
  const entry = map.get(c.id) || { id: c.id, name: c.name, products: [] }
  entry.isActive = c.isActive !== undefined ? c.isActive : true
  entry.menuLinks = c.menuLinks || []
  ordered.push(entry)
})
```

**Step 4: Commit**

```bash
git add delivery-saas-frontend/src/views/MenuAdmin.vue
git commit -m "feat(ui): show menu badges on categories in unified view"
```

---

### Task 11: Frontend — Add menu-link dropdown per category

**Files:**
- Modify: `delivery-saas-frontend/src/views/MenuAdmin.vue:51-56` (category actions area)

**Step 1: Add the link-menus button in category header**

In the `category-actions` div (line 51), add a dropdown button (only visible when no menuId — i.e. "Todos os itens" mode):

```html
<div class="category-actions">
  <!-- Menu link dropdown (only in unified view) -->
  <div v-if="!menuId && isAdmin" class="dropdown d-inline-block">
    <button class="btn btn-sm btn-outline-info" @click.stop="toggleMenuDropdown(cat)" title="Vincular a cardápios">
      <i class="bi bi-link-45deg me-1"></i>Cardápios
    </button>
    <div v-if="menuDropdownCatId === cat.id" class="dropdown-menu show p-2" style="min-width:200px" @click.stop>
      <div v-for="m in allMenus" :key="m.id" class="form-check">
        <input class="form-check-input" type="checkbox" :id="'ml-'+cat.id+'-'+m.id"
          :checked="isCategoryLinkedToMenu(cat, m.id)"
          @change="toggleMenuLink(cat, m.id, $event.target.checked)"
        />
        <label class="form-check-label" :for="'ml-'+cat.id+'-'+m.id">{{ m.name }}</label>
      </div>
      <div v-if="!allMenus.length" class="text-muted small">Nenhum cardápio</div>
    </div>
  </div>

  <button v-if="isAdmin" class="btn btn-sm btn-outline-secondary" ...>...</button>
  <!-- rest of existing buttons -->
</div>
```

**Step 2: Add the dropdown logic in `<script setup>`**

```js
const allMenus = ref([])
const menuDropdownCatId = ref(null)

// Load all menus for dropdown (only in unified view)
async function loadAllMenus() {
  if (menuId.value) return
  try {
    const r = await api.get('/menu/menus')
    allMenus.value = r.data || []
  } catch (e) { allMenus.value = [] }
}

function toggleMenuDropdown(cat) {
  menuDropdownCatId.value = menuDropdownCatId.value === cat.id ? null : cat.id
}

function isCategoryLinkedToMenu(cat, mid) {
  const realCat = findCategoryById(cat.id)
  if (!realCat || !realCat.menuLinks) return false
  return realCat.menuLinks.some(l => l.menuId === mid)
}

async function toggleMenuLink(cat, mid, checked) {
  const realCat = findCategoryById(cat.id)
  if (!realCat) return
  const currentIds = (realCat.menuLinks || []).map(l => l.menuId || l.menu?.id)
  let newIds
  if (checked) {
    newIds = [...currentIds, mid]
  } else {
    newIds = currentIds.filter(id => id !== mid)
  }
  try {
    const res = await api.post(`/menu/categories/${cat.id}/menus`, { menuIds: newIds })
    // Update local state
    realCat.menuLinks = res.data.menuLinks || []
    // Also update in groupedCategories
    const grouped = groupedCategories.value.find(c => c.id === cat.id)
    if (grouped) grouped.menuLinks = realCat.menuLinks
  } catch (e) {
    console.error('toggleMenuLink error', e)
    Swal.fire({ icon: 'error', text: 'Falha ao vincular cardápio', toast: true, position: 'top-end', timer: 2000, showConfirmButton: false })
  }
}
```

**Step 3: Call `loadAllMenus` in the `load` function**

At the end of the `load()` function, after loading categories:
```js
await loadAllMenus()
```

**Step 4: Add click-outside to close dropdown**

```js
// Close menu dropdown when clicking outside
function handleClickOutside() {
  menuDropdownCatId.value = null
}
onMounted(() => document.addEventListener('click', handleClickOutside))
import { onUnmounted } from 'vue'
onUnmounted(() => document.removeEventListener('click', handleClickOutside))
```

**Step 5: Commit**

```bash
git add delivery-saas-frontend/src/views/MenuAdmin.vue
git commit -m "feat(ui): add menu-link dropdown for categories in unified view"
```

---

### Task 12: Frontend — Update `CategoryForm.vue` for N:N

**Files:**
- Modify: `delivery-saas-frontend/src/views/CategoryForm.vue:20-26` (menu selector)
- Modify: `delivery-saas-frontend/src/views/CategoryForm.vue:80-100` (script)

**Step 1: Replace single-select with multi-select checkboxes**

Replace the menu selector (lines 20-26):

```html
<div class="col-md-6 mb-3">
  <label class="form-label">Cardápios vinculados</label>
  <div class="border rounded p-2" style="max-height:150px;overflow-y:auto">
    <div v-for="m in menus" :key="m.id" class="form-check">
      <input class="form-check-input" type="checkbox" :id="'cf-menu-'+m.id"
        :value="m.id" v-model="selectedMenuIds" />
      <label class="form-check-label" :for="'cf-menu-'+m.id">
        {{ m.name }} <small class="text-muted">({{ storesMap[m.storeId]?.name || '' }})</small>
      </label>
    </div>
    <div v-if="!menus.length" class="text-muted small">Nenhum cardápio</div>
  </div>
</div>
```

**Step 2: Update script to use `selectedMenuIds` array**

Replace `menuId` ref with:
```js
const selectedMenuIds = ref([])
```

In `load()`, after loading category data, populate from menuLinks:
```js
if (c.menuLinks) {
  selectedMenuIds.value = c.menuLinks.map(l => l.menuId || l.menu?.id).filter(Boolean)
}
```

In `loadMenus()`, remove the second fetch of the category to get menuId.

In `save()`, send `menuIds` instead of `menuId`:
```js
// In the create/update API call body:
{ name, position, isActive, menuIds: selectedMenuIds.value, dadosFiscaisId, ... }
```

After saving (for new categories), also sync menu links if menuIds provided:
```js
if (isEdit && selectedMenuIds.value.length > 0) {
  await api.post(`/menu/categories/${id}/menus`, { menuIds: selectedMenuIds.value })
}
```

**Step 3: Handle query param `menuId` for pre-selection**

When navigating from a specific menu's admin page:
```js
onMounted(() => {
  const qMenuId = route.query.menuId
  if (qMenuId && !isEdit) {
    selectedMenuIds.value = [qMenuId]
  }
})
```

**Step 4: Commit**

```bash
git add delivery-saas-frontend/src/views/CategoryForm.vue
git commit -m "feat(ui): update CategoryForm to support multiple menu selection"
```

---

### Task 13: Frontend — Hide edit/delete/config actions for "Todos os itens"

**Files:**
- Modify: `delivery-saas-frontend/src/views/MenuAdmin.vue`

**Step 1: Hide import button when in unified mode**

The `v-if="menuId"` on the import button (line 18) already handles this — no change needed.

**Step 2: Hide reorder button in unified view (position is per-menu)**

Add `v-if="menuId"` to the reorder button:
```html
<button v-if="menuId" class="btn btn-outline-secondary" @click="showReorderModal = true" ...>
```

**Step 3: Commit**

```bash
git add delivery-saas-frontend/src/views/MenuAdmin.vue
git commit -m "feat(ui): hide reorder and import in unified 'Todos os itens' view"
```

---

### Task 14: Backend — Update seed files (if needed)

**Files:**
- Modify: `delivery-saas-backend/src/seed.js`
- Modify: `delivery-saas-backend/src/seed-custom.js`
- Modify: `delivery-saas-backend/src/seed-large.js`

**Step 1: Update seed files**

Search each seed file for `menuCategory.create` calls that use `menuId` and replace with `menuLinks: { create: [{ menuId: ... }] }`.

**Step 2: Commit**

```bash
git add delivery-saas-backend/src/seed.js delivery-saas-backend/src/seed-custom.js delivery-saas-backend/src/seed-large.js
git commit -m "chore: update seed files for N:N category-menu schema"
```

---

### Task 15: End-to-end testing

**Step 1: Restart Docker containers**

```bash
docker compose down && docker compose up -d
```

**Step 2: Verify in browser**

1. Open menu list — confirm "Todos os itens" row appears at top
2. Click "Todos os itens" — confirm all categories from all menus appear
3. Verify badges show correct menu names on each category
4. Click "Cardápios" dropdown on a category — check/uncheck menus, verify badges update
5. Click a specific menu — verify only linked categories appear
6. Create a new category from "Todos os itens" — verify multi-select works
7. Pause a product in "Todos os itens" — verify it's paused in the public menu
8. Open public menu — verify categories appear correctly per menu

**Step 3: Final commit**

```bash
git add -A
git commit -m "feat: unified 'Todos os itens' category management with N:N menu links"
```
