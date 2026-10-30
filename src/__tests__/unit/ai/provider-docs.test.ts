/**
 * AI 提供商官方接入文档链接：除 MiniMax Code OAuth 外都有，国内站和国际站分别列出
 */
import { describe, expect, it } from 'vitest';
import { getProviderDocs } from '@/lib/ai/provider-docs';
import { VENDOR_PROVIDER_IDS } from '@/lib/ai/vendor-presets';

const isHttps = (url: string | undefined) => !url || url.startsWith('https://');

describe('官方接入文档', () => {
    it('国产大模型渠道都有国内站文档，链接为 https', () => {
        for (const id of VENDOR_PROVIDER_IDS) {
            const docs = getProviderDocs(id);
            expect(docs?.cn, id).toMatch(/^https:\/\//);
            expect(isHttps(docs?.intl), id).toBe(true);
        }
    });

    it('同时有国内站和国际站的渠道两个都提供', () => {
        expect(getProviderDocs('minimax')).toMatchObject({
            cn: 'https://platform.minimax.cn/docs/api-reference/api-overview',
            intl: 'https://platform.minimax.io/docs/api-reference/api-overview',
        });
        expect(getProviderDocs('kimi')?.intl).toContain('moonshot.ai');
        expect(getProviderDocs('deepseek')?.intl).toBeUndefined();
    });

    it('海外提供商只有一个入口；MiniMax Code OAuth 没有', () => {
        for (const id of ['openai', 'anthropic', 'azure', 'gemini'] as const) {
            expect(getProviderDocs(id)?.cn, id).toBeUndefined();
            expect(getProviderDocs(id)?.intl, id).toMatch(/^https:\/\//);
        }
        expect(getProviderDocs('minimax-code')).toBeNull();
    });

    it('每个提供商都附有获取 API Key 的说明和模型列表', () => {
        for (const id of [...VENDOR_PROVIDER_IDS, 'openai', 'anthropic', 'azure', 'gemini'] as const) {
            const docs = getProviderDocs(id);
            expect(docs?.apiKey, id).toMatch(/^https:\/\//);
            expect(docs?.models, id).toMatch(/^https:\/\//);
        }
    });
});
