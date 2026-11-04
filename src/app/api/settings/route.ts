import { NextResponse } from "next/server";
import { withUser, withAdmin } from "@/lib/api-handler";
import type { AuthenticatedContext } from "@/lib/api-handler";
import { z } from "zod";
import { getAppConfig, updateAppConfig } from "@/lib/config";
import { isValidConcurrencyLimit } from "@/lib/ai-concurrency-limit";
import { badRequest, internalError } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import type { OpenAIInstance } from "@/types/api";
import { isValidTimeZone } from "@/lib/date-time";
import { VENDOR_PROVIDER_IDS } from "@/lib/ai/vendor-presets";
import { CLOUD_TTS_PROVIDERS, TTS_MODES } from "@/lib/tts/constants";

const logger = createLogger('api:settings');

const minimaxCodeSchema = z.object({
    model: z.string().trim().max(100).optional(),
    autoCheckin: z.boolean().optional(),
});

const cloudTtsSchema = z.object({
    model: z.string().trim().max(100).optional(),
    voice: z.string().trim().max(200).optional(),
    endpoint: z.union([z.literal(''), z.string().trim().url().max(500)]).optional(),
    apiKey: z.string().trim().max(500).optional(),
});

const ttsSchema = z.object({
    mode: z.enum(TTS_MODES).optional(),
    ...Object.fromEntries(CLOUD_TTS_PROVIDERS.map((id) => [id, cloudTtsSchema.optional()])),
});

export const dynamic = 'force-dynamic';

/**
 * GET /api/settings
 * 管理员拿到完整配置（含 API Key）；普通用户只返回非敏感字段
 */
export const GET = withUser(async (_req: Request, { session }: AuthenticatedContext) => {
    const config = getAppConfig();
    if (session.user.role !== 'admin') {
        return NextResponse.json({ aiProvider: config.aiProvider, timeouts: config.timeouts, timeZone: config.timeZone });
    }
    return NextResponse.json(config);
});

async function handlePost(req: Request) {
    try {
        const body = await req.json();
        if (body.timeZone !== undefined) {
            if (!isValidTimeZone(body.timeZone)) return badRequest('INVALID_TIME_ZONE');
            body.timeZone = body.timeZone.trim();
        }
        if (body.aiDailyLimit !== undefined && !(Number.isInteger(body.aiDailyLimit) && body.aiDailyLimit >= 0)) {
            return badRequest('INVALID_AI_DAILY_LIMIT');
        }
        if (body.aiConcurrencyLimit !== undefined && !isValidConcurrencyLimit(body.aiConcurrencyLimit)) {
            return badRequest('INVALID_AI_CONCURRENCY_LIMIT');
        }
        if (body.minimaxCode !== undefined) {
            const parsed = minimaxCodeSchema.safeParse(body.minimaxCode);
            if (!parsed.success) return badRequest('INVALID_MINIMAX_CODE_CONFIG');
            // 只保存模型和自动签到开关；登录凭据与签到记录由服务端单独管理
            body.minimaxCode = parsed.data;
        }
        if (body.tts !== undefined) {
            const parsed = ttsSchema.safeParse(body.tts);
            if (!parsed.success) return badRequest('INVALID_TTS_CONFIG');
            body.tts = parsed.data;
        }
        const currentConfig = getAppConfig();

        // Don't save masked keys if they somehow get sent back (for Gemini)
        if (body.gemini?.apiKey === '********') {
            // 保留原有的 API Key
            body.gemini.apiKey = currentConfig.gemini?.apiKey;
        }

        // For OpenAI instances, preserve original keys for masked entries
        if (body.openai?.instances) {
            const currentInstances = currentConfig.openai?.instances || [];
            body.openai.instances = body.openai.instances.map((instance: OpenAIInstance) => {
                if (instance.apiKey === '********') {
                    // 查找原有实例并保留其 API Key
                    const originalInstance = currentInstances.find((i: OpenAIInstance) => i.id === instance.id);
                    return {
                        ...instance,
                        apiKey: originalInstance?.apiKey || '',
                    };
                }
                return instance;
            });
        }

        // For Azure, preserve original key if masked
        if (body.azure?.apiKey === '********') {
            body.azure.apiKey = currentConfig.azure?.apiKey;
        }

        if (body.anthropic?.apiKey === '********') {
            body.anthropic.apiKey = currentConfig.anthropic?.apiKey;
        }

        for (const id of VENDOR_PROVIDER_IDS) {
            if (body[id]?.apiKey === '********') {
                body[id].apiKey = currentConfig[id]?.apiKey;
            }
        }
        for (const id of CLOUD_TTS_PROVIDERS) {
            if (body.tts?.[id]?.apiKey === '********') {
                body.tts[id].apiKey = currentConfig.tts?.[id]?.apiKey;
            }
        }

        const updatedConfig = updateAppConfig(body);
        return NextResponse.json(updatedConfig);
    } catch (error) {
        logger.error({ error }, 'Failed to update settings');
        return internalError("Failed to update settings");
    }
}

export const POST = withAdmin(handlePost);
