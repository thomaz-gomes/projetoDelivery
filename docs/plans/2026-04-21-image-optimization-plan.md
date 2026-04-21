# Image Optimization Pipeline — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Optimize all product/menu images using Sharp to reduce storage (~85%) and improve loading speed, while preserving high-quality JPEG downloads for AI Studio images.

**Architecture:** A central `imageOptimizer.js` utility wraps Sharp to produce WebP optimized (800px), thumbnails (200px), and optionally HQ JPEG for AI images. All upload routes funnel through this utility before writing to disk. A migration script batch-converts existing images.

**Tech Stack:** Sharp (already installed v0.34.5), Express.js, Prisma, Vue 3

---

### Task 1: Create imageOptimizer.js utility

**Files:**
- Create: `delivery-saas-backend/src/utils/imageOptimizer.js`

**Step 1: Create the optimizer module**

```javascript
const sharp = require('sharp')

/**
 * Optimize an image buffer for web display + generate thumbnail.
 * @param {Buffer} buffer - Raw image buffer
 * @returns {Promise<{ optimized: Buffer, thumbnail: Buffer }>}
 */
async function optimizeForWeb(buffer) {
  const optimized = await sharp(buffer)
    .resize({ width: 800, withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer()

  const thumbnail = await sharp(buffer)
    .resize({ width: 200, withoutEnlargement: true })
    .webp({ quality: 60 })
    .toBuffer()

  return { optimized, thumbnail }
}

/**
 * Preserve high-quality JPEG for social media download (AI Studio only).
 * No resize — keeps original dimensions. No upscale.
 * @param {Buffer} buffer - Raw image buffer
 * @returns {Promise<Buffer>}
 */
async function preserveHighQuality(buffer) {
  return sharp(buffer)
    .jpeg({ quality: 92 })
    .toBuffer()
}

module.exports = { optimizeForWeb, preserveHighQuality }
```

**Step 2: Verify Sharp works in the Docker container**

Run: `docker compose exec backend node -e "const sharp = require('sharp'); sharp(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==','base64')).webp().toBuffer().then(b => console.log('OK', b.length)).catch(e => console.error('FAIL', e.message))"`

Expected: `OK <number>` — confirms Sharp + WebP work inside the container.

**Step 3: Commit**

```bash
git add delivery-saas-backend/src/utils/imageOptimizer.js
git commit -m "feat(images): add imageOptimizer utility with Sharp WebP pipeline"
```

---

### Task 2: Integrate optimizer into POST /media route

**Files:**
- Modify: `delivery-saas-backend/src/routes/media.js:37-59`

**Step 1: Add optimizer import at top of file**

After the existing requires (~line 4), add:
```javascript
const { optimizeForWeb } = require('../utils/imageOptimizer')
```

**Step 2: Replace direct buffer write with optimized pipeline**

Current code (lines ~52-59) saves `buf` directly:
```javascript
const filePath = path.join(dir, safeName)
await fs.promises.writeFile(filePath, buf)
```

Replace the save block so that:
1. Run `optimizeForWeb(buf)`
2. Change `safeName` extension to `.webp`
3. Save optimized as `{id}.webp`
4. Save thumbnail as `{id}_thumb.webp`
5. Update `url` and `size` to reflect the WebP file

```javascript
const { optimized, thumbnail } = await optimizeForWeb(buf)
const webpName = safeName.replace(/\.\w+$/, '.webp')
const thumbName = safeName.replace(/\.\w+$/, '_thumb.webp')
await fs.promises.writeFile(path.join(dir, webpName), optimized)
await fs.promises.writeFile(path.join(dir, thumbName), thumbnail)
const url = `/public/uploads/media/${companyId}/${webpName}`
```

Update the `prisma.media.create` call to use `optimized.length` for `size` and `'image/webp'` for `mimeType`.

**Step 3: Test manually**

Upload an image through Media Library in the frontend. Verify:
- File saved as `.webp` in `/public/uploads/media/{companyId}/`
- Thumbnail `_thumb.webp` exists alongside it
- Image displays correctly in the Media Library grid

