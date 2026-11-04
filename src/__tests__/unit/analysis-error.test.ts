import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api-client';
import { getAnalysisErrorMessage } from '@/lib/question/analysis-error';
import { translations } from '@/lib/translations';

const t = translations.zh;

describe('题目识别失败提示', () => {
    it('已知错误码显示对应文案', () => {
        expect(getAnalysisErrorMessage(new ApiError(500, 'Error', { message: 'AI_TIMEOUT_ERROR' }), t)).toBe(t.errors.AI_TIMEOUT_ERROR);
    });

    it('未知的后端消息直接显示', () => {
        expect(getAnalysisErrorMessage(new ApiError(400, 'Bad Request', { message: '图片过大' }), t)).toBe('图片过大');
    });

    it('网络错误提示连接失败', () => {
        expect(getAnalysisErrorMessage(new TypeError('Failed to fetch'), t)).toBe(t.errors.AI_CONNECTION_FAILED);
    });

    it('响应体为文本时附上状态码', () => {
        expect(getAnalysisErrorMessage(new ApiError(502, 'Bad Gateway', '<html>'), t)).toBe(`${t.common.messages.analysisFailed} (502)`);
    });

    it('其他错误显示通用提示', () => {
        expect(getAnalysisErrorMessage(new Error('boom'), t)).toBe(t.common.messages.analysisFailed);
    });
});
