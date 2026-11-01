-- 仅追加比例列，保留旧题、关联记录和现有数据库中的其他字段。
ALTER TABLE "ErrorItem" ADD COLUMN "figureScale" INTEGER NOT NULL DEFAULT 100;
