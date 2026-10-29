import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAIService } from "@/lib/ai";
import { getCurrentUser } from "@/lib/current-user";
import { unauthorized, notFound, badRequest, internalError } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { describeQuestion, trackBackgroundTask } from "@/lib/background-tasks";
import { consumeAiQuota } from "@/lib/ai-quota";
import { withRecoverableResponse } from "@/lib/recoverable-response";

const logger = createLogger('api:error-items:svg-animation');

type RouteContext = { params: Promise<{ id: string }> };
type AnimationLanguage = 'zh' | 'en';

/** 动画按语言分别保存：中文版存 svgAnimation，英文版存 svgAnimationEn；未指定时为中文 */
function parseLanguage(value: unknown): AnimationLanguage {
    return value === 'en' ? 'en' : 'zh';
}

function animationField(language: AnimationLanguage) {
    return language === 'en' ? 'svgAnimationEn' : 'svgAnimation';
}

/** 当前用户拥有的错题；不存在或不属于该用户时返回 null */
async function findOwnedItem(id: string, userId: string) {
    const item = await prisma.errorItem.findUnique({
        where: { id },
        select: { userId: true, shortId: true, questionText: true, answerText: true, analysis: true, figureSvg: true },
    });
    return item && item.userId === userId ? item : null;
}

/**
 * POST /api/error-items/:id/svg-animation
 * 由 AI 根据题目、答案和解析生成 SVG 动画讲解并保存（覆盖该语言已有的动画）
 * 请求体 { language: 'zh' | 'en' }：动画中的文字使用该语言，未指定时为中文
 */
async function handlePost(req: Request, { params }: RouteContext) {
    const { id } = await params;
    const body = await req.json().catch(() => ({})) as { language?: unknown };
    const language = parseLanguage(body.language);

    try {
        const user = await getCurrentUser();
        if (!user) {
            return unauthorized("Authentication required");
        }

        const item = await findOwnedItem(id, user.id);
        if (!item) {
            return notFound("Item not found");
        }
        if (!item.questionText?.trim()) {
            return badRequest("NO_QUESTION_TEXT");
        }

        const questionText = item.questionText;
        // 页面关闭后服务端仍会继续生成并保存，后台任务弹框中可查看进度
        const limited = await consumeAiQuota(user, 'animation');
        if (limited) return limited;

        const svgAnimation = await trackBackgroundTask(
            { userId: user.id, kind: 'svg_animation', subject: describeQuestion(item), link: `/error-items/${id}` },
            async () => {
                const svg = await getAIService().generateSvgAnimation(questionText, item.answerText || "", item.analysis || "", item.figureSvg, language);
                if (!svg) throw new Error("NO_VALID_ANIMATION");
                await prisma.errorItem.update({ where: { id }, data: { [animationField(language)]: svg } });
                return svg;
            }
        ).catch((error: unknown) => {
            if (error instanceof Error && error.message === "NO_VALID_ANIMATION") return null;
            throw error;
        });
        if (!svgAnimation) {
            return badRequest("NO_VALID_ANIMATION");
        }

        logger.info({ errorItemId: id, language, svgLength: svgAnimation.length }, 'SVG animation generated');
        return NextResponse.json({ svgAnimation, language });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error({ error: message }, 'Error generating SVG animation');
        // AI 错误码交给前端映射为提示文案
        return internalError(message.startsWith('AI_') ? message.split(':')[0] : "Failed to generate SVG animation");
    }
}

/**
 * DELETE /api/error-items/:id/svg-animation?language=zh|en
 * 删除指定语言已生成的 SVG 动画讲解，另一语言的动画保留；未指定时为中文
 */
export async function DELETE(req: Request, { params }: RouteContext) {
    const { id } = await params;
    const language = parseLanguage(new URL(req.url).searchParams.get('language'));

    try {
        const user = await getCurrentUser();
        if (!user) {
            return unauthorized("Authentication required");
        }
        if (!await findOwnedItem(id, user.id)) {
            return notFound("Item not found");
        }

        await prisma.errorItem.update({ where: { id }, data: { [animationField(language)]: null } });
        logger.info({ errorItemId: id, language }, 'SVG animation deleted');
        return NextResponse.json({ success: true });
    } catch (error) {
        logger.error({ error }, 'Error deleting SVG animation');
        return internalError("Failed to delete SVG animation");
    }
}

/** 耗时 AI 请求：浏览器中断连接后，前端可通过 /api/requests/:id 取回响应 */
export const POST = withRecoverableResponse(handlePost);
