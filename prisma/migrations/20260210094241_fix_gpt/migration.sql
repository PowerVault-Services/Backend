-- AlterTable
ALTER TABLE "InverterKpiSnapshot" ADD COLUMN     "powerFactor" DOUBLE PRECISION,
ADD COLUMN     "temperature" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "StockTransaction" ADD COLUMN     "insuranceCompany" TEXT,
ADD COLUMN     "insuranceNo" TEXT;

-- CreateIndex
CREATE INDEX "InverterKpiSnapshot_inverterId_ts_idx" ON "InverterKpiSnapshot"("inverterId", "ts");

-- CreateIndex
CREATE INDEX "StockTransaction_type_txDate_idx" ON "StockTransaction"("type", "txDate");

-- CreateIndex
CREATE INDEX "StockTransaction_productId_txDate_idx" ON "StockTransaction"("productId", "txDate");
