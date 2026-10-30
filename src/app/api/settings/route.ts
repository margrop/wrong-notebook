import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { requireAdmin } from "@/lib/auth-utils";
import { getAppConfig, updateAppConfig } from "@/lib/config";
import { badRequest, forbidden, internalError, unauthorized } from "@/lib/api-errors";
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
});

const ttsSchema = z.object({
    mode: z.enum(TTS_MODES).optional(),
    ...Object.fromEntries(CLOUD_TTS_PROVIDERS.map((id) => [id, cloudTtsSchema.optional()])),
});

export const dynamic = 'force-dynamic';

export async function GET() {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
        return unauthorized("Authentication required");
    }

    const config = getAppConfig();
    // 完整配置（含 API Key）只给管理员；普通用户只需要页面用到的非敏感字段
    if (!requireAdmin(session)) {
        return NextResponse.json({ aiProvider: config.aiProvider, timeouts: config.timeouts, timeZone: config.timeZone });
    }
    return NextResponse.json(config);
}

export async function POST(req: Request) {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
        return unauthorized("Authentication required");
    }
    if (!requireAdmin(session)) {
        return forbidden("Admin access required");
    }

    try {
        const body = await req.json();
        if (body.timeZone !== undefined) {
            if (!isValidTimeZone(body.timeZone)) return badRequest('INVALID_TIME_ZONE');
            body.timeZone = body.timeZone.trim();
        }
        if (body.aiDailyLimit !== undefined && !(Number.isInteger(body.aiDailyLimit) && body.aiDailyLimit >= 0)) {
            return badRequest('INVALID_AI_DAILY_LIMIT');
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

        const updatedConfig = updateAppConfig(body);
        return NextResponse.json(updatedConfig);
    } catch (error) {
        logger.error({ error }, 'Failed to update settings');
        return internalError("Failed to update settings");
    }
}


