-- Migration: add reference and observation columns to CustomerAddress

-- For SQLite
PRAGMA foreign_keys = OFF;
BEGIN TRANSACTION;
ALTER TABLE CustomerAddress ADD COLUMN reference TEXT;
ALTER TABLE CustomerAddress ADD COLUMN observation TEXT;
COMMIT;
PRAGMA foreign_keys = ON;

-- For Postgres (if used by environment)
-- Note: When running against Postgres, execute these commands instead or let prisma migrate handle it.
-- ALTER TABLE "CustomerAddress" ADD COLUMN reference text;
-- ALTER TABLE "CustomerAddress" ADD COLUMN observation text;
