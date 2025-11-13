/*
  Warnings:

  - A unique constraint covering the columns `[companyId,cpf]` on the table `Customer` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[companyId,whatsapp]` on the table `Customer` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "Customer_whatsapp_key";

-- DropIndex
DROP INDEX "Customer_cpf_key";

-- CreateIndex
CREATE UNIQUE INDEX "Customer_companyId_cpf_key" ON "Customer"("companyId", "cpf");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_companyId_whatsapp_key" ON "Customer"("companyId", "whatsapp");
