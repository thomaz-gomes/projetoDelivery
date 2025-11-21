-- AlterTable
ALTER TABLE "Coupon" ADD COLUMN "expiresAt" DATETIME;
ALTER TABLE "Coupon" ADD COLUMN "maxUses" INTEGER;
ALTER TABLE "Coupon" ADD COLUMN "maxUsesPerCustomer" INTEGER;
ALTER TABLE "Coupon" ADD COLUMN "minSubtotal" DECIMAL;
