import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAIService } from "@/lib/ai";
import { notFound, badRequest, internalError, taskAlreadyRunning } from "@/lib/api-errors";
import { withUser } from "@/lib/api-handler";
import type { AuthenticatedContext } from "@/lib/api-handler";
import { createLogger } from "@/lib/logger";
import { describeQuestion, findRunningTask, reserveBackgroundTask, runReservedTask } from "@/lib/background-tasks";
import { serializeWrite } from "@/lib/db-write-queue";
import { consumeAiQuota } from "@/lib/ai-quota";
import { embedNarration } from "@/lib/svg-animation";
import { withRecoverableResponse } from "@/lib/recoverable-response";
import { svgAnimationSchema } from "@/lib/schemas/error-items";

const logger = createLogger('api:error-items:svg-narration');

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/error-items/:id/svg-animation/narration
 * 由 AI 为已生成的动画补写语音讲解稿，写入动画 SVG 后保存，画面不变（替换已有的讲解稿）
 * 请求体 { language: 'zh' | 'en' }：处理该语言的动画，讲解使用该语言，未指定时为中文
 */
async function handlePost(req: Request, { user, params }: RouteContext & AuthenticatedContext) {
    const { id } = await params;
    const parsed = svgAnimationSchema.safeParse(await req.json().catch(() => ({})));
    const language = parsed.success && parsed.data.language === 'en' ? 'en' : 'zh';
    const field = language === 'en' ? 'svgAnimationEn' : 'svgAnimation';

    try {
        const item = await prisma.errorItem.findUnique({
            where: { id },
            select: { userId: true, shortId: true, questionText: true, answerText: true, analysis: true, svgAnimation: true, svgAnimationEn: true },
        });
        if (!item || item.userId !== user.id) {
            return notFound("Item not found");
        }
        const svgAnimation = item[field];
        if (!svgAnimation) {
            return badRequest("NO_ANIMATION");
        }

        // 按目标防重复：同一错题同一语言同一时刻只允许一个「补写讲解稿」任务（reserve 失败返回 409，不扣额度、不调用 AI）
        const target = `error-item:${id}:svg-narration:${language}`;
        const handle = reserveBackgroundTask({
            userId: user.id,
            kind: 'svg_narration',
            subject: describeQuestion(item),
            link: `/error-items/${id}`,
            target,
        });
        if (!handle) {
            return taskAlreadyRunning(findRunningTask(user.id, target) ?? { id: '', kind: 'svg_narration', startedAt: '', target });
        }

        const limited = await serializeWrite(() => consumeAiQuota(user, 'animation'));
        if (limited) {
            handle.cancel();
            return limited;
        }

        const updated = await runReservedTask(handle, async () => {
            const narration = await (await getAIService({ userId: user.id, kind: 'animation' })).generateSvgNarration(item.questionText || "", item.answerText || "", item.analysis || "", svgAnimation, language);
            if (!narration) throw new Error("NO_VALID_NARRATION");
            const svg = embedNarration(svgAnimation, narration);
            await prisma.errorItem.update({ where: { id }, data: { [field]: svg } });
            return svg;
        }).catch((error: unknown) => {
            if (error instanceof Error && error.message === "NO_VALID_NARRATION") return null;
            throw error;
        });
        if (!updated) {
            return badRequest("NO_VALID_NARRATION");
        }

        logger.info({ errorItemId: id, language }, 'SVG narration generated');
        return NextResponse.json({ svgAnimation: updated, language });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error({ error: message }, 'Error generating SVG narration');
        // AI 错误码交给前端映射为提示文案
        return internalError(message.startsWith('AI_') ? message.split(':')[0] : "Failed to generate SVG narration");
    }
}

/** 耗时 AI 请求：浏览器中断连接后，前端可通过 /api/requests/:id 取回响应 */
export const POST = withRecoverableResponse(withUser(handlePost));