**Step 4: Commit**

```bash
git add delivery-saas-backend/src/routes/media.js
git commit -m "feat(images): optimize media uploads to WebP with thumbnails"
```

---

### Task 3: Integrate optimizer into product image upload

**Files:**
- Modify: `delivery-saas-backend/src/routes/menu.js:685-743`

**Step 1: Add optimizer import at top of file**

```javascript
const { optimizeForWeb } = require('../utils/imageOptimizer')
```

**Step 2: Replace direct buffer write**

Current code (~lines 708-720) saves `buffer` directly as `{id}.{ext}`. Change to:

1. Run `optimizeForWeb(buffer)`
2. Save as `{id}.webp` and `{id}_thumb.webp`
3. Update `publicUrl` to use `.webp` extension

```javascript
const { optimized, thumbnail } = await optimizeForWeb(buffer)
const outName = `${id}.webp`
const thumbName = `${id}_thumb.webp`
await fs.promises.writeFile(path.join(uploadsDir, outName), optimized)
await fs.promises.writeFile(path.join(uploadsDir, thumbName), thumbnail)
const publicUrl = `/public/uploads/products/${outName}`
```

Note: The `publicUrl` stored in `Product.image` should be the relative path (not absolute with protocol/host) for consistency. Check if other routes already use relative paths and align.

**Step 3: Test manually**

Upload a product image via ProductForm. Verify `.webp` and `_thumb.webp` in `/public/uploads/products/`.

**Step 4: Commit**

```bash
git add delivery-saas-backend/src/routes/menu.js
git commit -m "feat(images): optimize product image uploads to WebP"
```

---

### Task 4: Integrate optimizer into option image upload

**Files:**
- Modify: `delivery-saas-backend/src/routes/menuOptions.js:306-358`

**Step 1: Add optimizer import**

```javascript
const { optimizeForWeb } = require('../utils/imageOptimizer')
```

**Step 2: Replace direct buffer write**

Same pattern as Task 3. Save `{id}.webp` + `{id}_thumb.webp` to `/public/uploads/options/`.

Note: PublicMenu.vue already has an `optionThumbUrl()` helper (~line 2349) that rewrites to `/options/thumbs/`. Either:
- (a) Save thumbnails to `/public/uploads/options/thumbs/{id}.webp` to match existing frontend logic, OR
- (b) Update the frontend helper to use `_thumb.webp` naming convention

Option (a) is simpler — check if the `thumbs/` subdirectory pattern is already established and match it.

**Step 3: Test and commit**

```bash
git add delivery-saas-backend/src/routes/menuOptions.js
git commit -m "feat(images): optimize option image uploads to WebP"
```

---

### Task 5: Integrate optimizer into AI Studio routes (WebP + HQ JPEG)

**Files:**
- Modify: `delivery-saas-backend/src/routes/aiStudio.js:225-233` (enhance), `395-430` (generate), `772-826` (generate-pack)

**Step 1: Add optimizer import**

```javascript
const { optimizeForWeb, preserveHighQuality } = require('../utils/imageOptimizer')
```

**Step 2: Update enhance endpoint save block (~lines 225-233)**

After receiving `generatedBuffer` from Gemini, replace the single file write with:

```javascript
const { optimized, thumbnail } = await optimizeForWeb(generatedBuffer)
const hqBuffer = await preserveHighQuality(generatedBuffer)

const newId = randomUUID()
const dir = path.join(process.cwd(), 'public', 'uploads', 'media', companyId)
await fs.promises.mkdir(dir, { recursive: true })

await Promise.all([
  fs.promises.writeFile(path.join(dir, `${newId}.webp`), optimized),
  fs.promises.writeFile(path.join(dir, `${newId}_thumb.webp`), thumbnail),
  fs.promises.writeFile(path.join(dir, `${newId}_hq.jpg`), hqBuffer),
])

const newUrl = `/public/uploads/media/${companyId}/${newId}.webp`
```

