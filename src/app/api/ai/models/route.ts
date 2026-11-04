import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { requireAdmin } from '@/lib/auth-utils';
import { forbidden } from '@/lib/api-errors';
import { aiModelsBodySchema } from '@/lib/schemas/ai';
import { DEFAULT_ANTHROPIC_BASE_URL } from '@/lib/ai/anthropic-provider';
import { isVendorProvider, VENDOR_PRESETS } from '@/lib/ai/vendor-presets';
import { createLogger } from '@/lib/logger';
import { normalizeHttpBaseUrl } from '@/lib/utils';

const logger = createLogger('api:ai:models');

interface ModelInfo {
    id: string;
    name: string;
    owned_by?: string;
}

// 从模型 ID 中提取短名称
function extractModelName(modelId: string): string {
    // models/gemini-2.0-flash -> gemini-2.0-flash
    return modelId.replace(/^models\//, '');
}

async function fetchGeminiModels(apiKey: string, baseUrl: string): Promise<ModelInfo[]> {
    const url = `${baseUrl}/v1beta/models?key=${encodeURIComponent(apiKey)}`;

    const response = await fetch(url, {
        headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
        const errorText = await response.text();
        logger.error({ status: response.status, errorText }, 'Gemini models API error');
        throw new Error(`Gemini API error: ${response.status}`);
    }

    const data = await response.json() as { models?: { name: string }[] };
    return (data.models || [])
        .map((m) => {
            const id = extractModelName(m.name);
            return {
                id,
                name: id,
                owned_by: 'Google',
            };
        });
}

async function fetchOpenAIModels(apiKey: string, baseUrl: string): Promise<ModelInfo[]> {
    const url = `${baseUrl}/models`;

    const response = await fetch(url, {
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
    });

    if (!response.ok) {
        logger.error({ statusText: response.statusText }, 'OpenAI models API error');
        throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json() as { data?: { id: string; owned_by?: string }[] };

    return (data.data || [])
        .map((model) => ({
            id: model.id,
            name: model.id,
            owned_by: model.owned_by,
        }));
}

async function fetchAnthropicModels(apiKey: string, baseUrl: string): Promise<ModelInfo[]> {
    const response = await fetch(`${baseUrl}/v1/models?limit=100`, {
        headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
        },
    });

    if (!response.ok) {
        logger.error({ status: response.status }, 'Anthropic models API error');
        throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    return (data.data || []).map((model: { id: string; display_name?: string }) => ({
        id: model.id,
        name: model.display_name || model.id,
        owned_by: 'Anthropic',
    }));
}

/**
 * POST /api/ai/models
 * 用填写的 API Key 拉取模型列表（仅管理员；服务端会请求调用方给出的地址，必须限制使用者）。
 * 用 POST 传参，避免 API Key 出现在 URL 和访问日志中。
 */
export async function POST(req: NextRequest) {
    const session = await getServerSession(authOptions);
    if (!requireAdmin(session)) {
        return forbidden('Admin access required');
    }

    try {
        const parsed = aiModelsBodySchema.safeParse(await req.json().catch(() => null));
        if (!parsed.success) {
            return NextResponse.json(
                { error: 'API key is required' },
                { status: 400 }
            );
        }
        const { provider, apiKey, baseUrl } = parsed.data;

        let models: ModelInfo[] = [];
        // 管理员可填写自建或第三方兼容地址，这里只允许 http/https
        const target = (fallback: string) => normalizeHttpBaseUrl(baseUrl || fallback);

        if (provider === 'anthropic') {
            models = await fetchAnthropicModels(apiKey, target(DEFAULT_ANTHROPIC_BASE_URL));
        } else if (isVendorProvider(provider)) {
            models = await fetchOpenAIModels(apiKey, target(VENDOR_PRESETS[provider].baseUrl));
        } else if (provider === 'gemini') {
            models = await fetchGeminiModels(apiKey, target('https://generativelanguage.googleapis.com'));
        } else {
            // OpenAI-compatible
            models = await fetchOpenAIModels(apiKey, target('https://api.openai.com/v1'));
        }

        return NextResponse.json({ models });

    } catch (error) {
        logger.error({ error }, 'Error fetching models');
        return NextResponse.json(
            { error: (error instanceof Error && error.message) || 'Internal server error', models: [] },
            { status: 200 } // Return 200 with empty models to allow manual input
        );
    }
}
