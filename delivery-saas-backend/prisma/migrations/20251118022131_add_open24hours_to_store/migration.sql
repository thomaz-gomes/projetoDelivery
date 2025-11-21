-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Store" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cnpj" TEXT,
    "logoUrl" TEXT,
    "timezone" TEXT,
    "open24Hours" BOOLEAN NOT NULL DEFAULT false,
    "weeklySchedule" JSONB,
    "address" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Store_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Store" ("address", "cnpj", "companyId", "createdAt", "id", "isActive", "logoUrl", "name", "timezone", "updatedAt", "weeklySchedule") SELECT "address", "cnpj", "companyId", "createdAt", "id", "isActive", "logoUrl", "name", "timezone", "updatedAt", "weeklySchedule" FROM "Store";
DROP TABLE "Store";
ALTER TABLE "new_Store" RENAME TO "Store";
CREATE UNIQUE INDEX "Store_cnpj_key" ON "Store"("cnpj");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
