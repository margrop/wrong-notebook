/**
 * 保存 AI 设置前的必填项校验
 */
import { describe, it, expect } from 'vitest';
import { validateAiConfig } from '@/lib/ai-config-validation';
import { translations } from '@/lib/translations';
import type { AppConfig } from '@/types/api';

const t = translations.zh;
const ai = t.settings.ai;
const openaiInstance = { id: 'i1', name: '我的渠道', apiKey: 'sk-1', baseUrl: 'https://api.example.com/v1', model: 'gpt' };
const config = (overrides: Partial<AppConfig>) => ({ aiProvider: 'gemini', ...overrides }) as AppConfig;

describe('validateAiConfig', () => {
    it('时区无效时提示，未设置时区按默认值通过', () => {
        expect(validateAiConfig(config({ timeZone: 'Mars/Base' }), t)).toBe(t.settings.general.invalidTimeZone);
        expect(validateAiConfig(config({}), t)).toBeNull();
        expect(validateAiConfig(config({ timeZone: 'Asia/Shanghai' }), t)).toBeNull();
    });

    it('OpenAI 兼容渠道的每个实例都要有名称、API Key、地址和模型', () => {
        const check = (patch: Record<string, string>) =>
            validateAiConfig(config({ aiProvider: 'openai', openai: { instances: [openaiInstance, { ...openaiInstance, ...patch }] } as AppConfig['openai'] }), t);

        expect(check({})).toBeNull();
        expect(check({ name: ' ' })).toBe(ai.validationNameRequired);
        expect(check({ apiKey: '' })).toBe(ai.validationApiKeyRequired);
        expect(check({ baseUrl: '' })).toBe(ai.validationBaseUrlRequired);
        expect(check({ model: '  ' })).toBe(ai.validationModelRequired);
    });

    it('Azure 渠道要有端点、部署名和 API Key', () => {
        const azure = { endpoint: 'https://x.openai.azure.com', deploymentName: 'gpt', apiKey: 'k' };
        const check = (patch: Record<string, string>) =>
            validateAiConfig(config({ aiProvider: 'azure', azure: { ...azure, ...patch } as AppConfig['azure'] }), t);

        expect(check({})).toBeNull();
        expect(check({ endpoint: '' })).toBe(ai.validationAzureEndpointRequired);
        expect(check({ deploymentName: '' })).toBe(ai.validationAzureDeploymentRequired);
        expect(check({ apiKey: '' })).toBe(ai.validationApiKeyRequired);
    });

    it('其他渠道不检查 OpenAI 和 Azure 的字段', () => {
        expect(validateAiConfig(config({ aiProvider: 'gemini', azure: {} as AppConfig['azure'] }), t)).toBeNull();
    });
});
