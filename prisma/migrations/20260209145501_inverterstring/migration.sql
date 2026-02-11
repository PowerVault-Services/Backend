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
CREATE INDEX "InverterStringSnapshot_snapshotId_idx" ON "InverterStringSnapshot"("snapshotId");

-- CreateIndex
CREATE UNIQUE INDEX "InverterStringSnapshot_snapshotId_stringNo_key" ON "InverterStringSnapshot"("snapshotId", "stringNo");

-- AddForeignKey
ALTER TABLE "InverterStringSnapshot" ADD CONSTRAINT "InverterStringSnapshot_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "InverterKpiSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
