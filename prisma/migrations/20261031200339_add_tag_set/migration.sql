-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_KnowledgeTag" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "parentId" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "code" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "userId" TEXT,
    "tagSet" TEXT NOT NULL DEFAULT 'default',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "KnowledgeTag_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "KnowledgeTag" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "KnowledgeTag_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_KnowledgeTag" ("code", "createdAt", "id", "isSystem", "name", "order", "parentId", "subject", "updatedAt", "userId") SELECT "code", "createdAt", "id", "isSystem", "name", "order", "parentId", "subject", "updatedAt", "userId" FROM "KnowledgeTag";
DROP TABLE "KnowledgeTag";
ALTER TABLE "new_KnowledgeTag" RENAME TO "KnowledgeTag";
CREATE INDEX "KnowledgeTag_parentId_idx" ON "KnowledgeTag"("parentId");
CREATE INDEX "KnowledgeTag_subject_idx" ON "KnowledgeTag"("subject");
CREATE INDEX "KnowledgeTag_tagSet_idx" ON "KnowledgeTag"("tagSet");
CREATE UNIQUE INDEX "KnowledgeTag_subject_name_userId_parentId_tagSet_key" ON "KnowledgeTag"("subject", "name", "userId", "parentId", "tagSet");
CREATE TABLE "new_Subject" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'primary',
    "subjectKey" TEXT,
    "tagSet" TEXT NOT NULL DEFAULT 'default',
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Subject_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Subject" ("createdAt", "id", "name", "stage", "subjectKey", "updatedAt", "userId") SELECT "createdAt", "id", "name", "stage", "subjectKey", "updatedAt", "userId" FROM "Subject";
DROP TABLE "Subject";
ALTER TABLE "new_Subject" RENAME TO "Subject";
CREATE INDEX "Subject_userId_idx" ON "Subject"("userId");
CREATE UNIQUE INDEX "Subject_name_userId_key" ON "Subject"("name", "userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
