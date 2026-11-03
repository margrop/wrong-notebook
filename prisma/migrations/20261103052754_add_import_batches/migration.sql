-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "clientRequestId" TEXT,
    "source" TEXT NOT NULL,
    "splitter" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "mode" TEXT,
    "language" TEXT NOT NULL DEFAULT 'zh',
    "subjectId" TEXT,
    "targetSubjectId" TEXT,
    "paperLevel" TEXT,
    "sourceText" TEXT,
    "imageData" TEXT NOT NULL DEFAULT '',
    "imageInfo" TEXT,
    "draft" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "runnerId" TEXT,
    "heartbeatAt" DATETIME,
    "readAt" DATETIME,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ImportBatch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ImportTask" (
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
    "batchId" TEXT,
    "batchItemKey" TEXT,
    "inputText" TEXT,
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
    CONSTRAINT "ImportTask_errorItemId_fkey" FOREIGN KEY ("errorItemId") REFERENCES "ErrorItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ImportTask_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImportBatch" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ImportTask" ("attempts", "clientRequestId", "createdAt", "duplicate", "error", "errorItemId", "finishedAt", "heartbeatAt", "id", "imageData", "imageInfo", "language", "mode", "paperLevel", "readAt", "result", "runnerId", "status", "subjectId", "targetSubjectId", "timings", "updatedAt", "userId") SELECT "attempts", "clientRequestId", "createdAt", "duplicate", "error", "errorItemId", "finishedAt", "heartbeatAt", "id", "imageData", "imageInfo", "language", "mode", "paperLevel", "readAt", "result", "runnerId", "status", "subjectId", "targetSubjectId", "timings", "updatedAt", "userId" FROM "ImportTask";
DROP TABLE "ImportTask";
ALTER TABLE "new_ImportTask" RENAME TO "ImportTask";
CREATE INDEX "ImportTask_userId_status_idx" ON "ImportTask"("userId", "status");
CREATE INDEX "ImportTask_errorItemId_idx" ON "ImportTask"("errorItemId");
CREATE INDEX "ImportTask_batchId_idx" ON "ImportTask"("batchId");
CREATE UNIQUE INDEX "ImportTask_userId_clientRequestId_key" ON "ImportTask"("userId", "clientRequestId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "ImportBatch_userId_status_idx" ON "ImportBatch"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ImportBatch_userId_clientRequestId_key" ON "ImportBatch"("userId", "clientRequestId");
