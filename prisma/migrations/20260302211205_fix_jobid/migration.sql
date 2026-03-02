/*
  Warnings:

  - You are about to drop the column `deviceReplacementRecord` on the `Inverter` table. All the data in the column will be lost.
  - You are about to drop the column `softwareVersion` on the `Inverter` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Inverter" DROP COLUMN "deviceReplacementRecord",
DROP COLUMN "softwareVersion";
