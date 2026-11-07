/**
 * 渠道分工与备用渠道：识别/文本分别选渠道、额度或凭据失败时改用备用渠道、用量记在实际使用的渠道名下
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    openaiOptions: [] as Array<{ apiKey?: string; baseURL?: string }>,
    create: vi.fn(),
    getAppConfig: vi.fn(),
}));

vi.mock('openai', async () => {
    const { sdkMethod } = await import('../../helpers/sdk-response');
    return {
        default: class MockOpenAI {
            chat = { completions: { create: sdkMethod(mocks.create) } };
            constructor(options: { apiKey?: string; baseURL?: string }) {
                mocks.openaiOptions.push(options);
            }
        },
    };
});
vi.mock('@/lib/logger', () => ({
    createLogger: vi.fn(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), box: vi.fn(), divider: vi.fn() })),
}));
vi.mock('@/lib/config', () => ({ getAppConfig: mocks.getAppConfig, getActiveOpenAIConfig: vi.fn() }));
vi.mock('@/lib/ai/usage', () => ({ recordAiCompletion: vi.fn() }));

import { getAIService } from '@/lib/ai';
import { resolveProviderAssignment, routeRole } from '@/lib/ai/routing';
import type { AppConfig } from '@/types/api';

const reply = (content: string) => ({ choices: [{ finish_reason: 'stop', message: { content } }] });
const TAGS = JSON.stringify({ tags: ['加法'], difficultyStars: 1 });
const GRADED = '{"correct":true,"reason":"一致"}';

const baseConfig = (overrides: Partial<AppConfig>): AppConfig => ({
    aiProvider: 'deepseek',
    deepseek: { apiKey: 'deepseek-key' },
    glm: { apiKey: 'glm-key' },
    prompts: {},
    ...overrides,
});

beforeEach(() => {
    vi.clearAllMocks();
    mocks.openaiOptions.length = 0;
    mocks.create.mockReset();
    mocks.create.mockResolvedValue(reply(TAGS));
});

describe('resolveProviderAssignment', () => {
    it('未设置分工时识别与文本都跟随默认渠道，且不启用备用渠道', () => {
        const config = baseConfig({});

        expect(resolveProviderAssignment(config, 'vision')).toEqual({ primary: 'deepseek', fallback: null });
        expect(resolveProviderAssignment(config, 'text')).toEqual({ primary: 'deepseek', fallback: null });
    });

    it('识别与文本可分别指定渠道', () => {
        const config = baseConfig({ routing: { vision: 'glm', text: 'deepseek' } });

        expect(resolveProviderAssignment(config, 'vision').primary).toBe('glm');
        expect(resolveProviderAssignment(config, 'text').primary).toBe('deepseek');
    });

    it('备用渠道与主渠道相同时不启用', () => {
        const config = baseConfig({ routing: { text: 'deepseek', fallback: 'deepseek' } });

        expect(resolveProviderAssignment(config, 'text').fallback).toBeNull();
    });

    it('备用渠道未填写密钥时视为未配置，不启用', () => {
        const config = baseConfig({ routing: { text: 'deepseek', fallback: 'glm' } });
        delete config.glm;

        expect(resolveProviderAssignment(config, 'text').fallback).toBeNull();
    });

    it('未知渠道取值回退到默认渠道', () => {
        const config = baseConfig({ routing: { vision: 'not-a-provider' as never } });

        expect(resolveProviderAssignment(config, 'vision').primary).toBe('deepseek');
    });
});

describe('routeRole', () => {
    it('图片相关的调用走识别渠道，其余走文本渠道', () => {
        expect(routeRole('analyze')).toBe('vision');
        expect(routeRole('figure')).toBe('vision');
        expect(routeRole('split')).toBe('vision');
        expect(routeRole('grading')).toBe('text');
        expect(routeRole('similar')).toBe('text');
    });

    it('调用方明确是否带图时以调用方为准', () => {
        expect(routeRole('reanswer', { hasImage: true })).toBe('vision');
        expect(routeRole('reanswer', { hasImage: false })).toBe('text');
    });
});

describe('getAIService 渠道分工', () => {
    it('文本分析使用文本渠道，识别使用识别渠道', async () => {
        mocks.getAppConfig.mockReturnValue(baseConfig({ routing: { vision: 'glm', text: 'deepseek' } }));

        mocks.create.mockResolvedValueOnce(reply(GRADED)).mockResolvedValueOnce(reply('<has_figure>false</has_figure>'));

        const ai = await getAIService({ userId: 'u1', kind: 'grade' });
        await ai.gradeAnswer({ questionText: 'q', answerText: 'a', userAnswer: 'a' });
        await ai.generateFigureSvg('aW1hZ2U=', 'image/png', 'q');

        expect(mocks.openaiOptions).toEqual([
            expect.objectContaining({ apiKey: 'deepseek-key' }),
            expect.objectContaining({ apiKey: 'glm-key' }),
        ]);
    });

    it('只按图片调用的方法使用识别渠道，文本方法不会创建识别渠道', async () => {
        mocks.getAppConfig.mockReturnValue(baseConfig({ routing: { vision: 'glm', text: 'deepseek' } }));

        mocks.create.mockResolvedValue(reply(GRADED));

        const ai = await getAIService({ userId: 'u1', kind: 'grade' });
        await ai.gradeAnswer({ questionText: 'q', answerText: 'a', userAnswer: 'a' });

        expect(mocks.openaiOptions).toEqual([expect.objectContaining({ apiKey: 'deepseek-key' })]);
    });

    it('主渠道额度用完时自动改用备用渠道，同一次调用返回结果', async () => {
        mocks.getAppConfig.mockReturnValue(baseConfig({ routing: { text: 'deepseek', fallback: 'glm' } }));
        mocks.create
            .mockRejectedValueOnce(new Error('429 rate limit exceeded'))
            .mockResolvedValueOnce(reply('{"correct":true,"reason":"一致"}'));

        const ai = await getAIService({ userId: 'u1', kind: 'grade' });
        const result = await ai.gradeAnswer({ questionText: 'q', answerText: 'a', userAnswer: 'a' });

        expect(result.correct).toBe(true);
        expect(mocks.openaiOptions).toEqual([
            expect.objectContaining({ apiKey: 'deepseek-key' }),
            expect.objectContaining({ apiKey: 'glm-key' }),
        ]);
    });

    it('主渠道凭据失效时改用备用渠道', async () => {
        mocks.getAppConfig.mockReturnValue(baseConfig({ routing: { text: 'deepseek', fallback: 'glm' } }));
        mocks.create
            .mockRejectedValueOnce(new Error('AI_AUTH_ERROR'))
            .mockResolvedValueOnce(reply('{"correct":true,"reason":"一致"}'));

        const ai = await getAIService({ userId: 'u1', kind: 'grade' });

        await expect(ai.gradeAnswer({ questionText: 'q', answerText: 'a', userAnswer: 'a' })).resolves.toMatchObject({ correct: true });
    });

    it('业务错误不触发备用渠道', async () => {
        mocks.getAppConfig.mockReturnValue(baseConfig({ routing: { text: 'deepseek', fallback: 'glm' } }));
        mocks.create.mockResolvedValue({ choices: [{ finish_reason: 'stop', message: { content: 'invalid json' } }] });

        const ai = await getAIService({ userId: 'u1', kind: 'grade' });

        await expect(ai.gradeAnswer({ questionText: 'q', answerText: 'a', userAnswer: 'a' })).rejects.toThrow('AI_RESPONSE_ERROR');
        expect(mocks.openaiOptions).toEqual([expect.objectContaining({ apiKey: 'deepseek-key' })]);
    });

    it('未配置备用渠道时保持原渠道的错误', async () => {
        mocks.getAppConfig.mockReturnValue(baseConfig({ routing: { text: 'deepseek' } }));
        mocks.create.mockRejectedValue(new Error('429 rate limit exceeded'));

        const ai = await getAIService({ userId: 'u1', kind: 'grade' });

        await expect(ai.gradeAnswer({ questionText: 'q', answerText: 'a', userAnswer: 'a' })).rejects.toThrow('AI_QUOTA_EXCEEDED');
    });

    it('免费积分或余额用完时由备用渠道接手，无需手动切换渠道', async () => {
        // 免费额度用完时服务商返回 402 / Insufficient Balance，归一为额度不足后触发备用渠道
        mocks.getAppConfig.mockReturnValue(baseConfig({ routing: { text: 'deepseek', fallback: 'glm' } }));
        mocks.create
            .mockRejectedValueOnce(new Error('402 Insufficient Balance'))
            .mockResolvedValueOnce(reply(GRADED));

        const ai = await getAIService({ userId: 'u1', kind: 'grade' });
        const result = await ai.gradeAnswer({ questionText: 'q', answerText: 'a', userAnswer: 'a' });

        expect(result.correct).toBe(true);
        expect(mocks.openaiOptions).toEqual([
            expect.objectContaining({ apiKey: 'deepseek-key' }),
            expect.objectContaining({ apiKey: 'glm-key' }),
        ]);
    });

    it('按图片重新解题使用识别渠道，纯文字重新解题使用文本渠道', async () => {
        mocks.getAppConfig.mockReturnValue(baseConfig({ routing: { vision: 'glm', text: 'deepseek' } }));
        mocks.create.mockResolvedValue(reply('<answer_text>2</answer_text><analysis>略</analysis>'));

        const ai = await getAIService({ userId: 'u1', kind: 'reanswer' });
        await ai.reanswerQuestion('1+1', 'zh', '数学', 'base64-image');
        await ai.reanswerQuestion('2+2', 'zh', '数学');

        expect(mocks.openaiOptions).toEqual([
            expect.objectContaining({ apiKey: 'glm-key' }),
            expect.objectContaining({ apiKey: 'deepseek-key' }),
        ]);
    });
});