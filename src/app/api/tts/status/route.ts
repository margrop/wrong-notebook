import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/current-user";
import { badRequest, unauthorized } from "@/lib/api-errors";
import { getCachedSpeech } from "@/lib/tts/speech-cache";
import { speechLanguageSchema, speechTextsSchema } from "@/lib/tts/request";

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
    texts: speechTextsSchema,
    language: speechLanguageSchema,
});

/**
 * POST /api/tts/status
 * 查询一个动画的讲解语音是否已全部合成（不调用服务商），返回 { ready }；
 * 已生成语音的动画打开时默认开启语音讲解。当前为浏览器本地语音时 ready 为 false
 */
export async function POST(req: Request) {
    const user = await getCurrentUser();
    if (!user) {
        return unauthorized("Authentication required");
    }
    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
        return badRequest("INVALID_TTS_TEXT");
    }
    const cached = await Promise.all(parsed.data.texts.map((text) => getCachedSpeech(text, parsed.data.language)));
    return NextResponse.json({ ready: cached.every((item) => item) });
}
