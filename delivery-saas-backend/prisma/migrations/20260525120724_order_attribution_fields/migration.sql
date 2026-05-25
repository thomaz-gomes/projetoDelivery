-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "attributedCampaignId" TEXT,
ADD COLUMN     "attributedMessageId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Order_attributedMessageId_key" ON "Order"("attributedMessageId");

-- CreateIndex
CREATE INDEX "Order_attributedCampaignId_idx" ON "Order"("attributedCampaignId");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_attributedCampaignId_fkey" FOREIGN KEY ("attributedCampaignId") REFERENCES "MarketingCampaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
