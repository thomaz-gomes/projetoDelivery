-- AlterTable
ALTER TABLE "Affiliate" ADD COLUMN "password" TEXT;

-- AlterTable
ALTER TABLE "ApiIntegration" ADD COLUMN "merchantUuid" TEXT;

-- AlterTable
ALTER TABLE "PrinterSetting" ADD COLUMN "agentTokenCreatedAt" DATETIME;
ALTER TABLE "PrinterSetting" ADD COLUMN "agentTokenHash" TEXT;

-- AlterTable
ALTER TABLE "Store" ADD COLUMN "bannerUrl" TEXT;

-- CreateTable
CREATE TABLE "SaasModule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "SaasPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "price" DECIMAL NOT NULL DEFAULT 0,
    "menuLimit" INTEGER,
    "storeLimit" INTEGER,
    "unlimitedMenus" BOOLEAN NOT NULL DEFAULT false,
    "unlimitedStores" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "SaasPlanModule" (
    "planId" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,

    PRIMARY KEY ("planId", "moduleId"),
    CONSTRAINT "SaasPlanModule_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SaasPlan" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SaasPlanModule_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "SaasModule" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SaasSubscription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nextDueAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SaasSubscription_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SaasSubscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SaasPlan" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SaasInvoice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "subscriptionId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "amount" DECIMAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "dueDate" DATETIME,
    "paidAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SaasInvoice_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "SaasSubscription" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "SaasModule_key_key" ON "SaasModule"("key");

-- CreateIndex
CREATE UNIQUE INDEX "SaasSubscription_companyId_key" ON "SaasSubscription"("companyId");

-- CreateIndex
CREATE INDEX "sub_month_idx" ON "SaasInvoice"("subscriptionId", "year", "month");
