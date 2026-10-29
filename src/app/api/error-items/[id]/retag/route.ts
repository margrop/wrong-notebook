import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { unauthorized, notFound, badRequest, internalError } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { describeQuestion, trackBackgroundTask } from "@/lib/background-tasks";
import { previewRetagErrorItem, retagErrorItem } from "@/lib/retag";
import { consumeAiQuota } from "@/lib/ai-quota";
import { withRecoverableResponse } from "@/lib/recoverable-response";

const logger = createLogger('api:error-items:retag');

/**
 * POST /api/error-items/:id/retag
 * 用 AI 从当前知识点库中重新选取本题的知识点（替换系统标签，保留自定义标签）
 * 请求体 { preview: true } 时只返回建议的知识点，不保存
 */
async function handlePost(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;

    try {
        const user = await getCurrentUser();
        if (!user) {
            return unauthorized("Authentication required");
        }

        const body = await req.json().catch(() => ({})) as { preview?: unknown };
        const item = await prisma.errorItem.findUnique({ where: { id }, select: { userId: true, shortId: true, questionText: true } });
        if (!item || item.userId !== user.id) {
            return notFound("Item not found");
        }
        const limited = await consumeAiQuota(user, 'retag');
        if (limited) return limited;

        const result = await trackBackgroundTask(
            { userId: user.id, kind: 'retag', subject: describeQuestion(item), link: `/error-items/${id}` },
            () => body.preview === true ? previewRetagErrorItem(id, user.id) : retagErrorItem(id, user.id)
        );
        return NextResponse.json(result);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message === 'ITEM_NOT_FOUND') {
            return notFound("Item not found");
        }
        if (['NO_QUESTION_TEXT', 'NO_AVAILABLE_TAGS', 'NO_TAGS_SELECTED'].includes(message)) {
            return badRequest(message);
        }
        logger.error({ error: message }, 'Error retagging item');
        // AI 错误码交给前端映射为提示文案
        return internalError(message.startsWith('AI_') ? message.split(':')[0] : "Failed to retag item");
    }
}

/** 耗时 AI 请求：浏览器中断连接后，前端可通过 /api/requests/:id 取回响应 */
export const POST = withRecoverableResponse(handlePost);
