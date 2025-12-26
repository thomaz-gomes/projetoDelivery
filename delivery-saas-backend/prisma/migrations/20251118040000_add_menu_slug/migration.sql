-- Migration: add slug column to Menu model (reordered)
PRAGMA foreign_keys=OFF;
BEGIN TRANSACTION;

ALTER TABLE "Menu" ADD COLUMN "slug" TEXT;

-- Create unique index for slug to enforce uniqueness (SQLite)
CREATE UNIQUE INDEX IF NOT EXISTS "Menu_slug_key" ON "Menu" ("slug");

COMMIT;
PRAGMA foreign_keys=ON;
