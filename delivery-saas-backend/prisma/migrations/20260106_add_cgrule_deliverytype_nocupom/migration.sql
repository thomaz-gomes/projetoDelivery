-- Migration: add deliveryType and noCoupon columns to CustomerGroupRule

-- Safe migration for dev: ensure the CustomerGroupRule table exists (create if missing)
-- and include the new columns by creating the table schema with those columns.

-- For SQLite
PRAGMA foreign_keys = OFF;
BEGIN TRANSACTION;

-- Create table if it doesn't exist (includes the new columns deliveryType and noCoupon)
CREATE TABLE IF NOT EXISTS "CustomerGroupRule" (
	"id" TEXT NOT NULL PRIMARY KEY,
	"groupId" TEXT NOT NULL,
	"type" TEXT NOT NULL,
	"target" TEXT NOT NULL,
	"targetRef" TEXT,
	"value" DECIMAL NOT NULL,
	"minSubtotal" DECIMAL,
	"schedule" TEXT,
	"deliveryType" TEXT NOT NULL DEFAULT 'ANY',
	"noCoupon" BOOLEAN NOT NULL DEFAULT 0,
	"active" BOOLEAN NOT NULL DEFAULT 1,
	"createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	"updatedAt" DATETIME NOT NULL,
	CONSTRAINT "CustomerGroupRule_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "CustomerGroup" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

COMMIT;
PRAGMA foreign_keys = ON;

-- For Postgres (if used by environment)
-- CREATE TABLE IF NOT EXISTS "CustomerGroupRule" (
--   "id" text PRIMARY KEY,
--   "groupId" text NOT NULL,
--   "type" text NOT NULL,
--   "target" text NOT NULL,
--   "targetRef" text,
--   "value" decimal NOT NULL,
--   "minSubtotal" decimal,
--   "schedule" jsonb,
--   "deliveryType" text NOT NULL DEFAULT 'ANY',
--   "noCoupon" boolean NOT NULL DEFAULT false,
--   "active" boolean NOT NULL DEFAULT true,
--   "createdAt" timestamptz NOT NULL DEFAULT now(),
--   "updatedAt" timestamptz NOT NULL
-- );
