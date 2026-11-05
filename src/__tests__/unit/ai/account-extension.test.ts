/**
 * AI 账户扩展：自定义实现的拒绝、出错放行、单独的 AI 配置、用量记录出错，以及扩展路径解析
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiAccountProvider } from '@/lib/ai/account';

const mocks = vi.hoisted(() => ({
    account: {
        authorize: vi.fn(),
        resolveConfig: vi.fn(),
        record: vi.fn(),
        onUserDeleted: vi.fn(),
    },
    aiUsageCreate: vi.fn(),
    hasAiDataConsent: vi.fn(),
    openaiOptions: [] as Array<{ apiKey?: string; baseURL?: string }>,
    create: vi.fn(),
    getAppConfig: vi.fn(),
    error: vi.fn(),
}));

vi.mock('@wrong-notebook/ai-account', () => ({ aiAccountProvider: mocks.account }));
vi.mock('@/lib/prisma', () => ({ prisma: { aiUsage: { create: mocks.aiUsageCreate } } }));
vi.mock('@/lib/ai-consent-store', () => ({ hasAiDataConsent: mocks.hasAiDataConsent }));
vi.mock('@/lib/logger', () => ({
    createLogger: vi.fn(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: mocks.error, box: vi.fn(), divider: vi.fn() })),
}));
vi.mock('@/lib/config', () => ({ getAppConfig: mocks.getAppConfig, getActiveOpenAIConfig: vi.fn(), getAppTimeZone: () => 'Asia/Shanghai' }));
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

import { consumeAiQuota, quotaRejectionCode } from '@/lib/ai-quota';
import { getAIService } from '@/lib/ai';
import { notifyAiAccountUsersDeleted } from '@/lib/ai/account-provider';
import { aiAccountExtensionPath } from '../../../../next.config';

const account = mocks.account as unknown as { [K in keyof AiAccountProvider]: ReturnType<typeof vi.fn> };
const reply = { choices: [{ finish_reason: 'stop', message: { content: '{"correct":true,"reason":"一致"}' } }], usage: { prompt_tokens: 7, completion_tokens: 3 } };

beforeEach(() => {
    vi.clearAllMocks();
    mocks.openaiOptions.length = 0;
    mocks.hasAiDataConsent.mockResolvedValue(true);
    mocks.aiUsageCreate.mockResolvedValue({});
    account.authorize.mockResolvedValue(null);
    account.resolveConfig.mockResolvedValue(null);
    account.record.mockResolvedValue(undefined);
    mocks.create.mockResolvedValue(reply);
    mocks.getAppConfig.mockReturnValue({ aiProvider: 'deepseek', deepseek: { apiKey: 'site-key' }, prompts: {} });
});

describe('consumeAiQuota 与 AI 账户实现', () => {
    it('把用户、操作和角色交给实现判断，放行后记录一次调用', async () => {
        expect(await consumeAiQuota({ id: 'u1', role: 'user' }, 'grade')).toBeNull();
        expect(account.authorize).toHaveBeenCalledWith({ userId: 'u1', kind: 'grade', role: 'user' });
        expect(mocks.aiUsageCreate).toHaveBeenCalledWith({ data: { userId: 'u1', kind: 'grade' } });
    });

    it('实现拒绝时返回 429 和附带信息，不记录调用', async () => {
        account.authorize.mockResolvedValue({ code: 'AI_DAILY_LIMIT_EXCEEDED', details: { balance: 0 } });

        const response = await consumeAiQuota({ id: 'u1', role: 'user' }, 'analyze');

        expect(response?.status).toBe(429);
        expect(await response?.json()).toEqual({ message: 'AI_DAILY_LIMIT_EXCEEDED', code: 'AI_DAILY_LIMIT_EXCEEDED', details: { balance: 0 } });
        expect(mocks.aiUsageCreate).not.toHaveBeenCalled();
    });

    it('实现判定额度不足时返回 AI_QUOTA_INSUFFICIENT，后台任务按该错误码记录', async () => {
        account.authorize.mockResolvedValue({ code: 'AI_QUOTA_INSUFFICIENT', details: { balance: 0 } });

        const response = await consumeAiQuota({ id: 'u1', role: 'user' }, 'analyze');

        expect(response?.status).toBe(429);
        expect(await response?.clone().json()).toMatchObject({ code: 'AI_QUOTA_INSUFFICIENT' });
        expect(await quotaRejectionCode(response!)).toBe('AI_QUOTA_INSUFFICIENT');
    });

    it('实现出错时放行并记日志', async () => {
        account.authorize.mockRejectedValue(new Error('gateway down'));

        expect(await consumeAiQuota({ id: 'u1', role: 'user' }, 'grade')).toBeNull();
        expect(mocks.error).toHaveBeenCalled();
        expect(mocks.aiUsageCreate).toHaveBeenCalled();
    });

    it('未同意 AI 数据授权时不询问实现，直接拒绝', async () => {
        mocks.hasAiDataConsent.mockResolvedValue(false);

        expect((await consumeAiQuota({ id: 'u1', role: 'user' }, 'grade'))?.status).toBe(403);
        expect(account.authorize).not.toHaveBeenCalled();
    });
});

describe('getAIService 与 AI 账户实现', () => {
    it('实现返回单独的配置时，用该地址、密钥和模型请求，用量记在其渠道名下', async () => {
        account.resolveConfig.mockResolvedValue({ provider: 'gateway', baseUrl: 'http://gateway.example.com/v1', apiKey: 'user-key', model: 'gpt-x' });

        const ai = await getAIService({ userId: 'u1', kind: 'grade' });
        await ai.gradeAnswer({ questionText: 'q', answerText: 'a', userAnswer: 'a' });

        expect(account.resolveConfig).toHaveBeenCalledWith({ userId: 'u1', kind: 'grade' });
        expect(mocks.openaiOptions).toEqual([expect.objectContaining({ apiKey: 'user-key', baseURL: 'http://gateway.example.com/v1' })]);
        expect(mocks.create.mock.calls[0][0].model).toBe('gpt-x');
        expect(account.record).toHaveBeenCalledWith(
            { userId: 'u1', kind: 'grade' },
            'gateway',
            expect.objectContaining({ task: 'grading', usage: { inputTokens: 7, outputTokens: 3 } }),
        );
    });

    it('实现返回 null 时使用全站配置', async () => {
        const ai = await getAIService({ userId: 'u1', kind: 'grade' });
        await ai.gradeAnswer({ questionText: 'q', answerText: 'a', userAnswer: 'a' });

        expect(mocks.openaiOptions[0]).toMatchObject({ apiKey: 'site-key' });
        expect(account.record).toHaveBeenCalledWith({ userId: 'u1', kind: 'grade' }, 'deepseek', expect.anything());
    });

    it('记录用量失败不影响调用结果', async () => {
        account.record.mockRejectedValue(new Error('db down'));

        const ai = await getAIService({ userId: 'u1', kind: 'grade' });
        await expect(ai.gradeAnswer({ questionText: 'q', answerText: 'a', userAnswer: 'a' })).resolves.toMatchObject({ correct: true });
        await vi.waitFor(() => expect(mocks.error).toHaveBeenCalled());
    });
});

describe('notifyAiAccountUsersDeleted', () => {
    it('逐个通知，单个出错不影响其余用户', async () => {
        account.onUserDeleted.mockRejectedValueOnce(new Error('gateway down')).mockResolvedValue(undefined);

        await expect(notifyAiAccountUsersDeleted(['a', 'b'])).resolves.toBeUndefined();

        expect(account.onUserDeleted.mock.calls).toEqual([['a'], ['b']]);
        expect(mocks.error).toHaveBeenCalledTimes(1);
    });
});

describe('aiAccountExtensionPath', () => {
    it('未设置时使用默认实现，相对路径补上 ./', () => {
        expect(aiAccountExtensionPath(undefined)).toBe('./src/lib/ai/account-default.ts');
        expect(aiAccountExtensionPath('  ')).toBe('./src/lib/ai/account-default.ts');
        expect(aiAccountExtensionPath('src/extensions/local/ai-account.ts')).toBe('./src/extensions/local/ai-account.ts');
        expect(aiAccountExtensionPath('./custom.ts')).toBe('./custom.ts');
    });
});
