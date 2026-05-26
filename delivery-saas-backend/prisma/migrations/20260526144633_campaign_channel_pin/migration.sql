-- Allow operator to pin a specific WhatsApp channel (Meta account or
-- Evolution instance) per campaign. Both columns nullable so the
-- existing AUTO mode keeps working unchanged.

ALTER TABLE "MarketingCampaign"
  ADD COLUMN "metaWaAccountId" TEXT,
  ADD COLUMN "evolutionInstanceName" TEXT;

CREATE INDEX "MarketingCampaign_metaWaAccountId_idx"
  ON "MarketingCampaign" ("metaWaAccountId");
CREATE INDEX "MarketingCampaign_evolutionInstanceName_idx"
  ON "MarketingCampaign" ("evolutionInstanceName");

ALTER TABLE "MarketingCampaign"
  ADD CONSTRAINT "MarketingCampaign_metaWaAccountId_fkey"
    FOREIGN KEY ("metaWaAccountId")
    REFERENCES "MetaMessagingAccount"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MarketingCampaign"
  ADD CONSTRAINT "MarketingCampaign_evolutionInstanceName_fkey"
    FOREIGN KEY ("evolutionInstanceName")
    REFERENCES "WhatsAppInstance"("instanceName")
    ON DELETE SET NULL ON UPDATE CASCADE;
