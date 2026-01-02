-- Add technicalSheetId columns to Product and Option
ALTER TABLE "Product" ADD COLUMN "technicalSheetId" TEXT;
ALTER TABLE "Option" ADD COLUMN "technicalSheetId" TEXT;

CREATE INDEX IF NOT EXISTS "idx_product_technical_sheet" ON "Product"("technicalSheetId");
CREATE INDEX IF NOT EXISTS "idx_option_technical_sheet" ON "Option"("technicalSheetId");
