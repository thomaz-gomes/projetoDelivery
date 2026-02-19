-- Migration: add all columns/tables that were added to schema.postgres.prisma
-- after the initial migration (20260112203658_preview_from_schema).
-- Uses IF NOT EXISTS / DO $$ guards so it is safe to re-run.

-- ===== Menu: add contact/schedule/delivery columns =====
ALTER TABLE "Menu" ADD COLUMN IF NOT EXISTS "address"       TEXT;
ALTER TABLE "Menu" ADD COLUMN IF NOT EXISTS "phone"         TEXT;
ALTER TABLE "Menu" ADD COLUMN IF NOT EXISTS "whatsapp"      TEXT;
ALTER TABLE "Menu" ADD COLUMN IF NOT EXISTS "timezone"      TEXT;
ALTER TABLE "Menu" ADD COLUMN IF NOT EXISTS "weeklySchedule" JSONB;
ALTER TABLE "Menu" ADD COLUMN IF NOT EXISTS "open24Hours"   BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Menu" ADD COLUMN IF NOT EXISTS "allowDelivery" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Menu" ADD COLUMN IF NOT EXISTS "allowPickup"   BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Menu" ADD COLUMN IF NOT EXISTS "catalogMode"   BOOLEAN NOT NULL DEFAULT false;

-- ===== User: add missing columns =====
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "whatsapp"      TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "emailVerified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "updatedAt"     TIMESTAMP(3);
-- back-fill updatedAt for existing rows
UPDATE "User" SET "updatedAt" = "createdAt" WHERE "updatedAt" IS NULL;

-- ===== Company: add address + misc columns =====
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "street"               TEXT;
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "addressNumber"        TEXT;
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "addressNeighborhood"  TEXT;
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "city"                 TEXT;
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "state"                TEXT;
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "postalCode"           TEXT;
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "cashBlindCloseDefault" BOOLEAN NOT NULL DEFAULT false;

-- ===== Product: add missing columns =====
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "technicalSheetId" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "cashbackPercent"   DECIMAL(65,30);
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "dadosFiscaisId"    TEXT;

-- ===== MenuCategory: add missing column =====
ALTER TABLE "MenuCategory" ADD COLUMN IF NOT EXISTS "dadosFiscaisId" TEXT;

-- ===== Customer: add missing columns =====
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "email"            TEXT;
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "source"           TEXT NOT NULL DEFAULT 'PUBLIC';
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "customerAccountId" TEXT;
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "groupId"          TEXT;
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "referralCode"     TEXT;
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "totalOrders"      INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "totalSpent"       DECIMAL(65,30) NOT NULL DEFAULT 0;
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "birthdate"        TIMESTAMP(3);

-- ===== Rider: add missing columns =====
ALTER TABLE "Rider" ADD COLUMN IF NOT EXISTS "cpf"        TEXT;
ALTER TABLE "Rider" ADD COLUMN IF NOT EXISTS "phone"      TEXT;
ALTER TABLE "Rider" ADD COLUMN IF NOT EXISTS "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Rider" ADD COLUMN IF NOT EXISTS "updatedAt"  TIMESTAMP(3);
UPDATE "Rider" SET "updatedAt" = CURRENT_TIMESTAMP WHERE "updatedAt" IS NULL;

-- ===== Order: add missing columns =====
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "menuId"              TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "affiliateId"         TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "cashbackAmount"      DECIMAL(65,30);
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "cashbackEarned"      DECIMAL(65,30);
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "affiliateCommission" DECIMAL(65,30);
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "paymentMethod"       TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "nfeStatus"           TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "cashSessionId"       TEXT;

-- ===== NfeProtocol: add missing columns =====
ALTER TABLE "NfeProtocol" ADD COLUMN IF NOT EXISTS "mod"     TEXT;
ALTER TABLE "NfeProtocol" ADD COLUMN IF NOT EXISTS "chNFe"   TEXT;
ALTER TABLE "NfeProtocol" ADD COLUMN IF NOT EXISTS "dhReg"   TEXT;
ALTER TABLE "NfeProtocol" ADD COLUMN IF NOT EXISTS "tpAmb"   TEXT;
ALTER TABLE "NfeProtocol" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "NfeProtocol" SET "updatedAt" = "createdAt" WHERE "updatedAt" IS NULL;

