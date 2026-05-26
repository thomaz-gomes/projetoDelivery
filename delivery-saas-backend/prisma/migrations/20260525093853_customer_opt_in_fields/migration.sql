-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "optInMarketing" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "optInMarketingAt" TIMESTAMP(3),
ADD COLUMN     "optInMarketingSource" TEXT,
ADD COLUMN     "optOutMarketingAt" TIMESTAMP(3);
