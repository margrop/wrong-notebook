-- 试卷题目保留来源错题的原配图快照，并记录显示来源
ALTER TABLE "ExamQuestion" ADD COLUMN "figureImage" TEXT;
ALTER TABLE "ExamQuestion" ADD COLUMN "figureSource" TEXT NOT NULL DEFAULT 'svg';
