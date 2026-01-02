-- Drop global unique index on PaymentMethod.code (created by earlier migration)
DROP INDEX IF EXISTS "PaymentMethod_code_key";

-- Create unique index for company-scoped code
CREATE UNIQUE INDEX IF NOT EXISTS "company_payment_code_key" ON "PaymentMethod"("companyId", "code");
