-- Prisma Migrate Migration
-- Name: add-slugs
-- Datetime: 2025-11-18T00:00:00Z

PRAGMA foreign_keys=off;
BEGIN TRANSACTION;

-- Add nullable slug columns
-- Superseded by 20251118041000_add_slugs. No-op for ordering compatibility.
SELECT 1;

COMMIT;
PRAGMA foreign_keys=on;
