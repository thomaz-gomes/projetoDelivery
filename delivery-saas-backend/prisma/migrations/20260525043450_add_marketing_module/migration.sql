-- CreateEnum
CREATE TYPE "MarketingScheduleType" AS ENUM ('ONE_SHOT', 'RECURRING', 'TRIGGER');

-- CreateEnum
CREATE TYPE "MarketingCampaignStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'RUNNING', 'PAUSED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MarketingChannel" AS ENUM ('META_WA', 'EVOLUTION_WA', 'AUTO');

-- CreateEnum
CREATE TYPE "MarketingAttributionScope" AS ENUM ('menu', 'company');

-- CreateEnum
CREATE TYPE "MarketingMessageStatus" AS ENUM ('QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'OPTED_OUT');

-- CreateTable
CREATE TABLE "MarketingSegment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "ruleJson" JSONB NOT NULL,
    "estimatedSize" INTEGER,
    "lastEvaluatedAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingSegment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingCampaign" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "segmentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scheduleType" "MarketingScheduleType" NOT NULL,
    "scheduledFor" TIMESTAMP(3),
    "cronExpression" TEXT,
    "triggerType" TEXT,
    "triggerParams" JSONB,
    "channel" "MarketingChannel" NOT NULL DEFAULT 'AUTO',
    "templateId" TEXT,
    "freeText" TEXT,
    "templateVariableMap" JSONB,
    "conversionWindowHours" INTEGER NOT NULL DEFAULT 48,
    "conversionStatuses" TEXT[] DEFAULT ARRAY['EM_PREPARO', 'PRONTO', 'SAIU_PARA_ENTREGA', 'CONFIRMACAO_PAGAMENTO', 'CONCLUIDO']::TEXT[],
    "attributionScope" "MarketingAttributionScope" NOT NULL DEFAULT 'menu',
    "segmentMenuId" TEXT,
    "couponId" TEXT,
    "status" "MarketingCampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT,

    CONSTRAINT "MarketingCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingCampaignRun" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "totalQueued" INTEGER NOT NULL DEFAULT 0,
    "totalSent" INTEGER NOT NULL DEFAULT 0,
    "totalFailed" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,

    CONSTRAINT "MarketingCampaignRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingMessage" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "campaignRunId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "providerUsed" "MarketingChannel" NOT NULL,
    "providerAccountId" TEXT,
    "instanceName" TEXT,
    "externalId" TEXT,
    "status" "MarketingMessageStatus" NOT NULL DEFAULT 'QUEUED',
    "scheduledFor" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "convertedOrderId" TEXT,
    "convertedAt" TIMESTAMP(3),
    "convertedValue" DECIMAL(65,30),
    "attributionLockedAt" TIMESTAMP(3),
    "excludedFromAttribution" BOOLEAN NOT NULL DEFAULT false,
    "attributionSignal" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingSendQueue" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "lockUntil" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingSendQueue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingTemplateLibrary" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'pt_BR',
    "description" TEXT NOT NULL,
    "useCase" TEXT NOT NULL,
    "bodyTemplate" TEXT NOT NULL,
    "variableHints" JSONB NOT NULL,
    "buttons" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingTemplateLibrary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarketingSegment_companyId_idx" ON "MarketingSegment"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingSegment_companyId_name_key" ON "MarketingSegment"("companyId", "name");

-- CreateIndex
CREATE INDEX "MarketingCampaign_companyId_status_idx" ON "MarketingCampaign"("companyId", "status");

-- CreateIndex
CREATE INDEX "MarketingCampaign_scheduleType_status_scheduledFor_idx" ON "MarketingCampaign"("scheduleType", "status", "scheduledFor");

-- CreateIndex
CREATE INDEX "MarketingCampaignRun_campaignId_startedAt_idx" ON "MarketingCampaignRun"("campaignId", "startedAt");

-- CreateIndex
CREATE INDEX "MarketingMessage_customerId_sentAt_idx" ON "MarketingMessage"("customerId", "sentAt" DESC);

-- CreateIndex
CREATE INDEX "MarketingMessage_campaignId_status_idx" ON "MarketingMessage"("campaignId", "status");

-- CreateIndex
CREATE INDEX "MarketingMessage_sentAt_attributionLockedAt_idx" ON "MarketingMessage"("sentAt", "attributionLockedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingMessage_campaignRunId_customerId_key" ON "MarketingMessage"("campaignRunId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingSendQueue_messageId_key" ON "MarketingSendQueue"("messageId");

-- CreateIndex
CREATE INDEX "MarketingSendQueue_scheduledFor_lockUntil_idx" ON "MarketingSendQueue"("scheduledFor", "lockUntil");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingTemplateLibrary_name_key" ON "MarketingTemplateLibrary"("name");

-- AddForeignKey
ALTER TABLE "MarketingSegment" ADD CONSTRAINT "MarketingSegment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingCampaign" ADD CONSTRAINT "MarketingCampaign_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "MarketingSegment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingCampaign" ADD CONSTRAINT "MarketingCampaign_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "MetaTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingCampaign" ADD CONSTRAINT "MarketingCampaign_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingCampaignRun" ADD CONSTRAINT "MarketingCampaignRun_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "MarketingCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingMessage" ADD CONSTRAINT "MarketingMessage_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingMessage" ADD CONSTRAINT "MarketingMessage_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "MarketingCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingMessage" ADD CONSTRAINT "MarketingMessage_campaignRunId_fkey" FOREIGN KEY ("campaignRunId") REFERENCES "MarketingCampaignRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Optimize attribution lookup: customer's latest unattributed marketing message
CREATE INDEX idx_mmsg_attribution_lookup
  ON "MarketingMessage" ("customerId", "sentAt" DESC)
  WHERE "convertedOrderId" IS NULL AND "excludedFromAttribution" = false;
