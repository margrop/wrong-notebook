import { describe, expect, it } from 'vitest';
import { buildConnectionTestRequest, buildProviderTestRequest, routedProviders } from '@/lib/ai/connection-test';
import type { AppConfig } from '@/types/api';

describe('设置页连接测试请求', () => {
    it('OpenAI 使用当前激活的实例', () => {
        const config: AppConfig = {
            aiProvider: 'openai',
            openai: {
                activeInstanceId: 'b',
                instances: [
                    { id: 'a', name: 'A', apiKey: 'key-a', baseUrl: 'https://a', model: 'm-a' },
                    { id: 'b', name: 'B', apiKey: 'key-b', baseUrl: 'https://b', model: 'm-b' },
                ],
            },
        };
        expect(buildConnectionTestRequest(config, 'zh')).toEqual({
            ok: true,
            body: { provider: 'openai', apiKey: 'key-b', baseUrl: 'https://b', model: 'm-b', language: 'zh' },
        });
    });

    it.each(['gemini', 'anthropic', 'minimax'] as const)('%s 读取同名配置', (provider) => {
        const config = { aiProvider: provider, [provider]: { apiKey: 'k', baseUrl: 'https://x', model: 'm' } } as AppConfig;
        expect(buildConnectionTestRequest(config, 'en')).toEqual({
            ok: true,
            body: { provider, apiKey: 'k', baseUrl: 'https://x', model: 'm', language: 'en' },
        });
    });

    it('Azure 带上端点、部署名和 API 版本', () => {
        const config: AppConfig = { aiProvider: 'azure', azure: { apiKey: 'k', endpoint: 'https://e', deploymentName: 'd', apiVersion: 'v', model: 'gpt' } };
        expect(buildConnectionTestRequest(config, 'zh')).toEqual({
            ok: true,
            body: { provider: 'azure', apiKey: 'k', endpoint: 'https://e', deploymentName: 'd', apiVersion: 'v', model: 'gpt', language: 'zh' },
        });
    });

    it('MiniMax Code 使用服务端保存的登录凭据，只发送模型', () => {
        const config: AppConfig = { aiProvider: 'minimax-code', minimaxCode: { model: 'MiniMax-M3' } };
        expect(buildConnectionTestRequest(config, 'zh')).toEqual({
            ok: true,
            body: { provider: 'minimax-code', model: 'MiniMax-M3', language: 'zh' },
        });
    });

    it('缺少 API Key 或 Azure 配置不完整时返回错误码', () => {
        expect(buildConnectionTestRequest({ aiProvider: 'gemini' }, 'zh')).toEqual({ ok: false, error: 'API_KEY_REQUIRED' });
        expect(buildConnectionTestRequest({ aiProvider: 'openai', openai: { instances: [] } }, 'zh')).toEqual({ ok: false, error: 'API_KEY_REQUIRED' });
        expect(buildConnectionTestRequest({ aiProvider: 'azure', azure: { apiKey: 'k' } }, 'zh')).toEqual({ ok: false, error: 'AZURE_CONFIG_INCOMPLETE' });
    });
});

describe('连接测试覆盖用到的渠道', () => {
    it('未设置分工时只测试默认渠道', () => {
        const config: AppConfig = { aiProvider: 'deepseek', deepseek: { apiKey: 'k' } };
        expect(routedProviders(config)).toEqual(['deepseek']);
    });

    it('识别、文本与备用渠道都会测试，且不重复', () => {
        const config: AppConfig = {
            aiProvider: 'deepseek',
            deepseek: { apiKey: 'k1' },
            glm: { apiKey: 'k2' },
            kimi: { apiKey: 'k3' },
            routing: { vision: 'glm', text: 'deepseek', fallback: 'kimi' },
        };
        expect(routedProviders(config).sort()).toEqual(['deepseek', 'glm', 'kimi']);
    });

    it('备用渠道未配置时不纳入测试', () => {
        const config: AppConfig = {
            aiProvider: 'deepseek',
            deepseek: { apiKey: 'k1' },
            glm: {},
            routing: { text: 'deepseek', fallback: 'glm' },
        };
        expect(routedProviders(config)).toEqual(['deepseek']);
    });

    it('按渠道生成测试请求，未配置的渠道返回错误码', () => {
        const config: AppConfig = { aiProvider: 'deepseek', deepseek: { apiKey: 'k1' }, glm: { apiKey: 'k2' } };
        expect(buildProviderTestRequest(config, 'glm', 'zh')).toMatchObject({ ok: true, body: { provider: 'glm', apiKey: 'k2' } });
        expect(buildProviderTestRequest(config, 'kimi', 'zh')).toEqual({ ok: false, error: 'API_KEY_REQUIRED' });
    });
});
