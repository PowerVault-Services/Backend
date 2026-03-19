-- CreateTable
CREATE TABLE "huawei_sync_jobs" (
    "id" SERIAL NOT NULL,
    "jobName" TEXT NOT NULL,
    "running" BOOLEAN NOT NULL DEFAULT false,
    "lastStartAt" TIMESTAMP(3),
    "lastEndAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastErrorAt" TIMESTAMP(3),
    "lastError" TEXT,
    "lastResult" JSONB,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "huawei_sync_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "huawei_sync_stations" (
    "id" SERIAL NOT NULL,
    "kind" TEXT NOT NULL,
    "stationCode" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "huawei_sync_stations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "huawei_sync_jobs_jobName_key" ON "huawei_sync_jobs"("jobName");

-- CreateIndex
CREATE INDEX "huawei_sync_stations_kind_lastSeenAt_idx" ON "huawei_sync_stations"("kind", "lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "huawei_sync_stations_kind_stationCode_key" ON "huawei_sync_stations"("kind", "stationCode");
