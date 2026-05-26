-- AlterEnum
-- ALTER TYPE ADD VALUE must run outside transaction; Prisma migrate handles this when
-- the file contains only ALTER TYPE statements.
ALTER TYPE "ModuleKey" ADD VALUE 'MARKETING_CAMPAIGNS';
