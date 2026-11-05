-- 用户同意把题目等数据发送给第三方 AI 服务商的时间，为空表示尚未同意
ALTER TABLE "User" ADD COLUMN "aiDataConsentAt" DATETIME;
