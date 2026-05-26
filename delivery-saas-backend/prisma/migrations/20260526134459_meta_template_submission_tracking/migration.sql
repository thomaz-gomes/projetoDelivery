-- Submission tracking fields for templates created via the panel.
-- All additions are nullable or default to safe values, so the migration
-- is non-destructive against the existing MetaTemplate rows (which were
-- all synced from Business Manager and get createdViaApp = false).

ALTER TABLE "MetaTemplate"
  ADD COLUMN "createdViaApp" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "submittedByUserId" TEXT,
  ADD COLUMN "submittedAt" TIMESTAMP(3),
  ADD COLUMN "rejectionReason" TEXT;

CREATE INDEX "MetaTemplate_createdViaApp_status_idx"
  ON "MetaTemplate" ("createdViaApp", "status");
