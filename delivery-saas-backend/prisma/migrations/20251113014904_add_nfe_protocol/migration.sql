-- CreateTable
CREATE TABLE "NfeProtocol" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "orderId" TEXT,
    "nProt" TEXT,
    "cStat" TEXT,
    "xMotivo" TEXT,
    "rawXml" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NfeProtocol_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "NfeProtocol_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "NfeProtocol_nProt_key" ON "NfeProtocol"("nProt");

-- CreateIndex
CREATE INDEX "idx_nfeprotocol_company" ON "NfeProtocol"("companyId");

-- CreateIndex
CREATE INDEX "idx_nfeprotocol_order" ON "NfeProtocol"("orderId");
