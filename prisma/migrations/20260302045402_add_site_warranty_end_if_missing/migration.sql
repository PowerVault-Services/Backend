-- Safety migration: ensure Site warranty columns exist.
-- Some environments were created before the client-data migration was applied.

ALTER TABLE "Site"
  ADD COLUMN IF NOT EXISTS "warrantyStart" TIMESTAMP(3);

ALTER TABLE "Site"
  ADD COLUMN IF NOT EXISTS "warrantyEnd" TIMESTAMP(3);
