-- Add missing basic information fields for inverter detail page

ALTER TABLE "Inverter"
  ADD COLUMN IF NOT EXISTS "softwareVersion" TEXT,
  ADD COLUMN IF NOT EXISTS "deviceReplacementRecord" TEXT;
