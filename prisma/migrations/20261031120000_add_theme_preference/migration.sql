-- 仅新增列：用户界面主题偏好（system 跟随系统、light 浅色、dark 深色），默认跟随系统，不影响已有数据。
ALTER TABLE "User" ADD COLUMN "themePreference" TEXT NOT NULL DEFAULT 'system';
