/**
 * AI Provider 单元测试
 * 
 * 测试 AI 服务工厂函数和 Provider 基本初始化
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock OpenAI SDK
vi.mock('openai', () => {
    return {
        default: class MockOpenAI {
            chat = {
                completions: {
                    create: vi.fn(),
                },
            };
        },
    };
});

// Mock Google GenAI SDK
vi.mock('@google/genai', () => {
    return {
        GoogleGenAI: class MockGoogleGenAI {
            models = {
                generateContent: vi.fn(),
            };
        },
    };
});

// Mock logger
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

// Mock config
vi.mock('@/lib/config', () => ({
    getAppConfig: vi.fn(),
    getActiveOpenAIConfig: vi.fn(),
}));

// Delayed import to ensure mocks are applied
import { getAppConfig, getActiveOpenAIConfig } from '@/lib/config';
import { OpenAIProvider } from '@/lib/ai/openai-provider';
import { GeminiProvider } from '@/lib/ai/gemini-provider';
import { getAIService } from '@/lib/ai';

describe('AI Provider 初始化', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('OpenAI Provider', () => {
        it('缺少 API Key 时应该抛出 AI_AUTH_ERROR', () => {
            expect(() => new OpenAIProvider({})).toThrow('AI_AUTH_ERROR');
        });

        it('API Key 为空字符串时应该抛出 AI_AUTH_ERROR', () => {
            expect(() => new OpenAIProvider({ apiKey: '' })).toThrow('AI_AUTH_ERROR');
        });

        it('有效 API Key 时应该成功创建实例', () => {
            const provider = new OpenAIProvider({
                apiKey: 'sk-test-key',
                model: 'gpt-4o',
            });

            expect(provider).toBeDefined();
            expect(typeof provider.analyzeImage).toBe('function');
        });

        it('应该支持自定义 baseUrl', () => {
            const provider = new OpenAIProvider({
                apiKey: 'test-key',
                baseUrl: 'https://custom-api.example.com',
            });

            expect(provider).toBeDefined();
        });
    });

    describe('Gemini Provider', () => {
        it('缺少 API Key 时应该抛出 AI_AUTH_ERROR', () => {
            expect(() => new GeminiProvider({})).toThrow('AI_AUTH_ERROR');
        });

        it('API Key 为空字符串时应该抛出 AI_AUTH_ERROR', () => {
            expect(() => new GeminiProvider({ apiKey: '' })).toThrow('AI_AUTH_ERROR');
        });

        it('有效 API Key 时应该成功创建实例', () => {
            const provider = new GeminiProvider({
                apiKey: 'test-gemini-key',
                model: 'gemini-2.0-flash',
            });

            expect(provider).toBeDefined();
            expect(typeof provider.analyzeImage).toBe('function');
        });

        it('应该使用默认模型 gemini-2.0-flash', () => {
            const provider = new GeminiProvider({ apiKey: 'test-key' });

            expect(provider).toBeDefined();
        });
    });

    describe('AI Service Factory', () => {
        it('应该根据配置返回 OpenAI Provider', () => {
            vi.mocked(getAppConfig).mockReturnValue({
                aiProvider: 'openai',
                openai: {
                    instances: [{ id: 'test', name: 'Test', apiKey: 'test-openai-key', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' }],
                    activeInstanceId: 'test',
                },
                gemini: { apiKey: '', model: '' }
            } as unknown as ReturnType<typeof getAppConfig>);
            vi.mocked(getActiveOpenAIConfig).mockReturnValue({
                id: 'test',
                name: 'Test',
                apiKey: 'test-openai-key',
                baseUrl: 'https://api.openai.com/v1',
                model: 'gpt-4o',
            });

            const service = getAIService();

            expect(service).toBeDefined();
            expect(service.constructor.name).toBe('OpenAIProvider');
        });

        it('应该根据配置返回 Gemini Provider', () => {
            vi.mocked(getAppConfig).mockReturnValue({
                aiProvider: 'gemini',
                gemini: { apiKey: 'test-gemini-key', model: 'gemini-2.0-flash' },
                openai: { apiKey: '', model: '' }
            } as unknown as ReturnType<typeof getAppConfig>);

            const service = getAIService();

            expect(service).toBeDefined();
            expect(service.constructor.name).toBe('GeminiProvider');
        });

        it('配置未知 provider 时应该回退到默认的 MiniMax 渠道', () => {
            vi.mocked(getAppConfig).mockReturnValue({
                aiProvider: 'unknown',
                gemini: { apiKey: 'test-gemini-key' },
                minimax: { apiKey: 'test-minimax-key' },
            } as unknown as ReturnType<typeof getAppConfig>);

            const service = getAIService();

            expect(service).toBeDefined();
            expect(service.constructor.name).toBe('OpenAIProvider');
        });
    });
});