Update the `prisma.media.create` call: `mimeType: 'image/webp'`, `size: optimized.length`, `aiEnhanced: true`.

**Step 3: Apply same pattern to generate endpoint (~lines 395-430)**

Same triple-write: `.webp`, `_thumb.webp`, `_hq.jpg`.

**Step 4: Apply same pattern to generate-pack endpoint (~lines 772-826)**

This runs in a `Promise.all` loop generating multiple images. Inside each iteration, apply the same triple-write pattern.

**Step 5: Test manually**

Use AI Studio to enhance a product image. Verify three files appear in `/public/uploads/media/{companyId}/`:
- `{id}.webp` — optimized for web
- `{id}_thumb.webp` — thumbnail
- `{id}_hq.jpg` — high-quality for download

**Step 6: Commit**

```bash
git add delivery-saas-backend/src/routes/aiStudio.js
git commit -m "feat(images): optimize AI Studio outputs — WebP display + JPEG HQ download"
```

---

### Task 6: Integrate optimizer into menu import

**Files:**
- Modify: `delivery-saas-backend/src/routes/menuImport.js:790-835`

**Step 1: Add optimizer import**

```javascript
const { optimizeForWeb } = require('../utils/imageOptimizer')
```

**Step 2: Update downloadAndSaveProductImage**

After downloading the image (`resp.data` buffer, ~line 807), run through optimizer before writing:

```javascript
const { optimized, thumbnail } = await optimizeForWeb(resp.data)
const fileName = `${productId}.webp`
const thumbName = `${productId}_thumb.webp`
fs.writeFileSync(filePath, optimized)        // consider switching to async
fs.writeFileSync(thumbFilePath, thumbnail)
const imagePublicUrl = `${baseUrl}/public/uploads/products/${fileName}`
```

Also update the `prisma.media.create` call with `mimeType: 'image/webp'` and `size: optimized.length`.

**Step 3: Commit**

```bash
git add delivery-saas-backend/src/routes/menuImport.js
git commit -m "feat(images): optimize imported menu images to WebP"
```

---

### Task 7: Add cache headers for static image serving

**Files:**
- Modify: `delivery-saas-backend/src/index.js:327-328`

**Step 1: Add Cache-Control to express.static**

Current:
```javascript
app.use('/public', express.static(publicDir))
```

Change to:
```javascript
app.use('/public', express.static(publicDir, {
  maxAge: '365d',
  immutable: true,
}))
```

Since filenames include UUIDs, cache busting happens naturally when images are re-uploaded.

**Step 2: Commit**

```bash
git add delivery-saas-backend/src/index.js
git commit -m "feat(images): add aggressive cache headers for static uploads"
```

---

### Task 8: Add frontend helpers — thumbUrl and hqDownloadUrl

**Files:**
- Modify: `delivery-saas-frontend/src/utils/assetUrl.js`

**Step 1: Add thumb and HQ URL helpers**

Append to the existing file:

```javascript
/**
 * Convert an image URL to its thumbnail variant.
 * /public/uploads/products/abc.webp -> /public/uploads/products/abc_thumb.webp
 */
export function thumbUrl(url) {
  if (!url) return url
  return url.replace(/(\.\w+)$/, '_thumb.webp')
}

/**
 * Convert an AI Studio image URL to its HQ JPEG download variant.
 * /public/uploads/media/cid/abc.webp -> /public/uploads/media/cid/abc_hq.jpg
 */
export function hqDownloadUrl(url) {
  if (!url) return url
  return url.replace(/(\.\w+)$/, '_hq.jpg')
}
```

**Step 2: Commit**

```bash
git add delivery-saas-frontend/src/utils/assetUrl.js
git commit -m "feat(images): add thumbUrl and hqDownloadUrl frontend helpers"
```

---

### Task 9: Update PublicMenu.vue to use thumbnails

**Files:**
- Modify: `delivery-saas-frontend/src/views/PublicMenu.vue`

**Step 1: Import thumbUrl**

