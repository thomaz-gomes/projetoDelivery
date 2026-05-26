-- Fix marketing module: add Company FKs/relations, decimal precision,
-- proper relations for createdByUserId and segmentMenuId, plus updatedAt
-- on MarketingTemplateLibrary. Addresses code-review issues on commit
-- 9a74ceab (I-1, I-3, I-4, I-5, M-2, M-3, M-4).

-- ---------------------------------------------------------------------------
-- M-2: MarketingCampaignRun.companyId
-- Add as nullable first, backfill from parent campaign, then enforce NOT NULL.
-- This is safe whether the table has 0 rows (prod) or N rows (defensive).
-- ---------------------------------------------------------------------------
ALTER TABLE "MarketingCampaignRun" ADD COLUMN "companyId" TEXT;

UPDATE "MarketingCampaignRun" r
SET "companyId" = c."companyId"
FROM "MarketingCampaign" c
WHERE r."campaignId" = c."id"
  AND r."companyId" IS NULL;

ALTER TABLE "MarketingCampaignRun" ALTER COLUMN "companyId" SET NOT NULL;

-- ---------------------------------------------------------------------------
-- I-1: convertedValue precision (Decimal(65,30) -> Decimal(12,2))
-- ---------------------------------------------------------------------------
ALTER TABLE "MarketingMessage" ALTER COLUMN "convertedValue" SET DATA TYPE DECIMAL(12,2);

-- ---------------------------------------------------------------------------
-- M-3: MarketingTemplateLibrary.updatedAt
-- Add with DEFAULT CURRENT_TIMESTAMP to backfill existing rows safely
-- (table is empty in prod but defensive), then drop the default since
-- @updatedAt is application-managed by Prisma (no SQL default).
-- ---------------------------------------------------------------------------
ALTER TABLE "MarketingTemplateLibrary"
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "MarketingTemplateLibrary" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- ---------------------------------------------------------------------------
-- I-5: segmentMenuId index (filtered field)
-- ---------------------------------------------------------------------------
CREATE INDEX "MarketingCampaign_segmentMenuId_idx" ON "MarketingCampaign"("segmentMenuId");

-- ---------------------------------------------------------------------------
-- M-2: index for new MarketingCampaignRun.companyId
-- ---------------------------------------------------------------------------
CREATE INDEX "MarketingCampaignRun_companyId_idx" ON "MarketingCampaignRun"("companyId");

-- ---------------------------------------------------------------------------
-- I-3: index for MarketingMessage.companyId (matches denormalised pattern)
-- ---------------------------------------------------------------------------
CREATE INDEX "MarketingMessage_companyId_idx" ON "MarketingMessage"("companyId");

-- ---------------------------------------------------------------------------
-- I-3: MarketingCampaign.companyId FK to Company
-- ---------------------------------------------------------------------------
ALTER TABLE "MarketingCampaign" ADD CONSTRAINT "MarketingCampaign_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- I-5: MarketingCampaign.segmentMenuId FK to Menu (SET NULL on delete)
-- ---------------------------------------------------------------------------
ALTER TABLE "MarketingCampaign" ADD CONSTRAINT "MarketingCampaign_segmentMenuId_fkey"
  FOREIGN KEY ("segmentMenuId") REFERENCES "Menu"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- I-4: MarketingCampaign.createdByUserId FK to User (SET NULL on delete)
-- Preserves audit history if the user is deleted.
-- ---------------------------------------------------------------------------
ALTER TABLE "MarketingCampaign" ADD CONSTRAINT "MarketingCampaign_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- M-2: MarketingCampaignRun.companyId FK to Company
-- ---------------------------------------------------------------------------
ALTER TABLE "MarketingCampaignRun" ADD CONSTRAINT "MarketingCampaignRun_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- I-3: MarketingMessage.companyId FK to Company
-- ---------------------------------------------------------------------------
ALTER TABLE "MarketingMessage" ADD CONSTRAINT "MarketingMessage_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
