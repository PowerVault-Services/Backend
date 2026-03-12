-- AlterTable
ALTER TABLE "Inverter" ADD COLUMN     "deviceReplacementRecord" TEXT,
ADD COLUMN     "huaweiDevTypeId" INTEGER,
ADD COLUMN     "softwareVersion" TEXT;

-- AlterTable
ALTER TABLE "Site" ADD COLUMN     "currentPowerKW" DOUBLE PRECISION,
ADD COLUMN     "dayEnergyKWh" DOUBLE PRECISION,
ADD COLUMN     "dayIncome" DOUBLE PRECISION,
ADD COLUMN     "dayOnGridEnergyKWh" DOUBLE PRECISION,
ADD COLUMN     "dayUseEnergyKWh" DOUBLE PRECISION,
ADD COLUMN     "deviceMetaSyncedAt" TIMESTAMP(3),
ADD COLUMN     "gridConnectionDate" TIMESTAMP(3),
ADD COLUMN     "lastPlantSyncAt" TIMESTAMP(3),
ADD COLUMN     "monthEnergyKWh" DOUBLE PRECISION,
ADD COLUMN     "plantHealthState" INTEGER,
ADD COLUMN     "siteMetaSyncedAt" TIMESTAMP(3),
ADD COLUMN     "siteRealtimeRaw" JSONB,
ADD COLUMN     "totalEnergyKWh" DOUBLE PRECISION,
ADD COLUMN     "totalIncome" DOUBLE PRECISION;
