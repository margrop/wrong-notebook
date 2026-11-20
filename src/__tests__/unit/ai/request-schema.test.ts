import { describe, expect, it } from 'vitest';
import { analyzeBodySchema, MAX_AI_IMAGE_BASE64_LENGTH, reanswerBodySchema } from '@/lib/schemas/ai';

describe('旧 AI 图片接口请求体限制', () => {
    it('接受纯 base64 和常见图片 data URL', () => {
        expect(analyzeBodySchema.safeParse({ imageBase64: 'dGVzdA==', mimeType: 'image/jpeg' }).success).toBe(true);
        expect(analyzeBodySchema.safeParse({ imageBase64: 'data:image/png;base64,test' }).success).toBe(true);
    });

    it('拒绝超长图片字符串', () => {
        const imageBase64 = 'A'.repeat(MAX_AI_IMAGE_BASE64_LENGTH + 1);
        expect(analyzeBodySchema.safeParse({ imageBase64 }).success).toBe(false);
        expect(reanswerBodySchema.safeParse({ questionText: '题目', imageBase64 }).success).toBe(false);
    });

    it('拒绝不支持的图片 MIME 类型', () => {
        const result = analyzeBodySchema.safeParse({ imageBase64: 'data:image/svg+xml;base64,test' });
        expect(result.success).toBe(false);
        if (!result.success) expect(result.error.issues[0]?.message).toBe('IMAGE_MIME_UNSUPPORTED');
    });
});
