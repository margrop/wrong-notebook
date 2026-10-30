import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { badRequest, unauthorized } from "@/lib/api-errors";
import { describeQuestion, trackBackgroundTask } from "@/lib/background-tasks";
import { getCachedSpeech, getTtsMode, synthesizeSpeech } from "@/lib/tts/speech-cache";
import type { SpeechResult } from "@/lib/tts/speech-cache";
import { speechErrorResponse, speechLanguageSchema, speechTextsSchema } from "@/lib/tts/request";
import { withRecoverableResponse } from "@/lib/recoverable-response";

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
    texts: speechTextsSchema,
    language: speechLanguageSchema,
    /** 忽略缓存重新合成全部段落 */
    regenerate: z.boolean().optional(),
    /** 所属错题，用于后台任务的说明和跳转 */
    errorItemId: z.string().max(100).optional(),
});

/** 后台任务显示的题目说明和跳转页面；不是本人的错题时不显示 */
async function taskTarget(errorItemId: string | undefined, userId: string) {
    if (!errorItemId) return {};
    const item = await prisma.errorItem.findUnique({ where: { id: errorItemId }, select: { userId: true, shortId: true, questionText: true } });
    if (!item || item.userId !== userId) return {};
    return { subject: describeQuestion(item), link: `/error-items/${errorItemId}` };
}

/**
 * POST /api/tts/batch
 * 合成一个动画的全部讲解语音，请求体 { texts, language, regenerate?, errorItemId? }，
 * 按顺序返回 { items: [{ id, version }] }。需要调用服务商时登记为后台任务并报告进度；
 * 全部已有缓存（且不重新生成）时直接返回，不登记任务
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
    if (getTtsMode() === 'browser') {
        return badRequest("TTS_DISABLED");
    }
    const { texts, language, regenerate = false, errorItemId } = parsed.data;
    try {
        const cached = regenerate ? [] : await Promise.all(texts.map((text) => getCachedSpeech(text, language)));
        if (!regenerate && cached.every((item) => item)) {
            return NextResponse.json({ items: cached });
        }
        const items = await trackBackgroundTask(
            { userId: user.id, kind: 'tts_voice', total: texts.length, ...(await taskTarget(errorItemId, user.id)) },
            async (task) => {
                const results: SpeechResult[] = [];
                for (const [index, text] of texts.entries()) {
                    const result = cached[index] ?? await synthesizeSpeech(text, language, { regenerate });
                    if (!result) throw new Error("TTS_DISABLED");
                    results.push(result);
                    task.setProgress(index + 1);
                }
                return results;
            },
        );
        return NextResponse.json({ items });
    } catch (error) {
        if (error instanceof Error && error.message === "TTS_DISABLED") return badRequest("TTS_DISABLED");
        return speechErrorResponse(error, user);
    }
}

export const POST = withRecoverableResponse(handlePost);
