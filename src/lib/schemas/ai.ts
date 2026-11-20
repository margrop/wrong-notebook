/**
 * 导入与 AI 接口的请求体 zod 校验 schema
 */
import { z } from "zod";

/** 旧版 AI 图片接口的请求上限；新导入流程使用更严格的分批图片校验。 */
export const MAX_AI_REQUEST_BODY_BYTES = 16 * 1024 * 1024;
export const MAX_AI_IMAGE_BASE64_LENGTH = 15 * 1024 * 1024;
export const MAX_AI_IMAGE_DECODED_BYTES = 10 * 1024 * 1024;

const ALLOWED_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const DATA_URL_MIME = /^data:([^;]+);base64,/i;
const BASE64_PAYLOAD = /^[A-Za-z0-9+/]*={0,2}$/;

function imagePayloadSize(value: string): number | null {
    if (!BASE64_PAYLOAD.test(value)) return null;
    const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
    return Math.max(0, Math.floor(value.length * 3 / 4) - padding);
}

function validateImagePayload(
    value: { imageBase64?: string | null; mimeType?: string | null },
    ctx: z.RefinementCtx,
): void {
    const image = value.imageBase64;
    if (!image) return;

    const dataUrl = image.match(DATA_URL_MIME);
    const mimeType = (dataUrl?.[1] ?? value.mimeType ?? 'image/jpeg').toLowerCase();
    if (!ALLOWED_IMAGE_MIME_TYPES.has(mimeType)) {
        ctx.addIssue({ code: 'custom', path: ['mimeType'], message: 'IMAGE_MIME_UNSUPPORTED' });
        return;
    }

    const payload = dataUrl ? image.slice(dataUrl[0].length) : image;
    const decodedBytes = imagePayloadSize(payload);
    if (decodedBytes !== null && decodedBytes > MAX_AI_IMAGE_DECODED_BYTES) {
        ctx.addIssue({ code: 'custom', path: ['imageBase64'], message: 'IMAGE_TOO_LARGE' });
    }
}

/** 可选文本：前端可能把空值以 null 提交，统一按未提供处理 */
const optionalText = (max: number) => z.string().max(max).nullish().transform((value) => value ?? undefined);

/** 界面语言：缺省或非法时按未提供处理，由路由使用默认值 */
const optionalLanguage = z.enum(['zh', 'en']).optional().catch(undefined);

/** POST /api/analyze 请求体 */
export const analyzeBodySchema = z.object({
    imageBase64: z.string().min(1).max(MAX_AI_IMAGE_BASE64_LENGTH),
    language: optionalLanguage,
    subjectId: optionalText(100),
    mimeType: optionalText(100),
}).superRefine(validateImagePayload);

/** POST /api/reanswer 请求体 */
export const reanswerBodySchema = z.object({
    questionText: z.string().max(100_000).refine((value) => value.trim().length > 0),
    language: optionalLanguage,
    subject: optionalText(200),
    imageBase64: z.string().max(MAX_AI_IMAGE_BASE64_LENGTH).nullish().transform((value) => value ?? undefined),
    gradeSemester: optionalText(100),
    subjectId: optionalText(100),
    forImport: z.boolean().optional(),
}).superRefine(validateImagePayload);

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