Add to existing imports (~line 1047):
```javascript
import { assetUrl, thumbUrl } from '../utils/assetUrl.js'
```

**Step 2: Use thumbnails in listing contexts**

Product grid/list images (lines ~201, 273) — where multiple products are shown:
```html
<img v-if="p.image" :src="assetUrl(thumbUrl(p.image))" loading="lazy" />
```

Cart sidebar items (line ~311):
```html
<img v-if="it.image" :src="assetUrl(thumbUrl(it.image))" class="cart-sidebar-item-img" alt="" />
```

Keep the product detail modal (line ~380) using the full optimized image:
```html
<img :src="assetUrl(selectedProduct.image)" alt="Imagem do produto" class="modal-product-img" />
```

**Step 3: Test the public menu**

Open a store's public menu. Verify:
- Product listing loads thumbnail images (small, fast)
- Clicking a product shows the full-quality optimized image
- Cart sidebar shows thumbnails
- No broken images

**Step 4: Commit**

```bash
git add delivery-saas-frontend/src/views/PublicMenu.vue
git commit -m "feat(images): use thumbnails in public menu listings for faster load"
```

---

### Task 10: Add "Download for Social Media" button for AI Studio images

**Files:**
- Modify: The component that displays AI Studio results or the Media Library where AI images appear

**Step 1: Identify the right component**

Check `MediaLibraryModal.vue` and any AI Studio result display components. Add a download button that appears when the image is AI-enhanced (`aiEnhanced === true`).

**Step 2: Add download button**

```html
<a v-if="media.aiEnhanced"
   :href="assetUrl(hqDownloadUrl(media.url))"
   :download="`${media.filename || 'image'}.jpg`"
   class="btn btn-sm btn-outline-primary mt-1"
   title="Baixar para redes sociais (JPEG alta qualidade)">
  <i class="bi bi-download"></i> Baixar HD
</a>
```

Import `hqDownloadUrl` from `assetUrl.js`.

**Step 3: Test**

Open Media Library, find an AI-enhanced image. Click "Baixar HD". Verify it downloads a `.jpg` file.

**Step 4: Commit**

```bash
git add delivery-saas-frontend/src/components/MediaLibrary/MediaLibraryModal.vue
git commit -m "feat(images): add HD download button for AI Studio images"
```

---

### Task 11: Write migration script for existing images

**Files:**
- Create: `delivery-saas-backend/scripts/migrate-images.js`

**Step 1: Create the migration script**

