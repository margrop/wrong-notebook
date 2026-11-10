-- CreateTable
CREATE TABLE "QuestionBank" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
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
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "QuestionBank_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BankQuestion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bankId" TEXT NOT NULL,
    "externalId" TEXT,
    "stage" TEXT NOT NULL,
    "subjectKey" TEXT,
    "grade" INTEGER,
    "semester" TEXT,
    "questionType" TEXT,
    "difficultyStars" INTEGER,
    "text" TEXT NOT NULL,
    "material" TEXT,
    "optionsJson" TEXT,
    "answer" TEXT,
    "analysis" TEXT,
    "knowledgePoints" TEXT,
    "source" TEXT,
    "figureSvg" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BankQuestion_bankId_fkey" FOREIGN KEY ("bankId") REFERENCES "QuestionBank" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "QuestionBank_userId_createdAt_idx" ON "QuestionBank"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionBank_userId_name_key" ON "QuestionBank"("userId", "name");

-- CreateIndex
CREATE INDEX "BankQuestion_bankId_stage_subjectKey_idx" ON "BankQuestion"("bankId", "stage", "subjectKey");

-- CreateIndex
CREATE INDEX "BankQuestion_bankId_grade_idx" ON "BankQuestion"("bankId", "grade");

