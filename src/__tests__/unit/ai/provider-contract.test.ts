/**
 * AI 提供商契约测试
 *
 * 对 OpenAI、Azure、Gemini、Anthropic 四个提供商跑同一组用例，
 * 只 mock 各自的 SDK 客户端，验证行为一致：
 * - analyzeImage 解析 XML 标签得到相同字段
 * - 空响应 / 缺少必需标签时抛错
 * - analysis 标签被截断（缺少闭合标签）时读取到文本末尾
 * - gradeAnswer / evaluateMastery 正常路径
 * - SDK 抛错时错误向上抛出
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const openaiCreate = vi.hoisted(() => vi.fn());
const azureCreate = vi.hoisted(() => vi.fn());
const geminiGenerateContent = vi.hoisted(() => vi.fn());
const anthropicCreate = vi.hoisted(() => vi.fn());

// OpenAI 与 Azure 都依赖 openai 包，分别 mock 默认导出与 AzureOpenAI 导出
vi.mock('openai', () => {
    return {
        default: class MockOpenAI {
            chat = { completions: { create: openaiCreate } };
        },
        AzureOpenAI: class MockAzureOpenAI {
            chat = { completions: { create: azureCreate } };
        },
    };
});

vi.mock('@google/genai', () => {
    return {
        GoogleGenAI: class MockGoogleGenAI {
            models = { generateContent: geminiGenerateContent };
        },
    };
});

vi.mock('@anthropic-ai/sdk', () => {
    class MockAPIError extends Error {
        status: number | undefined;
        constructor(status: number | undefined, message: string) {
            super(message);
            this.status = status;
        }
    }
    class MockAPIConnectionError extends MockAPIError {
        constructor(message = 'Connection error.') {
            super(undefined, message);
        }
    }
    class MockAPIConnectionTimeoutError extends MockAPIConnectionError {
        constructor() {
            super('Request timed out.');
        }
    }
    return {
        default: class MockAnthropic {
            static APIError = MockAPIError;
            static APIConnectionError = MockAPIConnectionError;
            static APIConnectionTimeoutError = MockAPIConnectionTimeoutError;
            messages = { create: anthropicCreate };
        },
    };
});

// Mock logger，避免测试输出日志噪音
vi.mock('@/lib/logger', () => ({
    createLogger: vi.fn(() => ({
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        box: vi.fn(),
        divider: vi.fn(),
    })),
}));

vi.mock('@/lib/config', () => ({
    getAppConfig: vi.fn(() => ({ aiProvider: 'openai', prompts: {} })),
}));

vi.mock('@/lib/ai/tag-service', () => ({
    getMathTagsFromDB: vi.fn(() => Promise.resolve([])),
    getTagsFromDB: vi.fn(() => Promise.resolve([])),
    prefetchSubjectTags: vi.fn(() => Promise.resolve({})),
}));

import type { AIService } from '@/lib/ai/types';
import { OpenAIProvider } from '@/lib/ai/openai-provider';
import { AzureOpenAIProvider } from '@/lib/ai/azure-provider';
import { GeminiProvider } from '@/lib/ai/gemini-provider';
import { AnthropicProvider } from '@/lib/ai/anthropic-provider';

interface ProviderCase {
    name: string;
    make: () => AIService;
    /** 设置 analyzeImage 的 SDK 返回文本 */
    mockText: (text: string) => void;
    /** 设置 analyzeImage 的 SDK 返回（完整形态，用于空响应用例） */
    mockRaw: (raw: unknown) => void;
    /** 让 SDK 调用抛出异常 */
    mockThrow: (error: unknown) => void;
    /** 最近一次 analyzeImage 请求的 model 字段（可选断言） */
    lastModel?: () => string | undefined;
}

function openAITextResponse(text: string) {
    return { choices: [{ finish_reason: 'stop', message: { content: text } }] };
}

function geminiTextResponse(text: string) {
    return { text };
}

function anthropicTextResponse(text: string) {
    return {
        content: [{ type: 'text', text }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 10 },
    };
}

const FULL_XML = [
    '<subject>数学</subject>',
    '<question_text>求函数 f(x) = x^2 的最小值</question_text>',
    '<answer_text>最小值为 0</answer_text>',
    '<analysis>这是一个二次函数,开口向上,顶点在原点,因此最小值为 0</analysis>',
    '<knowledge_points>二次函数, 函数最值</knowledge_points>',
    '<requires_image>true</requires_image>',
    '<grade_semester>四年级上</grade_semester>',
    '<difficulty_stars>3</difficulty_stars>',
].join('\n');

const TRUNCATED_ANALYSIS_XML = [
    '<question_text>求函数 f(x) = x^2 的最小值</question_text>',
    '<answer_text>最小值为 0</answer_text>',
    '<analysis>这是一个二次函数,开口向上,顶点在原点,因此最小值为 0',
].join('\n');

