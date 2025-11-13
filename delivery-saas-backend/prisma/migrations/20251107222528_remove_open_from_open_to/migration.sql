/*
  Warnings:

  - You are about to drop the column `openFrom` on the `Company` table. All the data in the column will be lost.
  - You are about to drop the column `openTo` on the `Company` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Company" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alwaysOpen" BOOLEAN NOT NULL DEFAULT true,
    "timezone" TEXT,
    "weeklySchedule" JSONB
);
INSERT INTO "new_Company" ("alwaysOpen", "createdAt", "id", "name", "timezone", "weeklySchedule") SELECT "alwaysOpen", "createdAt", "id", "name", "timezone", "weeklySchedule" FROM "Company";
DROP TABLE "Company";
ALTER TABLE "new_Company" RENAME TO "Company";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
