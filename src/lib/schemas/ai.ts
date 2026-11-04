/**
 * 导入与 AI 接口的请求体 zod 校验 schema
 */
import { z } from "zod";

/** 可选文本：前端可能把空值以 null 提交，统一按未提供处理 */
const optionalText = (max: number) => z.string().max(max).nullish().transform((value) => value ?? undefined);

/** 界面语言：缺省或非法时按未提供处理，由路由使用默认值 */
const optionalLanguage = z.enum(['zh', 'en']).optional().catch(undefined);

/** POST /api/analyze 请求体 */
export const analyzeBodySchema = z.object({
    imageBase64: z.string().min(1),
    language: optionalLanguage,
    subjectId: optionalText(100),
    mimeType: optionalText(100),
});

/** POST /api/reanswer 请求体 */
export const reanswerBodySchema = z.object({
    questionText: z.string().max(100_000).refine((value) => value.trim().length > 0),
    language: optionalLanguage,
    subject: optionalText(200),
    imageBase64: z.string().nullish().transform((value) => value ?? undefined),
    gradeSemester: optionalText(100),
    subjectId: optionalText(100),
    forImport: z.boolean().optional(),
});

/** POST /api/geogebra-analyze 请求体 */
export const geogebraAnalyzeBodySchema = z.object({
    questionText: z.string().max(100_000).refine((value) => value.trim().length > 0),
    answerText: optionalText(100_000),
    analysis: optionalText(100_000),
});

/** POST /api/ai/test 请求体（管理员测试 AI 连接） */
export const aiTestBodySchema = z.object({
    provider: z.string().min(1).max(50),
    apiKey: optionalText(500),
    baseUrl: optionalText(500),
    model: optionalText(200),
    endpoint: optionalText(500),
    deploymentName: optionalText(200),
    apiVersion: optionalText(50),
    language: optionalLanguage,
});

/** POST /api/ai/models 请求体（管理员拉取模型列表） */
export const aiModelsBodySchema = z.object({
    provider: z.string().min(1).max(50).optional(),
    apiKey: z.string().min(1).max(500),
    baseUrl: optionalText(500),
});
