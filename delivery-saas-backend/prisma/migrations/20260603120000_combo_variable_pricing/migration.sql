-- Combo pricing mode + anchor-slot flag (Variable combo support).
-- Backward-compatible: every existing Combo defaults to FIXED, every existing
-- slot defaults to isPriceAnchor=false. Existing combos behave exactly as
-- before; the new fields only matter once an operator opts a product into
-- VARIABLE mode via the UI.

CREATE TYPE "ComboPricingMode" AS ENUM ('FIXED', 'VARIABLE');

ALTER TABLE "Combo"
  ADD COLUMN "pricingMode" "ComboPricingMode" NOT NULL DEFAULT 'FIXED';

ALTER TABLE "ComboSlot"
  ADD COLUMN "isPriceAnchor" BOOLEAN NOT NULL DEFAULT false;
