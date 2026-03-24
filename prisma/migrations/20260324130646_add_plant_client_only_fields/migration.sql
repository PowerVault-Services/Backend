-- AlterTable
ALTER TABLE "Site" ADD COLUMN     "installationContractor" TEXT,
ADD COLUMN     "isClientOnly" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "locationProvince" TEXT,
ADD COLUMN     "salePerson" TEXT,
ADD COLUMN     "workEntryConditions" TEXT;
