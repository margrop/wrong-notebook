/**
 * MiniMax Code OAuth 渠道：用登录凭据构造 Anthropic 兼容客户端，并把调用转交给它
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    configs: [] as unknown[],
    gradeAnswer: vi.fn(),
    analyzeImage: vi.fn(),
    observeCompletions: vi.fn(),
    withAccessToken: vi.fn(),
}));

vi.mock('@/lib/ai/anthropic-provider', () => ({
    AnthropicProvider: class {
        constructor(config: unknown) {
            mocks.configs.push(config);
        }
        gradeAnswer = mocks.gradeAnswer;
        analyzeImage = mocks.analyzeImage;
        observeCompletions = mocks.observeCompletions;
    },
}));
vi.mock('@/lib/minimax-code/auth', () => ({ withAccessToken: mocks.withAccessToken }));

import { MiniMaxCodeProvider } from '@/lib/ai/minimax-code-provider';

describe('MiniMaxCodeProvider', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.configs.length = 0;
        mocks.withAccessToken.mockImplementation((fn: (token: string) => Promise<unknown>) => fn('mmoat_token'));
    });

    it('用 Bearer Token 请求 MiniMax Code 的 Anthropic 兼容接口，默认模型 MiniMax-M3.1-Flash', async () => {
        mocks.gradeAnswer.mockResolvedValue({ correct: true, reason: '一致' });
        const input = { questionText: 'q', answerText: 'a', userAnswer: 'a' };

        await expect(new MiniMaxCodeProvider().gradeAnswer(input)).resolves.toEqual({ correct: true, reason: '一致' });

        expect(mocks.configs).toEqual([{ authToken: 'mmoat_token', baseUrl: 'https://agent.minimax.cn/mavis/api/v1/llm', model: 'MiniMax-M3.1-Flash' }]);
        expect(mocks.gradeAnswer).toHaveBeenCalledWith(input);
    });

    it('使用配置中的模型，并原样传递参数', async () => {
        mocks.analyzeImage.mockResolvedValue({ questionText: 'x' });
        await new MiniMaxCodeProvider({ model: ' MiniMax-M3 ' }).analyzeImage('base64', 'image/png', 'en');
        expect(mocks.configs[0]).toMatchObject({ model: 'MiniMax-M3' });
        expect(mocks.analyzeImage).toHaveBeenCalledWith('base64', 'image/png', 'en');
    });

    it('重试时用刷新后的 Token 重新构造客户端', async () => {
        mocks.withAccessToken.mockImplementation(async (fn: (token: string) => Promise<unknown>) => {
            await fn('old').catch(() => undefined);
            return fn('new');
        });
        mocks.gradeAnswer.mockRejectedValueOnce(new Error('AI_AUTH_ERROR')).mockResolvedValueOnce({ correct: false });
        await new MiniMaxCodeProvider().gradeAnswer({ questionText: 'q', answerText: 'a', userAnswer: 'b' });
        expect(mocks.configs.map((c) => (c as { authToken: string }).authToken)).toEqual(['old', 'new']);
    });

    it('补全观察者传给每次创建的 Anthropic 提供商', async () => {
        mocks.gradeAnswer.mockResolvedValue({ correct: true, reason: '一致' });
        const observer = vi.fn();
        const provider = new MiniMaxCodeProvider();
        provider.observeCompletions(observer);

        await provider.gradeAnswer({ questionText: 'q', answerText: 'a', userAnswer: 'a' });

        expect(mocks.observeCompletions).toHaveBeenCalledWith(observer);
    });
});
