-- CreateTable
CREATE TABLE "ServiceJob" (
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
    "step3Meta" JSONB,
    "reportFileUrl" TEXT,
    "reportCreatedAt" TIMESTAMP(3),
    "step5EmailTo" TEXT,
    "step5EmailSubject" TEXT,
    "step5EmailBody" TEXT,
    "step5SentAt" TIMESTAMP(3),
    "step5SentByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceJob_pkey" PRIMARY KEY ("jobId")
);

-- AddForeignKey
ALTER TABLE "ServiceJob" ADD CONSTRAINT "ServiceJob_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
