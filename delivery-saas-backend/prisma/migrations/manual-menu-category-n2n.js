import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const categories = await prisma.$queryRaw`
    SELECT id, "menuId", position FROM "MenuCategory" WHERE "menuId" IS NOT NULL
  `
  console.log(`Found ${categories.length} categories with menuId to migrate`)

  for (const cat of categories) {
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
