-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "LayoutType" AS ENUM ('PV_LAYOUT', 'PV_STRING_LAYOUT');

-- AlterEnum
ALTER TYPE "JobType" ADD VALUE 'OM';

-- AlterTable
ALTER TABLE "Site" ADD COLUMN     "codDate" TIMESTAMP(3),
ADD COLUMN     "companyName" TEXT,
ADD COLUMN     "ecpPpa" TEXT,
ADD COLUMN     "freeOmText" TEXT,
ADD COLUMN     "inverterBrand" TEXT,
ADD COLUMN     "inverterCount" INTEGER,
ADD COLUMN     "panelBrand" TEXT,
ADD COLUMN     "panelModel" TEXT,
ADD COLUMN     "panelWatt" DOUBLE PRECISION,
ADD COLUMN     "projectStatus" "ProjectStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "projectTypeText" TEXT,
ADD COLUMN     "remark" TEXT,
ADD COLUMN     "responsiblePerson1" TEXT,
ADD COLUMN     "responsiblePerson2" TEXT,
ADD COLUMN     "siteEngineer" TEXT,
ADD COLUMN     "siteImageUrl" TEXT,
ADD COLUMN     "warrantyEnd" TIMESTAMP(3),
ADD COLUMN     "warrantyOutputPct" DOUBLE PRECISION,
ADD COLUMN     "warrantyStart" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "SiteWarrantySupplierItem" (
    "id" SERIAL NOT NULL,
    "siteId" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "supplierName" TEXT,
    "productName" TEXT,
    "quantity" INTEGER,
    "startWarranty" TIMESTAMP(3),
    "endWarranty" TIMESTAMP(3),
    "warrantyYears" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteWarrantySupplierItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteWarrantyCustomerItem" (
    "id" SERIAL NOT NULL,
    "siteId" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "warrantyYears" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteWarrantyCustomerItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteLayout" (
    "id" SERIAL NOT NULL,
    "siteId" INTEGER NOT NULL,
    "type" "LayoutType" NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteLayout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteForecastMonthly" (
    "id" SERIAL NOT NULL,
    "siteId" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "globalKwhM2" DOUBLE PRECISION,
    "eGridKwh" DOUBLE PRECISION,
    "prRatio" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteForecastMonthly_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteForecastYearly" (
    "id" SERIAL NOT NULL,
    "siteId" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "degradationPct" DOUBLE PRECISION,
    "annualProductionKwh" DOUBLE PRECISION,
    "warrantyEnergyOutputKwh" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteForecastYearly_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteOtherRow" (
    "id" SERIAL NOT NULL,
    "siteId" INTEGER NOT NULL,
    "status" TEXT,
    "description" TEXT,
    "remark" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteOtherRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceEntry" (
    "id" SERIAL NOT NULL,
    "siteId" INTEGER NOT NULL,
    "job" "JobType" NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SiteWarrantySupplierItem_siteId_category_idx" ON "SiteWarrantySupplierItem"("siteId", "category");

-- CreateIndex
CREATE INDEX "SiteWarrantyCustomerItem_siteId_category_idx" ON "SiteWarrantyCustomerItem"("siteId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "SiteLayout_siteId_type_key" ON "SiteLayout"("siteId", "type");

-- CreateIndex
CREATE INDEX "SiteForecastMonthly_siteId_month_idx" ON "SiteForecastMonthly"("siteId", "month");

-- CreateIndex
CREATE UNIQUE INDEX "SiteForecastMonthly_siteId_month_key" ON "SiteForecastMonthly"("siteId", "month");

-- CreateIndex
CREATE INDEX "SiteForecastYearly_siteId_year_idx" ON "SiteForecastYearly"("siteId", "year");

-- CreateIndex
CREATE UNIQUE INDEX "SiteForecastYearly_siteId_year_key" ON "SiteForecastYearly"("siteId", "year");

-- CreateIndex
CREATE INDEX "SiteOtherRow_siteId_idx" ON "SiteOtherRow"("siteId");

-- CreateIndex
CREATE INDEX "ServiceEntry_siteId_job_idx" ON "ServiceEntry"("siteId", "job");

-- AddForeignKey
ALTER TABLE "SiteWarrantySupplierItem" ADD CONSTRAINT "SiteWarrantySupplierItem_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteWarrantyCustomerItem" ADD CONSTRAINT "SiteWarrantyCustomerItem_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteLayout" ADD CONSTRAINT "SiteLayout_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteForecastMonthly" ADD CONSTRAINT "SiteForecastMonthly_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteForecastYearly" ADD CONSTRAINT "SiteForecastYearly_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteOtherRow" ADD CONSTRAINT "SiteOtherRow_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceEntry" ADD CONSTRAINT "ServiceEntry_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
