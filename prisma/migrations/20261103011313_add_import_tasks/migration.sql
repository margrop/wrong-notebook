-- CreateTable
CREATE TABLE "ImportTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "clientRequestId" TEXT,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'analyzing',
    "language" TEXT NOT NULL DEFAULT 'zh',
    "subjectId" TEXT,
    "targetSubjectId" TEXT,
    "paperLevel" TEXT,
    "imageData" TEXT NOT NULL,
    "imageInfo" TEXT,
    "result" TEXT,
    "errorItemId" TEXT,
    "duplicate" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "timings" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "runnerId" TEXT,
    "heartbeatAt" DATETIME,
    "readAt" DATETIME,
    "finishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ImportTask_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ImportTask_errorItemId_fkey" FOREIGN KEY ("errorItemId") REFERENCES "ErrorItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ImportTask_userId_status_idx" ON "ImportTask"("userId", "status");

-- CreateIndex
CREATE INDEX "ImportTask_errorItemId_idx" ON "ImportTask"("errorItemId");

-- CreateIndex
CREATE UNIQUE INDEX "ImportTask_userId_clientRequestId_key" ON "ImportTask"("userId", "clientRequestId");
