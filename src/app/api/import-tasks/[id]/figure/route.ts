import { NextResponse } from "next/server";
import { z } from "zod";
import { getAIService } from "@/lib/ai";
import { consumeAiQuota } from "@/lib/ai-quota";
import { createErrorResponse, ErrorCode, badRequest, internalError, taskAlreadyRunning } from "@/lib/api-errors";
import { withUser } from "@/lib/api-handler";
import type { AuthenticatedContext } from "@/lib/api-handler";
import { describeQuestion, findRunningTask, reserveBackgroundTask, runReservedTask } from "@/lib/background-tasks";
import { serializeWrite } from "@/lib/db-write-queue";
import { getImportTaskFigureSource, updateImportTaskFigure } from "@/lib/import/import-tasks";
import { createLogger } from "@/lib/logger";
import { withRecoverableResponse } from "@/lib/recoverable-response";

const logger = createLogger('api:import-tasks:figure');

type RouteContext = { params: Promise<{ id: string }> };
/** 可选的配图裁剪结果（data URL）；未提供时使用任务原图 */
const figureCropSchema = z.object({
    imageBase64: z.string().max(15 * 1024 * 1024).regex(/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/).optional(),
}).strip();

/**
 * POST /api/import-tasks/:id/figure
 * 用任务原图让 AI 重新判断是否有配图，并重绘 SVG 配图后合并回待校对的识别结果
 */
async function handlePost(
    req: Request,
    { user, params }: RouteContext & AuthenticatedContext
) {
    const { id } = await params;

    try {
        const parsedBody = figureCropSchema.safeParse(await req.json().catch(() => ({})));
        if (!parsedBody.success) return badRequest("INVALID_IMAGE");

        const source = await getImportTaskFigureSource(user, id);
        if (!source.ok) return source.response;

        // 原图以 data URL 保存；文字录入的题目没有原图，无法重绘
        const match = source.imageData.match(/^data:([^;]+);base64,([\s\S]+)$/);
        const cropped = parsedBody.data.imageBase64?.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+=*)$/);
        if (!cropped && !match) {
            return badRequest("NO_ORIGINAL_IMAGE");
        }
        const imageBase64 = cropped?.[2] ?? match![2];
        const mimeType = cropped?.[1] ?? match![1];

        // 按目标防重复：同一任务同一时刻只允许一个「重绘配图」任务（reserve 失败返回 409，不扣额度、不调用 AI）
        const target = `import-task:${id}:figure`;
        const handle = reserveBackgroundTask({
            userId: user.id,
            kind: 'figure',
            subject: describeQuestion({ questionText: source.questionText }),
            link: `/import-tasks/${id}`,
            target,
        });
        if (!handle) {
            return taskAlreadyRunning(findRunningTask(user.id, target) ?? { id: '', kind: 'figure', startedAt: '', target });
        }

        const limited = await serializeWrite(() => consumeAiQuota(user, 'figure'));
        if (limited) {
            handle.cancel();
            return limited;
        }

        const updated = await runReservedTask(handle, async () => {
            const ai = await getAIService({ userId: user.id, kind: 'figure' });
            const figure = await ai.generateFigureSvg(imageBase64, mimeType, source.questionText);
            const saved = await updateImportTaskFigure(user.id, id, figure);
            // 任务在 AI 生成期间被确认入库：写入条件已失配，不覆盖已保存的错题
            if (!saved) throw new Error('IMPORT_TASK_NOT_REVIEWABLE');
            return saved;
        });

        logger.info({ importTaskId: id, hasFigure: updated.hasFigure, svgLength: updated.figureSvg?.length ?? 0 }, 'Import task figure regenerated');
        return NextResponse.json(updated);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error({ error: message }, 'Error regenerating import task figure');
        if (message === 'IMPORT_TASK_NOT_REVIEWABLE') {
            return createErrorResponse(message, 409, ErrorCode.CONFLICT);
        }
        // AI 错误码交给前端映射为提示文案
        return internalError(message.startsWith('AI_') ? message.split(':')[0] : "Failed to regenerate figure");
    }
}

/** 耗时 AI 请求：浏览器中断连接后，前端可通过 /api/requests/:id 取回响应 */
export const POST = withRecoverableResponse(withUser(handlePost));
