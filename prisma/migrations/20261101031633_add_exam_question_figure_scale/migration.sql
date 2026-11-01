-- 仅追加配图位置与试卷题目配图比例列，保留已有错题、试卷题目与作答记录。
ALTER TABLE "ErrorItem" ADD COLUMN "figureAlign" TEXT NOT NULL DEFAULT 'center';
ALTER TABLE "ExamQuestion" ADD COLUMN "figureScale" INTEGER NOT NULL DEFAULT 100;
ALTER TABLE "ExamQuestion" ADD COLUMN "figureAlign" TEXT NOT NULL DEFAULT 'center';
