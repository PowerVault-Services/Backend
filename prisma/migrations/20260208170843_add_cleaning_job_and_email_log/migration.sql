/*
  Warnings:

  - You are about to drop the column `devId` on the `Alarm` table. All the data in the column will be lost.
  - You are about to drop the column `sn` on the `Alarm` table. All the data in the column will be lost.
  - You are about to drop the column `stationCode` on the `Alarm` table. All the data in the column will be lost.
  - You are about to drop the column `powerFactor` on the `InverterKpiSnapshot` table. All the data in the column will be lost.
  - You are about to drop the column `temperature` on the `InverterKpiSnapshot` table. All the data in the column will be lost.
  - You are about to drop the column `updatedAt` on the `SiteDailyEnergy` table. All the data in the column will be lost.
  - You are about to drop the column `yieldKWh` on the `SiteDailyEnergy` table. All the data in the column will be lost.
  - You are about to drop the column `insuranceCompany` on the `StockTransaction` table. All the data in the column will be lost.
  - You are about to drop the column `insuranceNo` on the `StockTransaction` table. All the data in the column will be lost.
  - You are about to drop the `InverterStringSnapshot` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `SyncState` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `energyKWh` to the `SiteDailyEnergy` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "InverterStringSnapshot" DROP CONSTRAINT "InverterStringSnapshot_snapshotId_fkey";

-- DropIndex
DROP INDEX "Alarm_devId_idx";

-- DropIndex
DROP INDEX "Alarm_occurredAt_idx";

-- DropIndex
DROP INDEX "Alarm_stationCode_idx";

-- DropIndex
DROP INDEX "Alarm_status_idx";

-- DropIndex
DROP INDEX "InverterKpiSnapshot_inverterId_ts_idx";

-- DropIndex
DROP INDEX "Product_categoryId_idx";

-- DropIndex
DROP INDEX "Product_name_idx";

-- DropIndex
DROP INDEX "Product_unitId_idx";

-- DropIndex
DROP INDEX "SiteDailyEnergy_date_idx";

-- DropIndex
DROP INDEX "StockTransaction_productId_txDate_idx";

-- DropIndex
DROP INDEX "StockTransaction_type_txDate_idx";

-- AlterTable
ALTER TABLE "Alarm" DROP COLUMN "devId",
DROP COLUMN "sn",
DROP COLUMN "stationCode";

-- AlterTable
ALTER TABLE "InverterKpiSnapshot" DROP COLUMN "powerFactor",
DROP COLUMN "temperature";

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "contractor" TEXT,
ADD COLUMN     "planEmailBody" TEXT,
ADD COLUMN     "projectType" TEXT,
ADD COLUMN     "reportUrl" TEXT,
ADD COLUMN     "step" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Site" ADD COLUMN     "contactEmail" TEXT,
ADD COLUMN     "contactPhone" TEXT,
ADD COLUMN     "pvModuleCount" INTEGER;

-- AlterTable
ALTER TABLE "SiteDailyEnergy" DROP COLUMN "updatedAt",
DROP COLUMN "yieldKWh",
ADD COLUMN     "energyKWh" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "raw" JSONB;

-- AlterTable
ALTER TABLE "StockTransaction" DROP COLUMN "insuranceCompany",
DROP COLUMN "insuranceNo";

-- DropTable
DROP TABLE "InverterStringSnapshot";

-- DropTable
DROP TABLE "SyncState";

-- DropEnum
DROP TYPE "TransactionType";

-- CreateTable
CREATE TABLE "CleaningJob" (
    "id" SERIAL NOT NULL,
    "jobId" INTEGER NOT NULL,
    "projectName" TEXT,
    "projectType" TEXT,
    "systemSizeKWp" DOUBLE PRECISION,
    "pvModuleEA" INTEGER,
    "locationText" TEXT,
    "contactPhone" TEXT,
    "contactEmail" TEXT,
    "workDate" TIMESTAMP(3),
    "workTimeText" TEXT,
    "customerName" TEXT,
    "note" TEXT,
    "step2EmailTo" TEXT,
    "step2EmailSubject" TEXT,
    "step2EmailBody" TEXT,
    "step2SentAt" TIMESTAMP(3),
    "step2SentByUserId" INTEGER,
    "step3SummaryNote" TEXT,
    "checklist" JSONB,
    "reportFileUrl" TEXT,
    "reportCreatedAt" TIMESTAMP(3),
    "step5EmailTo" TEXT,
    "step5EmailSubject" TEXT,
    "step5EmailBody" TEXT,
    "step5SentAt" TIMESTAMP(3),
    "step5SentByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CleaningJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailLog" (
    "id" SERIAL NOT NULL,
    "jobId" INTEGER,
    "step" INTEGER,
    "to" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "bodyPreview" TEXT,
    "status" TEXT NOT NULL,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CleaningJob_jobId_key" ON "CleaningJob"("jobId");

-- CreateIndex
CREATE INDEX "SiteDailyEnergy_siteId_date_idx" ON "SiteDailyEnergy"("siteId", "date");

-- AddForeignKey
ALTER TABLE "CleaningJob" ADD CONSTRAINT "CleaningJob_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CleaningJob" ADD CONSTRAINT "CleaningJob_step2SentByUserId_fkey" FOREIGN KEY ("step2SentByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CleaningJob" ADD CONSTRAINT "CleaningJob_step5SentByUserId_fkey" FOREIGN KEY ("step5SentByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailLog" ADD CONSTRAINT "EmailLog_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;