const providers: ProviderCase[] = [
    {
        name: 'OpenAI',
        make: () => new OpenAIProvider({ apiKey: 'test-key', model: 'gpt-4o' }),
        mockText: (text) => openaiCreate.mockResolvedValue(openAITextResponse(text)),
        mockRaw: (raw) => openaiCreate.mockResolvedValue(raw),
        mockThrow: (error) => openaiCreate.mockRejectedValue(error),
        lastModel: () => openaiCreate.mock.calls.at(-1)?.[0]?.model,
    },
    {
        name: 'Azure',
        make: () => new AzureOpenAIProvider({
            apiKey: 'test-key',
            endpoint: 'https://test.openai.azure.com',
            deploymentName: 'gpt-4o',
        }),
        mockText: (text) => azureCreate.mockResolvedValue(openAITextResponse(text)),
        mockRaw: (raw) => azureCreate.mockResolvedValue(raw),
        mockThrow: (error) => azureCreate.mockRejectedValue(error),
        lastModel: () => azureCreate.mock.calls.at(-1)?.[0]?.model,
    },
    {
        name: 'Gemini',
        make: () => new GeminiProvider({ apiKey: 'test-key', model: 'gemini-2.0-flash' }),
        mockText: (text) => geminiGenerateContent.mockResolvedValue(geminiTextResponse(text)),
        mockRaw: (raw) => geminiGenerateContent.mockResolvedValue(raw),
        mockThrow: (error) => geminiGenerateContent.mockRejectedValue(error),
    },
    {
        name: 'Anthropic',
        make: () => new AnthropicProvider({ apiKey: 'test-key', model: 'claude-test' }),
        mockText: (text) => anthropicCreate.mockResolvedValue(anthropicTextResponse(text)),
        mockRaw: (raw) => anthropicCreate.mockResolvedValue(raw),
        mockThrow: (error) => anthropicCreate.mockRejectedValue(error),
    },
];

describe.each(providers)('AI 提供商契约：$name', (providerCase) => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('analyzeImage', () => {
        it('解析完整标签时各字段一致', async () => {
            providerCase.mockText(FULL_XML);
            const result = await providerCase.make().analyzeImage('aGVsbG8=');

            expect(result.questionText).toBe('求函数 f(x) = x^2 的最小值');
            expect(result.answerText).toBe('最小值为 0');
            expect(result.analysis).toContain('二次函数');
            expect(result.subject).toBe('数学');
            expect(result.knowledgePoints).toEqual(expect.arrayContaining(['二次函数', '函数最值']));
            expect(result.requiresImage).toBe(true);
            expect(result.gradeSemester).toBe('四年级上');
            expect(result.difficultyStars).toBe(3);
        });

        it('响应为空时抛错', async () => {
            providerCase.mockRaw({ choices: [] });
            await expect(providerCase.make().analyzeImage('aGVsbG8=')).rejects.toThrow();
        });

        it('缺少必需标签时抛错', async () => {
            providerCase.mockText('<question_text>只有题目</question_text>');
            await expect(providerCase.make().analyzeImage('aGVsbG8=')).rejects.toThrow();
        });

        it('analysis 闭合标签缺失（截断）时读取到文本末尾', async () => {
            providerCase.mockText(TRUNCATED_ANALYSIS_XML);
            const result = await providerCase.make().analyzeImage('aGVsbG8=');
            expect(result.analysis).toContain('二次函数');
            expect(result.analysis).toContain('最小值为 0');
        });
    });

    describe('gradeAnswer', () => {
        it('解析 JSON 判定结果', async () => {
            providerCase.mockText('{"correct": true, "reason": "数值相等"}');
            const result = await providerCase.make().gradeAnswer({
                questionText: '1/2 等于多少',
                answerText: '0.5',
                userAnswer: '1/2',
            });
            expect(result).toEqual({ correct: true, reason: '数值相等' });
        });
    });

    describe('evaluateMastery', () => {
        const input = {
            questionText: '求解 2x + 3 = 7',
            knowledgePoints: ['一元一次方程'],
            history: [{ date: '2026-10-01T00:00:00.000Z', difficulty: 'medium' as const, result: 'correct' as const, source: 'practice' as const }],
            ruleProbability: 0.6,
        };

        it('解析概率评估结果并换算为 0~1', async () => {
            providerCase.mockText('{"probability": 72, "reason": "近期做对一次"}');
            const result = await providerCase.make().evaluateMastery(input);
            expect(result).toEqual({ probability: 0.72, reason: '近期做对一次' });
        });
    });

    describe('SDK 异常', () => {
        it('SDK 抛出异常时错误向上抛出', async () => {
            providerCase.mockThrow(new Error('network unreachable'));
            await expect(providerCase.make().analyzeImage('aGVsbG8=')).rejects.toThrow();
        });
    });
});
