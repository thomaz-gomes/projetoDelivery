-- Migration: add slug column to Menu model

PRAGMA foreign_keys=OFF;
BEGIN TRANSACTION;

-- Superseded by 20251118040000_add_menu_slug. No-op for ordering compatibility.
SELECT 1;

COMMIT;
PRAGMA foreign_keys=ON;
