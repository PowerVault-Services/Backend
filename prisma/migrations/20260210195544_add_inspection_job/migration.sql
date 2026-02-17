-- CreateTable
CREATE TABLE "InspectionJob" (
    "jobId" INTEGER NOT NULL,
    "projectName" TEXT,
    "systemSizeKWp" DOUBLE PRECISION,
    "pvModuleEA" INTEGER,
    "locationText" TEXT,
    "projectType" TEXT,
    "contactPhone" TEXT,
    "contactEmail" TEXT,
    "workDate" TIMESTAMP(3),
    "workTimeText" TEXT,
    "customerName" TEXT,
    "note" TEXT,
    "step2EmailTo" TEXT,
    "step2EmailSubject" TEXT,
    "step2EmailBody" TEXT,
    "step2SentAt" TIMESTAMP(3),
    "step2SentByUserId" INTEGER,
    "step3EmailTo" TEXT,
    "step3EmailSubject" TEXT,
    "step3EmailBody" TEXT,
    "reportFileUrl" TEXT,
    "reportCreatedAt" TIMESTAMP(3),
    "step3SentAt" TIMESTAMP(3),
    "step3SentByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InspectionJob_pkey" PRIMARY KEY ("jobId")
);

-- AddForeignKey
ALTER TABLE "InspectionJob" ADD CONSTRAINT "InspectionJob_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