```javascript
const fs = require('fs')
const path = require('path')
const { PrismaClient } = require('@prisma/client')
const { optimizeForWeb, preserveHighQuality } = require('../src/utils/imageOptimizer')

const prisma = new PrismaClient()

async function migrateProducts() {
  const products = await prisma.product.findMany({
    where: { image: { not: null } },
    select: { id: true, image: true },
  })

  console.log(`Found ${products.length} products with images`)
  let migrated = 0, skipped = 0, errors = 0

  for (const p of products) {
    try {
      // Extract file path from URL (handle both absolute and relative URLs)
      const urlPath = p.image.replace(/^https?:\/\/[^/]+/, '')
      const filePath = path.join(process.cwd(), urlPath)

      if (!fs.existsSync(filePath)) { skipped++; continue }
      if (filePath.endsWith('.webp')) { skipped++; continue }

      const buffer = fs.readFileSync(filePath)
      const { optimized, thumbnail } = await optimizeForWeb(buffer)

      const dir = path.dirname(filePath)
      const baseName = path.basename(filePath, path.extname(filePath))
      const webpPath = path.join(dir, `${baseName}.webp`)
      const thumbPath = path.join(dir, `${baseName}_thumb.webp`)

      fs.writeFileSync(webpPath, optimized)
      fs.writeFileSync(thumbPath, thumbnail)

      // Update DB reference
      const newUrl = urlPath.replace(/\.\w+$/, '.webp')
      await prisma.product.update({
        where: { id: p.id },
        data: { image: newUrl },
      })

      // Delete original
      fs.unlinkSync(filePath)
      migrated++
      if (migrated % 20 === 0) console.log(`  Products: ${migrated}/${products.length}`)
    } catch (err) {
      console.error(`  Error migrating product ${p.id}:`, err.message)
      errors++
    }
  }

  console.log(`Products done: ${migrated} migrated, ${skipped} skipped, ${errors} errors`)
}

async function migrateMedia() {
  const medias = await prisma.media.findMany({
    select: { id: true, url: true, aiEnhanced: true, companyId: true },
  })

  console.log(`Found ${medias.length} media records`)
  let migrated = 0, skipped = 0, errors = 0

  for (const m of medias) {
    try {
      const urlPath = m.url.replace(/^https?:\/\/[^/]+/, '')
      const filePath = path.join(process.cwd(), urlPath)

      if (!fs.existsSync(filePath)) { skipped++; continue }
      if (filePath.endsWith('.webp')) { skipped++; continue }

      const buffer = fs.readFileSync(filePath)
      const { optimized, thumbnail } = await optimizeForWeb(buffer)

      const dir = path.dirname(filePath)
      const baseName = path.basename(filePath, path.extname(filePath))

      fs.writeFileSync(path.join(dir, `${baseName}.webp`), optimized)
      fs.writeFileSync(path.join(dir, `${baseName}_thumb.webp`), thumbnail)

      // AI-enhanced images also get HQ JPEG
      if (m.aiEnhanced) {
        const hq = await preserveHighQuality(buffer)
        fs.writeFileSync(path.join(dir, `${baseName}_hq.jpg`), hq)
      }

      const newUrl = urlPath.replace(/\.\w+$/, '.webp')
      await prisma.media.update({
        where: { id: m.id },
        data: { url: newUrl, mimeType: 'image/webp', size: optimized.length },
      })

      // Delete original
      fs.unlinkSync(filePath)
      migrated++
      if (migrated % 20 === 0) console.log(`  Media: ${migrated}/${medias.length}`)
    } catch (err) {
      console.error(`  Error migrating media ${m.id}:`, err.message)
      errors++
    }
  }

  console.log(`Media done: ${migrated} migrated, ${skipped} skipped, ${errors} errors`)
}

async function main() {
  console.log('=== Image Migration ===')
  console.log('Starting product image migration...')
  await migrateProducts()
  console.log('Starting media library migration...')
  await migrateMedia()
  await prisma.$disconnect()
  console.log('=== Migration complete ===')
}

main().catch(err => {
  console.error('Migration failed:', err)
  process.exit(1)
})
```

**Step 2: Test locally**

Run: `docker compose exec backend node scripts/migrate-images.js`

Verify:
- WebP + thumbnail files created
- Original files deleted
- DB references updated to `.webp`
- AI-enhanced images have `_hq.jpg`

**Step 3: Commit**

```bash
git add delivery-saas-backend/scripts/migrate-images.js
git commit -m "feat(images): add migration script for existing images to WebP"
```

---

### Task 12: End-to-end testing

**Step 1: Test all upload flows**

1. Upload product image via ProductForm → verify `.webp` + `_thumb.webp`
2. Upload via Media Library → verify `.webp` + `_thumb.webp`
3. AI Studio enhance → verify `.webp` + `_thumb.webp` + `_hq.jpg`
4. AI Studio generate → verify `.webp` + `_thumb.webp` + `_hq.jpg`
5. Import menu with images → verify `.webp` + `_thumb.webp`

**Step 2: Test frontend display**

1. Open public menu → product listings show thumbnails (check network tab: small WebP files)
2. Click product → modal shows full optimized WebP
3. Open Media Library → AI images show "Baixar HD" button → downloads JPEG

**Step 3: Check storage savings**

```bash
docker compose exec backend du -sh public/uploads/
```

Compare before/after migration sizes.

**Step 4: Final commit**

```bash
git commit -m "feat(images): complete image optimization pipeline"
```
