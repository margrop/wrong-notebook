import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAIService } from "@/lib/ai";
import { getCurrentUser } from "@/lib/current-user";
import { unauthorized, notFound, badRequest, internalError } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { describeQuestion, trackBackgroundTask } from "@/lib/background-tasks";
import { consumeAiQuota } from "@/lib/ai-quota";
import { embedNarration } from "@/lib/svg-animation";

const logger = createLogger('api:error-items:svg-narration');

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/error-items/:id/svg-animation/narration
 * 由 AI 为已生成的动画补写语音讲解稿，写入动画 SVG 后保存，画面不变（替换已有的讲解稿）
 * 请求体 { language: 'zh' | 'en' }：处理该语言的动画，讲解使用该语言，未指定时为中文
 */
export async function POST(req: Request, { params }: RouteContext) {
    const { id } = await params;
    const body = await req.json().catch(() => ({})) as { language?: unknown };
    const language = body.language === 'en' ? 'en' : 'zh';
    const field = language === 'en' ? 'svgAnimationEn' : 'svgAnimation';

    try {
        const user = await getCurrentUser();
        if (!user) {
            return unauthorized("Authentication required");
        }

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

        const limited = await consumeAiQuota(user, 'animation');
        if (limited) return limited;

        const updated = await trackBackgroundTask(
            { userId: user.id, kind: 'svg_narration', subject: describeQuestion(item), link: `/error-items/${id}` },
            async () => {
                const narration = await getAIService().generateSvgNarration(item.questionText || "", item.answerText || "", item.analysis || "", svgAnimation, language);
                if (!narration) throw new Error("NO_VALID_NARRATION");
                const svg = embedNarration(svgAnimation, narration);
                await prisma.errorItem.update({ where: { id }, data: { [field]: svg } });
                return svg;
            }
        ).catch((error: unknown) => {
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
