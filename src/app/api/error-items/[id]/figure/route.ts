import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAIService } from "@/lib/ai";
import { getCurrentUser } from "@/lib/current-user";
import { unauthorized, notFound, badRequest, internalError } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { describeQuestion, trackBackgroundTask } from "@/lib/background-tasks";
import { consumeAiQuota } from "@/lib/ai-quota";
import { withRecoverableResponse } from "@/lib/recoverable-response";

const logger = createLogger('api:error-items:figure');

/**
 * POST /api/error-items/:id/figure
 * 用原题图片让 AI 重新判断是否有配图，并重绘 SVG 配图后保存
 */
async function handlePost(
    _req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;

    try {
        const user = await getCurrentUser();
        if (!user) {
            return unauthorized("Authentication required");
        }

        const item = await prisma.errorItem.findUnique({
            where: { id },
            select: { userId: true, shortId: true, originalImageUrl: true, questionText: true },
        });
        if (!item || item.userId !== user.id) {
            return notFound("Item not found");
        }

        // 原图以 data URL 保存；文字录入的题目没有原图，无法重绘
        const match = item.originalImageUrl?.match(/^data:([^;]+);base64,([\s\S]+)$/);
        if (!match) {
            return badRequest("NO_ORIGINAL_IMAGE");
        }

        const limited = await consumeAiQuota(user, 'figure');
        if (limited) return limited;

        const updated = await trackBackgroundTask(
            { userId: user.id, kind: 'figure', subject: describeQuestion(item), link: `/error-items/${id}` },
            async () => {
                const figure = await getAIService().generateFigureSvg(match[2], match[1], item.questionText);
                return prisma.errorItem.update({
                    where: { id },
                    data: { hasFigure: figure.hasFigure, figureSvg: figure.figureSvg },
                    select: { hasFigure: true, figureSvg: true },
                });
            }
        );

        logger.info({ errorItemId: id, hasFigure: updated.hasFigure, svgLength: updated.figureSvg?.length ?? 0 }, 'Figure regenerated');
        return NextResponse.json(updated);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error({ error: message }, 'Error regenerating figure');
        // AI 错误码交给前端映射为提示文案
        return internalError(message.startsWith('AI_') ? message.split(':')[0] : "Failed to regenerate figure");
    }
}

/** 耗时 AI 请求：浏览器中断连接后，前端可通过 /api/requests/:id 取回响应 */
export const POST = withRecoverableResponse(handlePost);
