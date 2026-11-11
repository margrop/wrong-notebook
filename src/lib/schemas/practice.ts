import { z } from "zod";

const DIFFICULTIES = ["easy", "medium", "hard", "harder"] as const;

/** POST /api/practice/generate 请求体 */
export const generatePracticeSchema = z.object({
    errorItemId: z.string().trim().min(1),
    language: z.enum(["zh", "en"]).optional(),
    difficulty: z.enum(DIFFICULTIES).optional(),
    // ai 按错题生成变式题；bank 按知识点从已导入的真题库选题；bankVariant 先选题库题目，再据此生成变式题
    source: z.enum(["ai", "bank", "bankVariant"]).optional(),
    bankId: z.string().trim().min(1).optional(),
});

/** GET /api/practice/generate 查询参数 */
export const generatePracticeQuerySchema = z.object({
    errorItemId: z.string().trim().min(1),
});

/** GET /api/review/due 查询参数 */
export const reviewDueQuerySchema = z.object({
    subjectId: z.string().trim().min(1).optional(),
    page: z.coerce.number().int().min(1).optional(),
    pageSize: z.coerce.number().int().min(1).optional(),
});
