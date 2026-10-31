// @vitest-environment node
/**
 * Anthropic SDK 实际发出的请求头：官方接口跟随 SDK 默认；兼容接口保持旧版 SDK 的 x-api-key 与 2023-06-01
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), box: vi.fn() }) }));

import { COMPAT_ANTHROPIC_VERSION, createAnthropicClient } from '@/lib/ai/anthropic-provider';

let captured: { url: string; headers: Headers }[];

beforeEach(() => {
    captured = [];
    vi.stubEnv('ANTHROPIC_API_KEY', 'env-key-should-not-be-used');
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        captured.push({ url: String(url), headers: new Headers(init?.headers) });
        return new Response(JSON.stringify({
            id: 'msg', type: 'message', role: 'assistant', model: 'm', stop_reason: 'end_turn', stop_sequence: null,
            content: [{ type: 'text', text: 'OK' }], usage: { input_tokens: 1, output_tokens: 1 },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
    }));
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});

const send = async (client: ReturnType<typeof createAnthropicClient>) => {
    const message = await client.messages.create({ model: 'm', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] });
    expect(message.content[0]).toMatchObject({ type: 'text', text: 'OK' });
    return captured.at(-1)!;
};

describe('createAnthropicClient', () => {
    it('兼容接口用 x-api-key 发送 API Key，并沿用 2023-06-01 版本', async () => {
        const req = await send(createAnthropicClient('https://api.minimaxi.com/anthropic', 'sk-compat'));

        expect(req.url).toBe('https://api.minimaxi.com/anthropic/v1/messages');
        expect(req.headers.get('x-api-key')).toBe('sk-compat');
        expect(req.headers.get('authorization')).toBeNull();
        expect(req.headers.get('anthropic-version')).toBe(COMPAT_ANTHROPIC_VERSION);
    });

    it('兼容接口的 OAuth 令牌以 Bearer 发送，不读取环境变量里的 API Key', async () => {
        const req = await send(createAnthropicClient('https://api.minimaxi.com/anthropic', undefined, 'oauth-token'));

        expect(req.headers.get('authorization')).toBe('Bearer oauth-token');
        expect(req.headers.get('x-api-key')).toBeNull();
        expect(req.headers.get('anthropic-version')).toBe(COMPAT_ANTHROPIC_VERSION);
    });

    it('官方接口跟随 SDK 默认的鉴权方式和 API 版本，不使用环境变量里的 API Key', async () => {
        const req = await send(createAnthropicClient('https://api.anthropic.com', 'sk-official'));

        expect(req.url).toBe('https://api.anthropic.com/v1/messages');
        expect(req.headers.get('authorization') ?? req.headers.get('x-api-key')).toContain('sk-official');
        expect(JSON.stringify([...req.headers])).not.toContain('env-key-should-not-be-used');
        expect(req.headers.get('anthropic-version')).not.toBe(COMPAT_ANTHROPIC_VERSION);
    });
});
