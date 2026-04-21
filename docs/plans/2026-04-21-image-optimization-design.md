# Image Optimization Pipeline — Design Document

**Date:** 2026-04-21
**Goal:** Optimize image storage and loading speed for menus, covering all upload sources.

## Context

- Images stored locally on VPS filesystem (`/public/uploads/`)
- Sharp is installed (v0.34.5) but **not used** — images saved at original size/format
- No thumbnails, no server-side compression, no CDN
- AI Studio images are the premium asset — lojistas download them for social media

## Strategy by Image Source

| Source | Menu Display | Social Download | Thumbnail |
|---|---|---|---|
| Manual upload (product/option) | WebP 80% max 800px | — | WebP 60% 200px |
| AI Studio (enhance/generate/pack) | WebP 80% max 800px | JPEG 92% original size (min 1080px preferred, no upscale) | WebP 60% 200px |
| External menu import | WebP 80% max 800px | — | WebP 60% 200px |

## File Naming Convention

```
/public/uploads/products/
  abc123.webp          <- optimized (menu display)
  abc123_thumb.webp    <- thumbnail (listings, cart)
  abc123_hq.jpg        <- AI Studio only (download for social media)
```

Same pattern for `/public/uploads/media/{companyId}/` and `/public/uploads/options/`.

## Components

### 1. `src/utils/imageOptimizer.js` (new)

Central Sharp module with three functions:

- **`optimizeForWeb(buffer, options?)`** — returns `{ optimized: Buffer, thumbnail: Buffer }` in WebP
  - optimized: max 800px width, WebP quality 80
  - thumbnail: 200px width, WebP quality 60
- **`preserveHighQuality(buffer)`** — returns JPEG 92% at original resolution (no upscale, no downscale)
  - Only used for AI Studio images
- **`migrateExistingImage(filePath, isAiEnhanced)`** — reprocesses an existing image on disk
  - Generates WebP + thumbnail
  - If `isAiEnhanced`, also generates HQ JPEG

### 2. Route Changes

All existing upload routes call the optimizer before saving:

- **`media.js`** — `POST /media` passes buffer through `optimizeForWeb()` before `fs.writeFile()`
- **`menu.js`** — `POST /menu/products/:id/image` same pipeline
- **`menuOptions.js`** — `POST /menu/options/:id/image` same pipeline
- **`aiStudio.js`** — enhance/generate/pack routes call both `optimizeForWeb()` + `preserveHighQuality()`
- **`menuImport.js`** — `downloadAndSaveProductImage()` passes downloaded buffer through optimizer

### 3. Database (Prisma)

No schema changes needed. Use naming convention (`_thumb.webp`, `_hq.jpg`) derived from the base URL already stored in `Product.image` and `Media.url`. This avoids a migration and keeps it simple.

Update `Product.image` and `Media.url` references to point to `.webp` files instead of `.jpg/.png`.

### 4. Frontend Changes

**`assetUrl.js`** — add helper functions:
- `thumbUrl(url)` — converts `abc123.webp` -> `abc123_thumb.webp`
- `hqDownloadUrl(url)` — converts `abc123.webp` -> `abc123_hq.jpg`

**PublicMenu.vue:**
- Product listings/cart use `thumbUrl()` for images
- Product detail modal uses the regular optimized URL
- Lazy loading already in place

**AI Studio UI / Media Library:**
- "Download for social media" button on AI-generated images
- Uses `hqDownloadUrl()` to point to the JPEG HQ version

### 5. Migration Script

`scripts/migrate-images.js` (standalone, run once):

1. Query all `Product` records with non-null `image`
2. Query all `Media` records
3. For each image file:
   - Read original from disk
   - Generate WebP optimized + thumbnail via `optimizeForWeb()`
   - If `Media.aiEnhanced === true`, also generate HQ JPEG via `preserveHighQuality()`
   - Save new files, delete original
   - Update `Product.image` / `Media.url` in database to `.webp` path
4. Process in batches of 20 to avoid memory spikes
5. Log progress and errors
6. Can be re-run safely (skips already-converted `.webp` files)

### 6. Static Serving & Cache Headers

Add `Cache-Control` headers for image responses:
- `/public/uploads/**` — `Cache-Control: public, max-age=31536000, immutable`
- Since filenames include UUIDs, cache busting happens naturally on re-upload

## Estimated Reduction

Typical food product photo (~500KB JPEG):
- **WebP 800px:** ~40-80KB (85% reduction)
- **Thumbnail 200px:** ~5-15KB
- **HQ JPEG (AI Studio):** ~300KB at original resolution

## Decisions

- **No upscale:** if AI Studio returns < 1080px, save as-is (no quality degradation)
- **No CDN:** serve directly from VPS, rely on cache headers
- **Convention over schema:** derive thumb/HQ paths from base URL instead of extra DB columns
- **Discard originals:** after optimization, original files are removed (except AI Studio HQ)
