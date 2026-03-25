-- CreateTable
CREATE TABLE "SiteDailyKpi" (
    "id" SERIAL NOT NULL,
    "siteId" INTEGER NOT NULL,
    "plantCode" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "collectTime" DOUBLE PRECISION,
    "production" DOUBLE PRECISION,
    "irradiation" DOUBLE PRECISION,
    "gridImport" DOUBLE PRECISION,
    "gridExport" DOUBLE PRECISION,
    "consumption" DOUBLE PRECISION,
    "revenue" DOUBLE PRECISION,
    "selfProvide" DOUBLE PRECISION,
    "batteryCharge" DOUBLE PRECISION,
    "batteryDischarge" DOUBLE PRECISION,
    "moduleTempC" DOUBLE PRECISION,
    "downTimeClientHours" DOUBLE PRECISION,
    "pr" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteDailyKpi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuxDevice" (
    "id" SERIAL NOT NULL,
    "siteId" INTEGER NOT NULL,
    "plantCode" TEXT NOT NULL,
    "huaweiDevId" TEXT NOT NULL,
    "huaweiDevTypeId" INTEGER NOT NULL,
    "devName" TEXT,
    "model" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuxDevice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SiteDailyKpi_siteId_date_key" ON "SiteDailyKpi"("siteId", "date");

-- CreateIndex
CREATE INDEX "SiteDailyKpi_plantCode_date_idx" ON "SiteDailyKpi"("plantCode", "date");

-- CreateIndex
CREATE UNIQUE INDEX "AuxDevice_siteId_huaweiDevId_key" ON "AuxDevice"("siteId", "huaweiDevId");

-- CreateIndex
CREATE INDEX "AuxDevice_plantCode_huaweiDevTypeId_idx" ON "AuxDevice"("plantCode", "huaweiDevTypeId");

-- AddForeignKey
ALTER TABLE "SiteDailyKpi" ADD CONSTRAINT "SiteDailyKpi_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuxDevice" ADD CONSTRAINT "AuxDevice_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
