-- 识别任务保存拍照时填写的错题来源，校对确认或直接入库时写入错题
ALTER TABLE "ImportTask" ADD COLUMN "source" TEXT;
