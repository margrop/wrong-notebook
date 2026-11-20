-- 每日 AI 额度预占计数；运行统计不进入备份
CREATE TABLE "AiDailyUsage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AiDailyUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "AiDailyUsage_userId_day_key" ON "AiDailyUsage"("userId", "day");
CREATE INDEX "AiDailyUsage_userId_day_idx" ON "AiDailyUsage"("userId", "day");
