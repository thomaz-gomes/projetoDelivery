-- Prisma Migrate Migration
-- Name: add-slugs
-- Datetime: 2025-11-18T00:00:00Z

PRAGMA foreign_keys=off;
BEGIN TRANSACTION;

-- Add nullable slug columns
ALTER TABLE "Company" ADD COLUMN "slug" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Company_slug_key" ON "Company"("slug");

ALTER TABLE "Store" ADD COLUMN "slug" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Store_slug_key" ON "Store"("slug");

COMMIT;
PRAGMA foreign_keys=on;
