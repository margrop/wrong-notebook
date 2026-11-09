-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "educationStage" TEXT,
    "enrollmentYear" INTEGER,
    "gradeRecognitionMode" TEXT NOT NULL DEFAULT 'fixed',
    "fixedGradeSemester" TEXT,
    "role" TEXT NOT NULL DEFAULT 'user',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "confirmBeforeImport" BOOLEAN NOT NULL DEFAULT true,
    "questionDuplicateThreshold" REAL NOT NULL DEFAULT 90,
    "masteryThreshold" INTEGER NOT NULL DEFAULT 50,
    "enableGeogebra" BOOLEAN NOT NULL DEFAULT false,
    "enableSvgAnimation" BOOLEAN NOT NULL DEFAULT true,
    "themePreference" TEXT NOT NULL DEFAULT 'system',
    "aiDataConsentAt" DATETIME
);
INSERT INTO "new_User" ("aiDataConsentAt", "confirmBeforeImport", "createdAt", "educationStage", "email", "enableGeogebra", "enableSvgAnimation", "enrollmentYear", "fixedGradeSemester", "gradeRecognitionMode", "id", "isActive", "masteryThreshold", "name", "password", "questionDuplicateThreshold", "role", "themePreference", "updatedAt") SELECT "aiDataConsentAt", "confirmBeforeImport", "createdAt", "educationStage", "email", "enableGeogebra", "enableSvgAnimation", "enrollmentYear", "fixedGradeSemester", "gradeRecognitionMode", "id", "isActive", "masteryThreshold", "name", "password", "questionDuplicateThreshold", "role", "themePreference", "updatedAt" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- 识别错误较多：升级后已有账户也默认先人工核对，可在设置中关闭
UPDATE "User" SET "confirmBeforeImport" = true WHERE "confirmBeforeImport" = false;
