/**
 * 完整备份导入的体积上限（字节），服务端校验与网页预检共用。
 * 导出文件含题目原图、待校对任务图片与云端语音，常见几十 MB；上限按同一用户数百道题的备份留余量。
 */
export const MAX_BACKUP_IMPORT_BYTES = 256 * 1024 * 1024;

/** 备份解析阶段的结构上限，防止合法体积内的数组放大内存与事务开销。 */
export const MAX_BACKUP_ERROR_ITEMS = 100_000;
export const MAX_BACKUP_TAGS = 500_000;
export const MAX_BACKUP_REVIEW_SCHEDULES = 500_000;
export const MAX_BACKUP_PRACTICE_RECORDS = 1_000_000;
export const MAX_BACKUP_PRACTICE_QUESTIONS = 100_000;
export const MAX_BACKUP_EXAM_PAPERS = 20_000;
export const MAX_BACKUP_EXAM_QUESTIONS = 500_000;
export const MAX_BACKUP_PAPER_GROUPS = 100_000;
export const MAX_BACKUP_QUESTION_BANKS = 1_000;
export const MAX_BACKUP_BANK_QUESTIONS = 1_000_000;
