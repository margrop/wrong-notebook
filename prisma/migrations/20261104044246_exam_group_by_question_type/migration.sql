-- AlterTable
ALTER TABLE "ExamQuestion" ADD COLUMN "questionType" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ExamPaper" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'generating',
    "scope" TEXT NOT NULL,
    "difficulty" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'generate',
    "requestedCount" INTEGER NOT NULL,
    "groupByType" BOOLEAN NOT NULL DEFAULT false,
    "subjectIds" TEXT NOT NULL,
    "tagNames" TEXT,
    "resultsRecordedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ExamPaper_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ExamPaper" ("createdAt", "difficulty", "id", "mode", "requestedCount", "resultsRecordedAt", "scope", "status", "subjectIds", "tagNames", "title", "updatedAt", "userId") SELECT "createdAt", "difficulty", "id", "mode", "requestedCount", "resultsRecordedAt", "scope", "status", "subjectIds", "tagNames", "title", "updatedAt", "userId" FROM "ExamPaper";
DROP TABLE "ExamPaper";
ALTER TABLE "new_ExamPaper" RENAME TO "ExamPaper";
CREATE INDEX "ExamPaper_userId_createdAt_idx" ON "ExamPaper"("userId", "createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
