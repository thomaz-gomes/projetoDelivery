-- AlterTable
ALTER TABLE "Order" ADD COLUMN "couponCode" TEXT;
ALTER TABLE "Order" ADD COLUMN "couponDiscount" DECIMAL;

-- CreateIndex
CREATE INDEX "idx_order_company_coupon" ON "Order"("companyId", "couponCode");
