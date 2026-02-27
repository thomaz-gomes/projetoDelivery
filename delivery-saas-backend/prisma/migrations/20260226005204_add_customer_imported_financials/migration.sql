-- AddColumn: evolutionEnabled to Company
ALTER TABLE "Company" ADD COLUMN "evolutionEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AddColumn: Customer imported financials (proper PostgreSQL types)
ALTER TABLE "Customer" ADD COLUMN "importedTotalOrders" INTEGER;
ALTER TABLE "Customer" ADD COLUMN "importedTotalSpent" DOUBLE PRECISION;
ALTER TABLE "Customer" ADD COLUMN "importedAvgTicket" DOUBLE PRECISION;
ALTER TABLE "Customer" ADD COLUMN "importedLastPurchase" TIMESTAMP(3);
ALTER TABLE "Customer" ADD COLUMN "importedFinancialBalanceTotal" DOUBLE PRECISION;
ALTER TABLE "Customer" ADD COLUMN "importedFinancialBalancePeriod" DOUBLE PRECISION;
