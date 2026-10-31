-- 仅追加账户偏好字段，保留全部账户、错题与关联数据。
ALTER TABLE "User" ADD COLUMN "gradeRecognitionMode" TEXT NOT NULL DEFAULT 'fixed';
ALTER TABLE "User" ADD COLUMN "fixedGradeSemester" TEXT;
