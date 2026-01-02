-- AlterTable
ALTER TABLE "SaasSubscription" ADD COLUMN "period" TEXT;

-- CreateTable
CREATE TABLE "SaasPlanPrice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "planId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "price" DECIMAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SaasPlanPrice_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SaasPlan" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "IngredientGroup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "composesCmv" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "IngredientGroup_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "IngredientGroup_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "IngredientGroup" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Ingredient" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "groupId" TEXT,
    "controlsStock" BOOLEAN NOT NULL DEFAULT true,
    "composesCmv" BOOLEAN NOT NULL DEFAULT false,
    "minStock" DECIMAL DEFAULT 0,
    "currentStock" DECIMAL DEFAULT 0,
    "avgCost" DECIMAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Ingredient_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Ingredient_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "IngredientGroup" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TechnicalSheet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TechnicalSheet_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TechnicalSheetItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "technicalSheetId" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "quantity" DECIMAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TechnicalSheetItem_technicalSheetId_fkey" FOREIGN KEY ("technicalSheetId") REFERENCES "TechnicalSheet" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TechnicalSheetItem_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "storeId" TEXT,
    "type" TEXT NOT NULL,
    "reason" TEXT,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StockMovement_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StockMovement_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StockMovementItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "stockMovementId" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "quantity" DECIMAL NOT NULL,
    "unitCost" DECIMAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StockMovementItem_stockMovementId_fkey" FOREIGN KEY ("stockMovementId") REFERENCES "StockMovement" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StockMovementItem_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "plan_price_idx" ON "SaasPlanPrice"("planId");

-- CreateIndex
CREATE INDEX "company_ingredientgroup_name_idx" ON "IngredientGroup"("companyId", "name");

-- CreateIndex
CREATE INDEX "company_ingredient_description_idx" ON "Ingredient"("companyId", "description");

-- CreateIndex
CREATE INDEX "company_technical_sheet_name_idx" ON "TechnicalSheet"("companyId", "name");

-- CreateIndex
CREATE INDEX "idx_tsheet_items_sheet" ON "TechnicalSheetItem"("technicalSheetId");

-- CreateIndex
CREATE INDEX "idx_tsheet_items_ingredient" ON "TechnicalSheetItem"("ingredientId");

-- CreateIndex
CREATE INDEX "idx_stockmovement_company" ON "StockMovement"("companyId");

-- CreateIndex
CREATE INDEX "idx_stockmovement_store" ON "StockMovement"("storeId");

-- CreateIndex
CREATE INDEX "idx_stockmovementitem_movement" ON "StockMovementItem"("stockMovementId");

-- CreateIndex
CREATE INDEX "idx_stockmovementitem_ingredient" ON "StockMovementItem"("ingredientId");
