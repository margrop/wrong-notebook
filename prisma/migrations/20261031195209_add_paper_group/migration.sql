-- CreateTable
CREATE TABLE "PaperGroup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "key" TEXT,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PaperGroup_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ErrorItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shortId" TEXT,
    "userId" TEXT NOT NULL,
    "subjectId" TEXT,
    "originalImageUrl" TEXT NOT NULL,
    "ocrText" TEXT,
    "questionText" TEXT,
    "answerText" TEXT,
    "analysis" TEXT,
    "wrongAnswerText" TEXT,
    "mistakeAnalysis" TEXT,
    "mistakeStatus" TEXT,
    "knowledgePoints" TEXT,
    "geogebraCommands" TEXT,
    "svgAnimation" TEXT,
    "svgAnimationEn" TEXT,
    "source" TEXT,
    "errorType" TEXT,
    "userNotes" TEXT,
    "masteryLevel" INTEGER NOT NULL DEFAULT 0,
    "gradeSemester" TEXT,
    "paperLevel" TEXT,
    "difficultyStars" INTEGER,
    "hasFigure" BOOLEAN NOT NULL DEFAULT false,
    "figureSvg" TEXT,
    "figureScale" INTEGER NOT NULL DEFAULT 100,
    "lastPractice" TEXT,
    "masteryProbability" REAL,
    "masteryReason" TEXT,
    "masterySource" TEXT,
    "masteryEvaluatedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ErrorItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ErrorItem_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ErrorItem_paperLevel_fkey" FOREIGN KEY ("paperLevel") REFERENCES "PaperGroup" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ErrorItem" ("analysis", "answerText", "createdAt", "difficultyStars", "errorType", "figureSvg", "figureScale", "geogebraCommands", "gradeSemester", "hasFigure", "id", "knowledgePoints", "lastPractice", "masteryEvaluatedAt", "masteryLevel", "masteryProbability", "masteryReason", "masterySource", "mistakeAnalysis", "mistakeStatus", "ocrText", "originalImageUrl", "paperLevel", "questionText", "shortId", "source", "subjectId", "svgAnimation", "svgAnimationEn", "updatedAt", "userId", "userNotes", "wrongAnswerText") SELECT "analysis", "answerText", "createdAt", "difficultyStars", "errorType", "figureSvg", COALESCE("figureScale", 100), "geogebraCommands", "gradeSemester", "hasFigure", "id", "knowledgePoints", "lastPractice", "masteryEvaluatedAt", "masteryLevel", "masteryProbability", "masteryReason", "masterySource", "mistakeAnalysis", "mistakeStatus", "ocrText", "originalImageUrl", "paperLevel", "questionText", "shortId", "source", "subjectId", "svgAnimation", "svgAnimationEn", "updatedAt", "userId", "userNotes", "wrongAnswerText" FROM "ErrorItem";
DROP TABLE "ErrorItem";
ALTER TABLE "new_ErrorItem" RENAME TO "ErrorItem";
CREATE UNIQUE INDEX "ErrorItem_shortId_key" ON "ErrorItem"("shortId");
CREATE INDEX "ErrorItem_userId_createdAt_idx" ON "ErrorItem"("userId", "createdAt");
CREATE INDEX "ErrorItem_subjectId_idx" ON "ErrorItem"("subjectId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "PaperGroup_userId_order_idx" ON "PaperGroup"("userId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "PaperGroup_userId_key_key" ON "PaperGroup"("userId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "PaperGroup_userId_name_key" ON "PaperGroup"("userId", "name");

-- Data migration: create default paper groups for each user and translate old paperLevel values
-- 1. Create system groups (key='a','b','other') for every user who has error items
INSERT INTO "PaperGroup" ("id", "userId", "key", "name", "order", "isActive", "createdAt", "updatedAt")
SELECT
    lower(hex(randomblob(16))),
    "userId",
    "key",
    CASE "key" WHEN 'a' THEN 'A卷' WHEN 'b' THEN 'B卷' ELSE '其他' END,
    CASE "key" WHEN 'a' THEN 0 WHEN 'b' THEN 1 ELSE 2 END,
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM (
    SELECT DISTINCT "userId", 'a' AS "key" FROM "ErrorItem" WHERE "paperLevel" = 'a'
    UNION
    SELECT DISTINCT "userId", 'b' AS "key" FROM "ErrorItem" WHERE "paperLevel" = 'b'
    UNION
    SELECT DISTINCT "userId", 'other' AS "key" FROM "ErrorItem" WHERE "paperLevel" = 'other'
) t
WHERE NOT EXISTS (
    SELECT 1 FROM "PaperGroup" pg WHERE pg."userId" = t."userId" AND pg."key" = t."key"
);

-- 2. Translate ErrorItem.paperLevel from 'a'/'b'/'other' to PaperGroup.id
UPDATE "ErrorItem" SET "paperLevel" = (
    SELECT pg."id" FROM "PaperGroup" pg
    WHERE pg."userId" = "ErrorItem"."userId" AND pg."key" = "ErrorItem"."paperLevel"
)
WHERE "paperLevel" IN ('a', 'b', 'other');

-- 3. Defensive: set any remaining unrecognized paperLevel to NULL
UPDATE "ErrorItem" SET "paperLevel" = NULL
WHERE "paperLevel" IS NOT NULL
AND "paperLevel" NOT IN (SELECT "id" FROM "PaperGroup");
