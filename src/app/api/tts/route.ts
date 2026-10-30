import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/current-user";
import { badRequest, unauthorized } from "@/lib/api-errors";
import { getTtsMode, synthesizeSpeech } from "@/lib/tts/speech-cache";
import { speechErrorResponse, speechLanguageSchema, speechTextSchema } from "@/lib/tts/request";
import { withRecoverableResponse } from "@/lib/recoverable-response";

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
    text: speechTextSchema,
    language: speechLanguageSchema,
    /** 忽略缓存重新合成 */
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
 * 当前为浏览器本地语音时返回 TTS_DISABLED。整个动画的语音用 POST /api/tts/batch 合成
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
        return speechErrorResponse(error, user);
    }
}

export const POST = withRecoverableResponse(handlePost);
