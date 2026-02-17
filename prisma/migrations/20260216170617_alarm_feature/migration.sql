/*
  Warnings:

  - Made the column `huaweiAlarmId` on table `Alarm` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "Alarm" ALTER COLUMN "huaweiAlarmId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "Alarm_siteId_clearedAt_idx" ON "Alarm"("siteId", "clearedAt");

-- CreateIndex
CREATE INDEX "Alarm_inverterId_clearedAt_idx" ON "Alarm"("inverterId", "clearedAt");

-- CreateIndex
CREATE INDEX "Alarm_severity_clearedAt_idx" ON "Alarm"("severity", "clearedAt");

-- CreateIndex
CREATE INDEX "Alarm_occurredAt_idx" ON "Alarm"("occurredAt");
