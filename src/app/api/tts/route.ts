import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/current-user";
import { badRequest, createErrorResponse, ErrorCode, unauthorized } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { MAX_NARRATION_TEXT_LENGTH } from "@/lib/svg-animation";
import { getTtsMode, synthesizeSpeech } from "@/lib/tts/speech-cache";
import { TtsError } from "@/lib/tts/providers";
import { withRecoverableResponse } from "@/lib/recoverable-response";

const logger = createLogger('api:tts');

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
    text: z.string().trim().min(1).max(MAX_NARRATION_TEXT_LENGTH),
    language: z.enum(['zh', 'en']).default('zh'),
    /** 忽略缓存重新合成（已有动画重新生成云端语音） */
    regenerate: z.boolean().optional(),
});

/**
 * GET /api/tts
 * 当前的朗读方式：{ mode: 'browser' | 'cloud' }，播放器据此选择浏览器语音或云端语音
 */
export async function GET() {
    const user = await getCurrentUser();
    if (!user) {
        return unauthorized("Authentication required");
    }
    return NextResponse.json({ mode: getTtsMode() === 'browser' ? 'browser' : 'cloud' });
}

/**
 * POST /api/tts
 * 用云端语音合成朗读一段讲解，请求体 { text, language, regenerate? }，返回 { id, version }，
 * 音频用 GET /api/tts/:id?v=version 获取。同样的文字只合成一次，regenerate 为 true 时重新合成；
 * 当前为浏览器本地语音时返回 TTS_DISABLED
 */
async function handlePost(req: Request) {
    const user = await getCurrentUser();
    if (!user) {
        return unauthorized("Authentication required");
    }
    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
        return badRequest("INVALID_TTS_TEXT");
    }
    try {
        const result = await synthesizeSpeech(parsed.data.text, parsed.data.language, { regenerate: parsed.data.regenerate });
        if (!result) return badRequest("TTS_DISABLED");
        return NextResponse.json(result);
    } catch (error) {
        if (error instanceof TtsError && error.code === 'TTS_NOT_CONFIGURED') {
            return badRequest("TTS_NOT_CONFIGURED");
        }
        logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Speech synthesis failed');
        return createErrorResponse("TTS_PROVIDER_ERROR", 502, ErrorCode.AI_ERROR);
    }
}

export const POST = withRecoverableResponse(handlePost);
