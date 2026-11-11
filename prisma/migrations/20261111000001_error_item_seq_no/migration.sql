-- 错题流水号：每个用户的错题按创建时间从 1000 起编号，用户记录已分配的最大编号（尚无错题时为 999）
ALTER TABLE "User" ADD COLUMN "errorItemSeq" INTEGER NOT NULL DEFAULT 999;
ALTER TABLE "ErrorItem" ADD COLUMN "seqNo" INTEGER;

-- 已有错题按创建时间（同时间按 id）补编号
UPDATE "ErrorItem" SET "seqNo" = 999 + (
    SELECT COUNT(*) FROM "ErrorItem" AS "earlier"
    WHERE "earlier"."userId" = "ErrorItem"."userId"
      AND ("earlier"."createdAt" < "ErrorItem"."createdAt"
        OR ("earlier"."createdAt" = "ErrorItem"."createdAt" AND "earlier"."id" <= "ErrorItem"."id"))
);

UPDATE "User" SET "errorItemSeq" = (
    SELECT COALESCE(MAX("seqNo"), 999) FROM "ErrorItem" WHERE "ErrorItem"."userId" = "User"."id"
);

CREATE UNIQUE INDEX "ErrorItem_userId_seqNo_key" ON "ErrorItem"("userId", "seqNo");
