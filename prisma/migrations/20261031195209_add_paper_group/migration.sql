-- 创建卷别分组表
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

-- 先迁移卷别数据，保留原表及可能已存在的 figureScale 列。
-- 外键在配图比例迁移完成后，由后续迁移统一补齐，兼容迁移发布时间与名称顺序不一致的旧库。
-- 创建卷别分组索引
CREATE INDEX "PaperGroup_userId_order_idx" ON "PaperGroup"("userId", "order");

-- 创建卷别分组索引
CREATE UNIQUE INDEX "PaperGroup_userId_key_key" ON "PaperGroup"("userId", "key");

-- 创建卷别分组索引
CREATE UNIQUE INDEX "PaperGroup_userId_name_key" ON "PaperGroup"("userId", "name");

-- 根据每位用户的旧卷别创建对应的系统分组，保留原有分类。
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

-- 将旧的 a/b/other 值映射到当前用户的分组 ID。
UPDATE "ErrorItem" SET "paperLevel" = (
    SELECT pg."id" FROM "PaperGroup" pg
    WHERE pg."userId" = "ErrorItem"."userId" AND pg."key" = "ErrorItem"."paperLevel"
)
WHERE "paperLevel" IN ('a', 'b', 'other');

-- 无法识别的旧卷别清空为未分类，保留题目及全部关联数据。
UPDATE "ErrorItem" SET "paperLevel" = NULL
WHERE "paperLevel" IS NOT NULL
AND "paperLevel" NOT IN (SELECT "id" FROM "PaperGroup");
