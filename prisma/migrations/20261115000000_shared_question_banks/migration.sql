-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_QuestionBank" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "stage" TEXT NOT NULL,
    "subjectKey" TEXT,
    "gradeRange" TEXT,
    "source" TEXT,
    "sourceUrl" TEXT,
    "license" TEXT,
    "formatVersion" INTEGER NOT NULL DEFAULT 1,
    "questionCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_QuestionBank" ("createdAt", "description", "formatVersion", "gradeRange", "id", "license", "name", "questionCount", "source", "sourceUrl", "stage", "subjectKey", "updatedAt") SELECT "createdAt", "description", "formatVersion", "gradeRange", "id", "license", "name", "questionCount", "source", "sourceUrl", "stage", "subjectKey", "updatedAt" FROM "QuestionBank";
DROP TABLE "QuestionBank";
ALTER TABLE "new_QuestionBank" RENAME TO "QuestionBank";
CREATE INDEX "QuestionBank_createdAt_idx" ON "QuestionBank"("createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

