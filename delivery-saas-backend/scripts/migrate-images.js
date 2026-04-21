#!/usr/bin/env node
/**
 * migrate-images.js
 *
 * Standalone migration script that converts all existing product, option, and
 * media images to optimized WebP format using the imageOptimizer utility.
 *
 * Usage:
 *   node scripts/migrate-images.js [--dry-run]
 *
 * Must be run from delivery-saas-backend/ directory (or via Docker exec).
 * Safe to re-run: skips files that are already .webp.
 */

import { prisma } from '../src/prisma.js'
import { optimizeForWeb, preserveHighQuality } from '../src/utils/imageOptimizer.js'
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT = path.resolve(__dirname, '..')

const DRY_RUN = process.argv.includes('--dry-run')

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Convert a DB image URL (absolute or relative) to a local file path.
 * Examples:
 *   /public/uploads/products/abc.jpg          -> <ROOT>/public/uploads/products/abc.jpg
 *   https://host.com/public/uploads/media/x/y -> <ROOT>/public/uploads/media/x/y
 */
function urlToFilePath(urlStr) {
  if (!urlStr) return null
  let rel = urlStr
  // Strip hostname prefix if absolute URL
  try {
    const parsed = new URL(urlStr)
    // If it parsed successfully it's absolute — grab the pathname
    rel = parsed.pathname
  } catch {
    // Not a valid URL — treat as relative path already
  }
  // Ensure it starts with /public/
  if (!rel.startsWith('/public/')) return null
  return path.join(ROOT, rel)
}

/**
 * Convert a local file path back to a relative URL suitable for DB storage.
 * e.g. <ROOT>/public/uploads/products/abc.webp -> /public/uploads/products/abc.webp
 */
function filePathToRelUrl(filePath) {
  const rel = path.relative(ROOT, filePath).replace(/\\/g, '/')
  return '/' + rel
}

/**
 * Replace extension in a file path (keeps the directory and base name).
 */
function replaceExt(filePath, newExt) {
  const dir = path.dirname(filePath)
  const base = path.basename(filePath, path.extname(filePath))
  return path.join(dir, base + newExt)
}

/**
 * Check whether a file exists on disk.
 */
