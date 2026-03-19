-- CreateTable
CREATE TABLE "SiteMonthlyActual" (
    "id" SERIAL NOT NULL,
    "siteId" INTEGER NOT NULL,
    "plantCode" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "collectTime" DOUBLE PRECISION,
    "irradiation" DOUBLE PRECISION,
    "production" DOUBLE PRECISION,
    "pr" DOUBLE PRECISION,
    "gridImport" DOUBLE PRECISION,
    "gridExport" DOUBLE PRECISION,
    "consumption" DOUBLE PRECISION,
    "revenue" DOUBLE PRECISION,
    "selfProvide" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteMonthlyActual_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SiteMonthlyActual_plantCode_year_month_idx" ON "SiteMonthlyActual"("plantCode", "year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "SiteMonthlyActual_siteId_year_month_key" ON "SiteMonthlyActual"("siteId", "year", "month");

-- AddForeignKey
ALTER TABLE "SiteMonthlyActual" ADD CONSTRAINT "SiteMonthlyActual_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
