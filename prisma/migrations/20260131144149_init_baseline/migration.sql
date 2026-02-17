-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'SYSTEM_OWNER', 'SERVICE_TEAM', 'CLEANING_TEAM');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('CLEANING', 'SERVICE', 'INSPECTION');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('DRAFT', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('IN', 'OUT');

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "username" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "email" TEXT,
    "role" "Role" NOT NULL DEFAULT 'SYSTEM_OWNER',
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "phone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Site" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "capacityKWp" DOUBLE PRECISION NOT NULL,
    "plantCode" TEXT NOT NULL,
    "ownerId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Inverter" (
    "id" SERIAL NOT NULL,
    "serialNumber" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "siteId" INTEGER NOT NULL,
    "huaweiDevId" TEXT,
    "stationCode" TEXT,
    "activePower" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastDailyEnergy" DOUBLE PRECISION,
    "status" TEXT,
    "lastSyncAt" TIMESTAMP(3),

    CONSTRAINT "Inverter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncState" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" SERIAL NOT NULL,
    "jobNo" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" "JobType" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'DRAFT',
    "scheduledDate" TIMESTAMP(3),
    "details" TEXT,
    "siteId" INTEGER NOT NULL,
    "assignedToId" INTEGER,
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobAttachment" (
    "id" SERIAL NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileType" TEXT,
    "jobId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" SERIAL NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "unit" TEXT NOT NULL,
    "currentStock" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockTransaction" (
    "id" SERIAL NOT NULL,
    "type" "TransactionType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "jobId" INTEGER,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteDailyEnergy" (
    "id" SERIAL NOT NULL,
    "siteId" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "yieldKWh" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteDailyEnergy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alarm" (
    "id" SERIAL NOT NULL,
    "huaweiAlarmId" TEXT,
    "siteId" INTEGER,
    "inverterId" INTEGER,
    "stationCode" TEXT,
    "devId" TEXT,
    "sn" TEXT,
    "name" TEXT,
    "severity" INTEGER,
    "status" TEXT,
    "occurredAt" TIMESTAMP(3),
    "clearedAt" TIMESTAMP(3),
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Alarm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InverterKpiSnapshot" (
    "id" SERIAL NOT NULL,
    "inverterId" INTEGER NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL,
    "activePower" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dayEnergy" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalEnergy" DOUBLE PRECISION,
    "runState" INTEGER,
    "temperature" DOUBLE PRECISION,
    "powerFactor" DOUBLE PRECISION,
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InverterKpiSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InverterStringSnapshot" (
    "id" SERIAL NOT NULL,
    "snapshotId" INTEGER NOT NULL,
    "stringNo" INTEGER NOT NULL,
    "voltage" DOUBLE PRECISION,
    "current" DOUBLE PRECISION,
    "status" TEXT,

    CONSTRAINT "InverterStringSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Site_plantCode_key" ON "Site"("plantCode");

-- CreateIndex
CREATE UNIQUE INDEX "Inverter_serialNumber_key" ON "Inverter"("serialNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Inverter_huaweiDevId_key" ON "Inverter"("huaweiDevId");

-- CreateIndex
CREATE UNIQUE INDEX "SyncState_key_key" ON "SyncState"("key");

-- CreateIndex
CREATE UNIQUE INDEX "Job_jobNo_key" ON "Job"("jobNo");

-- CreateIndex
CREATE UNIQUE INDEX "Product_sku_key" ON "Product"("sku");

-- CreateIndex
CREATE INDEX "SiteDailyEnergy_date_idx" ON "SiteDailyEnergy"("date");

-- CreateIndex
CREATE UNIQUE INDEX "SiteDailyEnergy_siteId_date_key" ON "SiteDailyEnergy"("siteId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Alarm_huaweiAlarmId_key" ON "Alarm"("huaweiAlarmId");

-- CreateIndex
CREATE INDEX "Alarm_stationCode_idx" ON "Alarm"("stationCode");

-- CreateIndex
CREATE INDEX "Alarm_devId_idx" ON "Alarm"("devId");

-- CreateIndex
CREATE INDEX "Alarm_status_idx" ON "Alarm"("status");

-- CreateIndex
CREATE INDEX "Alarm_occurredAt_idx" ON "Alarm"("occurredAt");

-- CreateIndex
CREATE INDEX "InverterKpiSnapshot_inverterId_ts_idx" ON "InverterKpiSnapshot"("inverterId", "ts");

-- CreateIndex
CREATE UNIQUE INDEX "InverterKpiSnapshot_inverterId_ts_key" ON "InverterKpiSnapshot"("inverterId", "ts");

-- CreateIndex
CREATE INDEX "InverterStringSnapshot_snapshotId_idx" ON "InverterStringSnapshot"("snapshotId");

-- CreateIndex
CREATE UNIQUE INDEX "InverterStringSnapshot_snapshotId_stringNo_key" ON "InverterStringSnapshot"("snapshotId", "stringNo");

-- AddForeignKey
ALTER TABLE "Site" ADD CONSTRAINT "Site_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inverter" ADD CONSTRAINT "Inverter_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobAttachment" ADD CONSTRAINT "JobAttachment_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransaction" ADD CONSTRAINT "StockTransaction_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransaction" ADD CONSTRAINT "StockTransaction_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteDailyEnergy" ADD CONSTRAINT "SiteDailyEnergy_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alarm" ADD CONSTRAINT "Alarm_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alarm" ADD CONSTRAINT "Alarm_inverterId_fkey" FOREIGN KEY ("inverterId") REFERENCES "Inverter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InverterKpiSnapshot" ADD CONSTRAINT "InverterKpiSnapshot_inverterId_fkey" FOREIGN KEY ("inverterId") REFERENCES "Inverter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InverterStringSnapshot" ADD CONSTRAINT "InverterStringSnapshot_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "InverterKpiSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
