import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { notFound, badRequest, internalError } from "@/lib/api-errors";
import { withUser } from "@/lib/api-handler";
import type { AuthenticatedContext } from "@/lib/api-handler";
import { createLogger } from "@/lib/logger";
import { describeQuestion, trackBackgroundTask } from "@/lib/background-tasks";
import { previewRetagErrorItem, retagErrorItem } from "@/lib/tags/retag";
import { consumeAiQuota } from "@/lib/ai-quota";
import { withRecoverableResponse } from "@/lib/recoverable-response";
import { retagSchema } from "@/lib/schemas/error-items";

const logger = createLogger('api:error-items:retag');

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/error-items/:id/retag
 * 用 AI 从当前知识点库中重新选取本题的知识点（替换系统标签，保留自定义标签）
 * 请求体 { preview: true } 时只返回建议的知识点，不保存
 */
async function handlePost(
    req: Request,
    { user, params }: RouteContext & AuthenticatedContext
) {
    const { id } = await params;

    try {
        const parsed = retagSchema.safeParse(await req.json().catch(() => ({})));
        const preview = parsed.success && parsed.data.preview === true;
        const item = await prisma.errorItem.findUnique({ where: { id }, select: { userId: true, shortId: true, questionText: true } });
        if (!item || item.userId !== user.id) {
            return notFound("Item not found");
        }
        const limited = await consumeAiQuota(user, 'retag');
        if (limited) return limited;

        const result = await trackBackgroundTask(
            { userId: user.id, kind: 'retag', subject: describeQuestion(item), link: `/error-items/${id}` },
            () => preview ? previewRetagErrorItem(id, user.id) : retagErrorItem(id, user.id)
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
export const POST = withRecoverableResponse(withUser(handlePost));