async function fileExists(p) {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

// ── Core conversion ──────────────────────────────────────────────────────────

/**
 * Convert a single image file to WebP (optimized + thumbnail).
 * Optionally also produces an HQ JPEG.
 *
 * Returns { webpPath, thumbPath, hqPath?, webpSize } on success, or null on skip/failure.
 */
async function convertFile(originalPath, { generateHQ = false } = {}) {
  if (!(await fileExists(originalPath))) {
    console.log(`  SKIP (file not found): ${originalPath}`)
    return null
  }

  const ext = path.extname(originalPath).toLowerCase()
  if (ext === '.webp') {
    console.log(`  SKIP (already webp): ${originalPath}`)
    return null
  }

  const buffer = await fs.readFile(originalPath)

  // Generate optimized WebP + thumbnail
  const { optimized, thumbnail } = await optimizeForWeb(buffer)

  const webpPath = replaceExt(originalPath, '.webp')
  const thumbPath = replaceExt(originalPath, '_thumb.webp')

  if (!DRY_RUN) {
    await fs.writeFile(webpPath, optimized)
    await fs.writeFile(thumbPath, thumbnail)
  }

  let hqPath = null
  if (generateHQ) {
    const hqBuffer = await preserveHighQuality(buffer)
    hqPath = replaceExt(originalPath, '_hq.jpg')
    if (!DRY_RUN) {
      await fs.writeFile(hqPath, hqBuffer)
    }
  }

  // Delete original after successful conversion
  if (!DRY_RUN) {
    await fs.unlink(originalPath)
  }

  return { webpPath, thumbPath, hqPath, webpSize: optimized.length }
}

// ── Migrate Products ─────────────────────────────────────────────────────────

async function migrateProducts() {
  console.log('\n=== Migrating Product images ===')
  const products = await prisma.product.findMany({
    where: { image: { not: null } },
    select: { id: true, name: true, image: true },
  })
  console.log(`Found ${products.length} products with images`)

  let converted = 0
  let skipped = 0
  let errors = 0

  for (const product of products) {
    try {
      const filePath = urlToFilePath(product.image)
      if (!filePath) {
        console.log(`  SKIP (unrecognised URL format): ${product.image}`)
        skipped++
        continue
      }

      // Already pointing to .webp in the DB — idempotent skip
      if (product.image.endsWith('.webp')) {
        console.log(`  SKIP (DB already webp): Product "${product.name}" [${product.id}]`)
        skipped++
        continue
      }

      console.log(`  Converting Product "${product.name}" [${product.id}]`)
      const result = await convertFile(filePath)
      if (!result) {
        skipped++
        continue
      }

      const newUrl = filePathToRelUrl(result.webpPath)
      if (!DRY_RUN) {
        await prisma.product.update({
          where: { id: product.id },
          data: { image: newUrl },
        })
      }
      console.log(`    -> ${newUrl} (${(result.webpSize / 1024).toFixed(1)} KB)`)
      converted++
    } catch (err) {
      console.error(`  ERROR on Product "${product.name}" [${product.id}]:`, err.message)
      errors++
    }
  }

  console.log(`Products done: ${converted} converted, ${skipped} skipped, ${errors} errors`)
}

// ── Migrate Options ──────────────────────────────────────────────────────────

async function migrateOptions() {
  console.log('\n=== Migrating Option images ===')
  const options = await prisma.option.findMany({
    where: { image: { not: null } },
    select: { id: true, name: true, image: true },
  })
  console.log(`Found ${options.length} options with images`)

  let converted = 0
  let skipped = 0
  let errors = 0

  for (const option of options) {
    try {
      const filePath = urlToFilePath(option.image)
      if (!filePath) {
        console.log(`  SKIP (unrecognised URL format): ${option.image}`)
        skipped++
        continue
      }

      if (option.image.endsWith('.webp')) {
        console.log(`  SKIP (DB already webp): Option "${option.name}" [${option.id}]`)
        skipped++
        continue
      }

      console.log(`  Converting Option "${option.name}" [${option.id}]`)
      const result = await convertFile(filePath)
      if (!result) {
        skipped++
        continue
      }

      const newUrl = filePathToRelUrl(result.webpPath)
      if (!DRY_RUN) {
        await prisma.option.update({
          where: { id: option.id },
          data: { image: newUrl },
        })
      }
      console.log(`    -> ${newUrl} (${(result.webpSize / 1024).toFixed(1)} KB)`)
      converted++
    } catch (err) {
      console.error(`  ERROR on Option "${option.name}" [${option.id}]:`, err.message)
      errors++
    }
  }

  console.log(`Options done: ${converted} converted, ${skipped} skipped, ${errors} errors`)
}

// ── Migrate Media ────────────────────────────────────────────────────────────

async function migrateMedia() {
  console.log('\n=== Migrating Media images ===')
  const mediaRecords = await prisma.media.findMany({
    select: { id: true, filename: true, url: true, mimeType: true, aiEnhanced: true },
  })
  console.log(`Found ${mediaRecords.length} media records total`)

  let converted = 0
  let skipped = 0
  let errors = 0

  for (const media of mediaRecords) {
    try {
      // Only process image types
      if (!media.mimeType.startsWith('image/')) {
        skipped++
        continue
      }

      const filePath = urlToFilePath(media.url)
      if (!filePath) {
        console.log(`  SKIP (unrecognised URL format): ${media.url}`)
        skipped++
        continue
      }

      if (media.url.endsWith('.webp')) {
        console.log(`  SKIP (DB already webp): Media "${media.filename}" [${media.id}]`)
        skipped++
        continue
      }

      console.log(`  Converting Media "${media.filename}" [${media.id}] (aiEnhanced=${media.aiEnhanced})`)
      const result = await convertFile(filePath, { generateHQ: media.aiEnhanced })
      if (!result) {
        skipped++
        continue
      }

      const newUrl = filePathToRelUrl(result.webpPath)
      const newFilename = path.basename(result.webpPath)
      if (!DRY_RUN) {
        await prisma.media.update({
          where: { id: media.id },
          data: {
            url: newUrl,
            filename: newFilename,
            mimeType: 'image/webp',
            size: result.webpSize,
          },
        })
      }
      console.log(`    -> ${newUrl} (${(result.webpSize / 1024).toFixed(1)} KB)`)
      converted++
    } catch (err) {
      console.error(`  ERROR on Media "${media.filename}" [${media.id}]:`, err.message)
      errors++
    }
  }

  console.log(`Media done: ${converted} converted, ${skipped} skipped, ${errors} errors`)
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('='.repeat(60))
  console.log('Image Migration to WebP')
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no changes)' : 'LIVE'}`)
  console.log(`Root: ${ROOT}`)
  console.log('='.repeat(60))

  await migrateProducts()
  await migrateOptions()
  await migrateMedia()

  console.log('\n' + '='.repeat(60))
  console.log('Migration complete.')
  console.log('='.repeat(60))
}

main()
  .catch((err) => {
    console.error('Fatal error:', err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
