-- CreateTable
CREATE TABLE "AuxDeviceSnapshot" (
    "id" SERIAL NOT NULL,
    "siteId" INTEGER NOT NULL,
    "plantCode" TEXT NOT NULL,
    "huaweiDevId" TEXT NOT NULL,
    "huaweiDevTypeId" INTEGER NOT NULL,
    "dataItemMap" JSONB,
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuxDeviceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteHourlyKpi" (
    "id" SERIAL NOT NULL,
    "siteId" INTEGER NOT NULL,
    "plantCode" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL,
    "collectTime" DOUBLE PRECISION,
    "production" DOUBLE PRECISION,
    "irradiation" DOUBLE PRECISION,
    "gridImport" DOUBLE PRECISION,
    "gridExport" DOUBLE PRECISION,
    "consumption" DOUBLE PRECISION,
    "consumedFromPv" DOUBLE PRECISION,
    "batteryCharge" DOUBLE PRECISION,
    "batteryDischarge" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteHourlyKpi_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuxDeviceSnapshot_plantCode_huaweiDevTypeId_idx" ON "AuxDeviceSnapshot"("plantCode", "huaweiDevTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "AuxDeviceSnapshot_siteId_huaweiDevId_key" ON "AuxDeviceSnapshot"("siteId", "huaweiDevId");

-- CreateIndex
CREATE INDEX "SiteHourlyKpi_plantCode_ts_idx" ON "SiteHourlyKpi"("plantCode", "ts");

-- CreateIndex
CREATE UNIQUE INDEX "SiteHourlyKpi_siteId_ts_key" ON "SiteHourlyKpi"("siteId", "ts");

-- AddForeignKey
ALTER TABLE "AuxDeviceSnapshot" ADD CONSTRAINT "AuxDeviceSnapshot_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteHourlyKpi" ADD CONSTRAINT "SiteHourlyKpi_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
