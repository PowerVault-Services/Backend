-- Add runState to Inverter for raw Huawei run_state storage
ALTER TABLE "Inverter" ADD COLUMN IF NOT EXISTS "runState" INTEGER;

-- Optional index for filtering/debugging
CREATE INDEX IF NOT EXISTS "Inverter_runState_idx" ON "Inverter"("runState");
