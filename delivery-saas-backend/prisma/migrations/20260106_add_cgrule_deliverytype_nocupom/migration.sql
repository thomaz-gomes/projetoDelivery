-- Migration: add deliveryType and noCoupon columns to CustomerGroupRule

-- For SQLite
PRAGMA foreign_keys = OFF;
BEGIN TRANSACTION;
ALTER TABLE CustomerGroupRule ADD COLUMN deliveryType TEXT NOT NULL DEFAULT 'ANY';
ALTER TABLE CustomerGroupRule ADD COLUMN noCoupon BOOLEAN NOT NULL DEFAULT 0;
COMMIT;
PRAGMA foreign_keys = ON;

-- For Postgres (if used by environment)
-- ALTER TABLE "CustomerGroupRule" ADD COLUMN "deliveryType" text NOT NULL DEFAULT 'ANY';
-- ALTER TABLE "CustomerGroupRule" ADD COLUMN "noCoupon" boolean NOT NULL DEFAULT false;