-- ===== Store: add missing columns =====
ALTER TABLE "Store" ADD COLUMN IF NOT EXISTS "phone"  TEXT;
ALTER TABLE "Store" ADD COLUMN IF NOT EXISTS "email"  TEXT;

-- ===== WebhookEvent: add missing columns =====
ALTER TABLE "WebhookEvent" ADD COLUMN IF NOT EXISTS "storeId" TEXT;

-- ===== PrinterSetting: add missing columns =====
ALTER TABLE "PrinterSetting" ADD COLUMN IF NOT EXISTS "templateSource" TEXT;
ALTER TABLE "PrinterSetting" ADD COLUMN IF NOT EXISTS "customTemplate"  TEXT;

-- ===== OrderItem: add missing columns =====
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "orderId2" TEXT;

-- ===== Create missing tables (if not already created by db push) =====

-- CustomerAccount
CREATE TABLE IF NOT EXISTS "CustomerAccount" (
    "id"          TEXT NOT NULL,
    "companyId"   TEXT NOT NULL,
    "customerId"  TEXT NOT NULL,
    "balance"     DECIMAL(65,30) NOT NULL DEFAULT 0,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CustomerAccount_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "CustomerAccount_customerId_key" ON "CustomerAccount"("customerId");

-- CustomerGroup
CREATE TABLE IF NOT EXISTS "CustomerGroup" (
    "id"          TEXT NOT NULL,
    "companyId"   TEXT NOT NULL,
    "name"        TEXT NOT NULL,
    "description" TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CustomerGroup_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "idx_customergroup_company" ON "CustomerGroup"("companyId");

-- CustomerGroupMember
CREATE TABLE IF NOT EXISTS "CustomerGroupMember" (
    "id"         TEXT NOT NULL,
    "groupId"    TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "joinedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CustomerGroupMember_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "CustomerGroupMember_groupId_customerId_key" ON "CustomerGroupMember"("groupId", "customerId");

-- CustomerGroupRule
CREATE TABLE IF NOT EXISTS "CustomerGroupRule" (
    "id"         TEXT NOT NULL,
    "groupId"    TEXT NOT NULL,
    "field"      TEXT NOT NULL,
    "operator"   TEXT NOT NULL,
    "value"      TEXT NOT NULL,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CustomerGroupRule_pkey" PRIMARY KEY ("id")
);

-- IngredientGroup
CREATE TABLE IF NOT EXISTS "IngredientGroup" (
    "id"        TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name"      TEXT NOT NULL,
    "unit"      TEXT NOT NULL DEFAULT 'g',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IngredientGroup_pkey" PRIMARY KEY ("id")
);

-- Ingredient
CREATE TABLE IF NOT EXISTS "Ingredient" (
    "id"               TEXT NOT NULL,
    "companyId"        TEXT NOT NULL,
    "groupId"          TEXT,
    "name"             TEXT NOT NULL,
    "unit"             TEXT NOT NULL DEFAULT 'g',
    "costPerUnit"      DECIMAL(65,30) NOT NULL DEFAULT 0,
    "stock"            DECIMAL(65,30) NOT NULL DEFAULT 0,
    "minStock"         DECIMAL(65,30) NOT NULL DEFAULT 0,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Ingredient_pkey" PRIMARY KEY ("id")
);

-- TechnicalSheet
CREATE TABLE IF NOT EXISTS "TechnicalSheet" (
    "id"        TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name"      TEXT NOT NULL,
    "yield"     DECIMAL(65,30) NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TechnicalSheet_pkey" PRIMARY KEY ("id")
);

-- TechnicalSheetItem
CREATE TABLE IF NOT EXISTS "TechnicalSheetItem" (
    "id"             TEXT NOT NULL,
    "sheetId"        TEXT NOT NULL,
    "ingredientId"   TEXT NOT NULL,
    "quantity"       DECIMAL(65,30) NOT NULL DEFAULT 0,
    "unit"           TEXT NOT NULL DEFAULT 'g',
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TechnicalSheetItem_pkey" PRIMARY KEY ("id")
);

-- StockMovement
CREATE TABLE IF NOT EXISTS "StockMovement" (
    "id"          TEXT NOT NULL,
    "companyId"   TEXT NOT NULL,
    "storeId"     TEXT,
    "type"        TEXT NOT NULL,
    "reason"      TEXT,
    "note"        TEXT,
    "createdBy"   TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- StockMovementItem
CREATE TABLE IF NOT EXISTS "StockMovementItem" (
    "id"             TEXT NOT NULL,
    "movementId"     TEXT NOT NULL,
    "ingredientId"   TEXT NOT NULL,
    "quantity"       DECIMAL(65,30) NOT NULL DEFAULT 0,
    "unit"           TEXT NOT NULL DEFAULT 'g',
    "costPerUnit"    DECIMAL(65,30),
    CONSTRAINT "StockMovementItem_pkey" PRIMARY KEY ("id")
);

-- CashbackSetting
CREATE TABLE IF NOT EXISTS "CashbackSetting" (
    "id"             TEXT NOT NULL,
    "companyId"      TEXT NOT NULL,
    "enabled"        BOOLEAN NOT NULL DEFAULT false,
    "defaultPercent" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "minRedeemValue" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CashbackSetting_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "CashbackSetting_companyId_key" ON "CashbackSetting"("companyId");

-- CashbackProductRule
CREATE TABLE IF NOT EXISTS "CashbackProductRule" (
    "id"              TEXT NOT NULL,
    "companyId"       TEXT NOT NULL,
    "productId"       TEXT NOT NULL,
    "cashbackPercent" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CashbackProductRule_pkey" PRIMARY KEY ("id")
);

-- CashbackWallet
CREATE TABLE IF NOT EXISTS "CashbackWallet" (
    "id"        TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "balance"   DECIMAL(65,30) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CashbackWallet_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "CashbackWallet_companyId_customerId_key" ON "CashbackWallet"("companyId", "customerId");

-- CashbackTransaction
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CashbackTransactionType') THEN
    CREATE TYPE "CashbackTransactionType" AS ENUM ('CREDIT', 'DEBIT');
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS "CashbackTransaction" (
    "id"         TEXT NOT NULL,
    "walletId"   TEXT NOT NULL,
    "companyId"  TEXT NOT NULL,
    "orderId"    TEXT,
    "type"       "CashbackTransactionType" NOT NULL,
    "amount"     DECIMAL(65,30) NOT NULL,
    "note"       TEXT,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CashbackTransaction_pkey" PRIMARY KEY ("id")
);

-- SaasModule
CREATE TABLE IF NOT EXISTS "SaasModule" (
    "id"          TEXT NOT NULL,
    "key"         TEXT NOT NULL,
    "name"        TEXT NOT NULL,
    "description" TEXT,
    CONSTRAINT "SaasModule_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "SaasModule_key_key" ON "SaasModule"("key");

-- SaasPlan
CREATE TABLE IF NOT EXISTS "SaasPlan" (
    "id"          TEXT NOT NULL,
    "name"        TEXT NOT NULL,
    "description" TEXT,
    "isActive"    BOOLEAN NOT NULL DEFAULT true,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SaasPlan_pkey" PRIMARY KEY ("id")
);

-- SaasPlanPrice
CREATE TABLE IF NOT EXISTS "SaasPlanPrice" (
    "id"            TEXT NOT NULL,
    "planId"        TEXT NOT NULL,
    "billingPeriod" TEXT NOT NULL,
    "price"         DECIMAL(65,30) NOT NULL DEFAULT 0,
    "currency"      TEXT NOT NULL DEFAULT 'BRL',
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SaasPlanPrice_pkey" PRIMARY KEY ("id")
);

-- SaasPlanModule
CREATE TABLE IF NOT EXISTS "SaasPlanModule" (
    "planId"    TEXT NOT NULL,
    "moduleId"  TEXT NOT NULL,
    "limit"     INTEGER,
    CONSTRAINT "SaasPlanModule_pkey" PRIMARY KEY ("planId","moduleId")
);

-- SaasSubscription
CREATE TABLE IF NOT EXISTS "SaasSubscription" (
    "id"               TEXT NOT NULL,
    "companyId"        TEXT NOT NULL,
    "planId"           TEXT NOT NULL,
    "status"           TEXT NOT NULL DEFAULT 'ACTIVE',
    "billingPeriod"    TEXT NOT NULL DEFAULT 'MONTHLY',
    "currentPeriodEnd" TIMESTAMP(3),
    "canceledAt"       TIMESTAMP(3),
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SaasSubscription_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "SaasSubscription_companyId_key" ON "SaasSubscription"("companyId");

-- SaasInvoice
CREATE TABLE IF NOT EXISTS "SaasInvoice" (
    "id"             TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "amount"         DECIMAL(65,30) NOT NULL DEFAULT 0,
    "status"         TEXT NOT NULL DEFAULT 'PENDING',
    "dueDate"        TIMESTAMP(3),
    "paidAt"         TIMESTAMP(3),
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SaasInvoice_pkey" PRIMARY KEY ("id")
);

-- FinancialAccount
CREATE TABLE IF NOT EXISTS "FinancialAccount" (
    "id"          TEXT NOT NULL,
    "companyId"   TEXT NOT NULL,
    "name"        TEXT NOT NULL,
    "type"        TEXT NOT NULL DEFAULT 'CHECKING',
    "bankName"    TEXT,
    "bankBranch"  TEXT,
    "bankAccount" TEXT,
    "balance"     DECIMAL(65,30) NOT NULL DEFAULT 0,
    "isActive"    BOOLEAN NOT NULL DEFAULT true,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FinancialAccount_pkey" PRIMARY KEY ("id")
);

-- CostCenter
CREATE TABLE IF NOT EXISTS "CostCenter" (
    "id"          TEXT NOT NULL,
    "companyId"   TEXT NOT NULL,
    "name"        TEXT NOT NULL,
    "description" TEXT,
    "isActive"    BOOLEAN NOT NULL DEFAULT true,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CostCenter_pkey" PRIMARY KEY ("id")
);

-- PaymentGatewayConfig
CREATE TABLE IF NOT EXISTS "PaymentGatewayConfig" (
    "id"          TEXT NOT NULL,
    "companyId"   TEXT NOT NULL,
    "provider"    TEXT NOT NULL,
    "isActive"    BOOLEAN NOT NULL DEFAULT false,
    "config"      JSONB,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PaymentGatewayConfig_pkey" PRIMARY KEY ("id")
);

-- FinancialTransaction
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'FinancialTransactionType') THEN
    CREATE TYPE "FinancialTransactionType" AS ENUM ('INCOME', 'EXPENSE', 'TRANSFER');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'FinancialTransactionStatus') THEN
    CREATE TYPE "FinancialTransactionStatus" AS ENUM ('PENDING', 'PAID', 'CANCELLED', 'OVERDUE');
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS "FinancialTransaction" (
    "id"               TEXT NOT NULL,
    "companyId"        TEXT NOT NULL,
    "accountId"        TEXT,
    "costCenterId"     TEXT,
    "cashSessionId"    TEXT,
    "type"             "FinancialTransactionType" NOT NULL,
    "status"           "FinancialTransactionStatus" NOT NULL DEFAULT 'PENDING',
    "category"         TEXT,
    "description"      TEXT,
    "amount"           DECIMAL(65,30) NOT NULL DEFAULT 0,
    "dueDate"          TIMESTAMP(3),
    "paidAt"           TIMESTAMP(3),
    "paymentMethod"    TEXT,
    "orderId"          TEXT,
    "reference"        TEXT,
    "notes"            TEXT,
    "createdBy"        TEXT,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FinancialTransaction_pkey" PRIMARY KEY ("id")
);

-- CashFlowEntry
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CashFlowEntryType') THEN
    CREATE TYPE "CashFlowEntryType" AS ENUM ('INCOME', 'EXPENSE');
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS "CashFlowEntry" (
    "id"            TEXT NOT NULL,
    "companyId"     TEXT NOT NULL,
    "accountId"     TEXT,
    "costCenterId"  TEXT,
    "type"          "CashFlowEntryType" NOT NULL,
    "category"      TEXT,
    "description"   TEXT NOT NULL,
    "amount"        DECIMAL(65,30) NOT NULL DEFAULT 0,
    "entryDate"     TIMESTAMP(3) NOT NULL,
    "paymentMethod" TEXT,
    "orderId"       TEXT,
    "reference"     TEXT,
    "notes"         TEXT,
    "createdBy"     TEXT,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CashFlowEntry_pkey" PRIMARY KEY ("id")
);

-- OfxImport
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OfxMatchStatus') THEN
    CREATE TYPE "OfxMatchStatus" AS ENUM ('PENDING', 'MATCHED', 'IGNORED', 'UNMATCHED');
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS "OfxImport" (
    "id"          TEXT NOT NULL,
    "companyId"   TEXT NOT NULL,
    "accountId"   TEXT,
    "filename"    TEXT NOT NULL,
    "bankId"      TEXT,
    "accountIdOfx" TEXT,
    "dateFrom"    TIMESTAMP(3),
    "dateTo"      TIMESTAMP(3),
    "importedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OfxImport_pkey" PRIMARY KEY ("id")
);

-- OfxReconciliationItem
CREATE TABLE IF NOT EXISTS "OfxReconciliationItem" (
    "id"              TEXT NOT NULL,
    "importId"        TEXT NOT NULL,
    "fitId"           TEXT NOT NULL,
    "trnType"         TEXT,
    "amount"          DECIMAL(65,30) NOT NULL,
    "ofxDate"         TIMESTAMP(3) NOT NULL,
    "memo"            TEXT,
    "checkNum"        TEXT,
    "refNum"          TEXT,
    "matchStatus"     "OfxMatchStatus" NOT NULL DEFAULT 'PENDING',
    "transactionId"   TEXT,
    "cashFlowEntryId" TEXT,
    "matchConfidence" DECIMAL(65,30),
    "matchNotes"      TEXT,
    "resolvedBy"      TEXT,
    "resolvedAt"      TIMESTAMP(3),
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OfxReconciliationItem_pkey" PRIMARY KEY ("id")
);

-- EmailVerification
CREATE TABLE IF NOT EXISTS "EmailVerification" (
    "id"        TEXT NOT NULL,
    "email"     TEXT NOT NULL,
    "code"      TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "used"      BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmailVerification_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "idx_emailverification_email_code" ON "EmailVerification"("email", "code");

-- CashSession
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CashSessionStatus') THEN
    CREATE TYPE "CashSessionStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'CLOSED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CashMovementType') THEN
    CREATE TYPE "CashMovementType" AS ENUM ('WITHDRAWAL', 'REINFORCEMENT', 'ADJUSTMENT');
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS "CashSession" (
    "id"              TEXT NOT NULL,
    "companyId"       TEXT NOT NULL,
    "openedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openedBy"        TEXT NOT NULL,
    "openingAmount"   DECIMAL(65,30) NOT NULL DEFAULT 0,
    "openingNote"     TEXT,
    "currentBalance"  DECIMAL(65,30) NOT NULL DEFAULT 0,
    "status"          "CashSessionStatus" NOT NULL DEFAULT 'OPEN',
    "closedAt"        TIMESTAMP(3),
    "closedBy"        TEXT,
    "closingNote"     TEXT,
    "blindClose"      BOOLEAN NOT NULL DEFAULT false,
    "declaredValues"  JSONB,
    "expectedValues"  JSONB,
    "differences"     JSONB,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CashSession_pkey" PRIMARY KEY ("id")
);

-- CashMovement
CREATE TABLE IF NOT EXISTS "CashMovement" (
    "id"        TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "type"      "CashMovementType" NOT NULL,
    "amount"    DECIMAL(65,30) NOT NULL,
    "accountId" TEXT,
    "note"      TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    CONSTRAINT "CashMovement_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "idx_cash_movement_session" ON "CashMovement"("sessionId");

-- DadosFiscais
CREATE TABLE IF NOT EXISTS "DadosFiscais" (
    "id"                TEXT NOT NULL,
    "companyId"         TEXT NOT NULL,
    "descricao"         TEXT NOT NULL,
    "ean"               TEXT,
    "codBeneficio"      TEXT,
    "codCredPresumido"  TEXT,
    "percCredPresumido" DECIMAL(65,30),
    "ncm"               TEXT,
    "orig"              TEXT,
    "icmsPercBase"      DECIMAL(65,30) DEFAULT 100,
    "icmsAliq"          DECIMAL(65,30) DEFAULT 0,
    "icmsModBC"         TEXT,
    "icmsFCP"           DECIMAL(65,30) DEFAULT 0,
    "icmsStPercBase"    DECIMAL(65,30) DEFAULT 100,
    "icmsStAliq"        DECIMAL(65,30) DEFAULT 0,
    "icmsStModBCST"     TEXT,
    "icmsStMVA"         DECIMAL(65,30) DEFAULT 0,
    "icmsStFCP"         DECIMAL(65,30) DEFAULT 0,
    "icmsEfetPercBase"  DECIMAL(65,30),
    "icmsEfetAliq"      DECIMAL(65,30),
    "pPIS"              DECIMAL(65,30) DEFAULT 0,
    "pCOFINS"           DECIMAL(65,30) DEFAULT 0,
    "pIPI"              DECIMAL(65,30) DEFAULT 0,
    "cfops"             TEXT,
    "cest"              TEXT,
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DadosFiscais_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "DadosFiscais_companyId_idx" ON "DadosFiscais"("companyId");

-- MetaPixel
CREATE TABLE IF NOT EXISTS "MetaPixel" (
    "id"                    TEXT NOT NULL,
    "companyId"             TEXT NOT NULL,
    "menuId"                TEXT NOT NULL,
    "pixelId"               TEXT NOT NULL,
    "enabled"               BOOLEAN NOT NULL DEFAULT true,
    "trackPageView"         BOOLEAN NOT NULL DEFAULT true,
    "trackViewContent"      BOOLEAN NOT NULL DEFAULT true,
    "trackAddToCart"        BOOLEAN NOT NULL DEFAULT true,
    "trackInitiateCheckout" BOOLEAN NOT NULL DEFAULT true,
    "trackAddPaymentInfo"   BOOLEAN NOT NULL DEFAULT true,
    "trackPurchase"         BOOLEAN NOT NULL DEFAULT true,
    "trackSearch"           BOOLEAN NOT NULL DEFAULT true,
    "trackLead"             BOOLEAN NOT NULL DEFAULT true,
    "trackContact"          BOOLEAN NOT NULL DEFAULT true,
    "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MetaPixel_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "company_menu_pixel" ON "MetaPixel"("companyId", "menuId");
CREATE INDEX IF NOT EXISTS "idx_metapixel_company"  ON "MetaPixel"("companyId");
CREATE INDEX IF NOT EXISTS "idx_metapixel_menu"     ON "MetaPixel"("menuId");

-- Media
CREATE TABLE IF NOT EXISTS "Media" (
    "id"        TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "filename"  TEXT NOT NULL,
    "mimeType"  TEXT NOT NULL,
    "size"      INTEGER NOT NULL,
    "url"       TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Media_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "idx_media_company_created" ON "Media"("companyId", "createdAt");

-- ===== FK constraints for new columns (ignore if already exist) =====
DO $$ BEGIN
  -- Product.dadosFiscaisId -> DadosFiscais
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'Product_dadosFiscaisId_fkey') THEN
    ALTER TABLE "Product" ADD CONSTRAINT "Product_dadosFiscaisId_fkey"
      FOREIGN KEY ("dadosFiscaisId") REFERENCES "DadosFiscais"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  -- MenuCategory.dadosFiscaisId -> DadosFiscais
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'MenuCategory_dadosFiscaisId_fkey') THEN
    ALTER TABLE "MenuCategory" ADD CONSTRAINT "MenuCategory_dadosFiscaisId_fkey"
      FOREIGN KEY ("dadosFiscaisId") REFERENCES "DadosFiscais"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  -- DadosFiscais.companyId -> Company
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'DadosFiscais_companyId_fkey') THEN
    ALTER TABLE "DadosFiscais" ADD CONSTRAINT "DadosFiscais_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  -- MetaPixel.companyId -> Company
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'MetaPixel_companyId_fkey') THEN
    ALTER TABLE "MetaPixel" ADD CONSTRAINT "MetaPixel_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
