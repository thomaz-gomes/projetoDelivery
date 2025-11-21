-- CreateTable
CREATE TABLE "Store" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cnpj" TEXT,
    "logoUrl" TEXT,
    "timezone" TEXT,
    "weeklySchedule" JSONB,
    "address" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Store_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Menu" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "logoUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Menu_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ApiIntegration" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "storeId" TEXT,
    "clientId" TEXT,
    "clientSecret" TEXT,
    "merchantId" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "authMode" TEXT NOT NULL DEFAULT 'AUTH_CODE',
    "linkCode" TEXT,
    "codeVerifier" TEXT,
    "authCode" TEXT,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "tokenType" TEXT,
    "tokenExpiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ApiIntegration_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ApiIntegration_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ApiIntegration" ("accessToken", "authCode", "authMode", "clientId", "clientSecret", "codeVerifier", "companyId", "createdAt", "enabled", "id", "linkCode", "merchantId", "provider", "refreshToken", "tokenExpiresAt", "tokenType", "updatedAt") SELECT "accessToken", "authCode", "authMode", "clientId", "clientSecret", "codeVerifier", "companyId", "createdAt", "enabled", "id", "linkCode", "merchantId", "provider", "refreshToken", "tokenExpiresAt", "tokenType", "updatedAt" FROM "ApiIntegration";
DROP TABLE "ApiIntegration";
ALTER TABLE "new_ApiIntegration" RENAME TO "ApiIntegration";
CREATE UNIQUE INDEX "ApiIntegration_companyId_provider_key" ON "ApiIntegration"("companyId", "provider");
CREATE TABLE "new_MenuCategory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "menuId" TEXT,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MenuCategory_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MenuCategory_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "Menu" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_MenuCategory" ("companyId", "createdAt", "id", "isActive", "name", "position", "updatedAt") SELECT "companyId", "createdAt", "id", "isActive", "name", "position", "updatedAt" FROM "MenuCategory";
DROP TABLE "MenuCategory";
ALTER TABLE "new_MenuCategory" RENAME TO "MenuCategory";
CREATE INDEX "company_category_name_idx" ON "MenuCategory"("companyId", "name");
CREATE TABLE "new_NfeProtocol" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "storeId" TEXT,
    "orderId" TEXT,
    "nProt" TEXT,
    "cStat" TEXT,
    "xMotivo" TEXT,
    "rawXml" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NfeProtocol_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "NfeProtocol_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "NfeProtocol_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_NfeProtocol" ("cStat", "companyId", "createdAt", "id", "nProt", "orderId", "rawXml", "xMotivo") SELECT "cStat", "companyId", "createdAt", "id", "nProt", "orderId", "rawXml", "xMotivo" FROM "NfeProtocol";
DROP TABLE "NfeProtocol";
ALTER TABLE "new_NfeProtocol" RENAME TO "NfeProtocol";
CREATE UNIQUE INDEX "NfeProtocol_nProt_key" ON "NfeProtocol"("nProt");
CREATE INDEX "idx_nfeprotocol_company" ON "NfeProtocol"("companyId");
CREATE INDEX "idx_nfeprotocol_order" ON "NfeProtocol"("orderId");
CREATE TABLE "new_Order" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "storeId" TEXT,
    "externalId" TEXT,
    "displayId" TEXT,
    "displaySimple" INTEGER,
    "orderType" TEXT,
    "status" TEXT NOT NULL DEFAULT 'EM_PREPARO',
    "customerName" TEXT,
    "customerPhone" TEXT,
    "customerSource" TEXT DEFAULT 'MANUAL',
    "customerId" TEXT,
    "address" TEXT,
    "latitude" REAL,
    "longitude" REAL,
    "total" DECIMAL NOT NULL DEFAULT 0,
    "couponCode" TEXT,
    "couponDiscount" DECIMAL,
    "deliveryFee" DECIMAL,
    "payload" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "riderId" TEXT,
    CONSTRAINT "Order_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Order_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Order_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "Rider" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Order" ("address", "companyId", "couponCode", "couponDiscount", "createdAt", "customerId", "customerName", "customerPhone", "customerSource", "deliveryFee", "displayId", "displaySimple", "externalId", "id", "latitude", "longitude", "orderType", "payload", "riderId", "status", "total", "updatedAt") SELECT "address", "companyId", "couponCode", "couponDiscount", "createdAt", "customerId", "customerName", "customerPhone", "customerSource", "deliveryFee", "displayId", "displaySimple", "externalId", "id", "latitude", "longitude", "orderType", "payload", "riderId", "status", "total", "updatedAt" FROM "Order";
DROP TABLE "Order";
ALTER TABLE "new_Order" RENAME TO "Order";
CREATE UNIQUE INDEX "Order_externalId_key" ON "Order"("externalId");
CREATE INDEX "idx_order_company_coupon" ON "Order"("companyId", "couponCode");
CREATE TABLE "new_Product" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "menuId" TEXT,
    "categoryId" TEXT,
    "image" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DECIMAL NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Product_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Product_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "Menu" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "MenuCategory" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Product" ("categoryId", "companyId", "createdAt", "description", "id", "image", "isActive", "name", "position", "price", "updatedAt") SELECT "categoryId", "companyId", "createdAt", "description", "id", "image", "isActive", "name", "position", "price", "updatedAt" FROM "Product";
DROP TABLE "Product";
ALTER TABLE "new_Product" RENAME TO "Product";
CREATE INDEX "company_product_name_idx" ON "Product"("companyId", "name");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Store_cnpj_key" ON "Store"("cnpj");
