import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { forbidden, notFound, badRequest, internalError, taskAlreadyRunning } from "@/lib/api-errors";
import { withUser } from "@/lib/api-handler";
import type { AuthenticatedContext } from "@/lib/api-handler";
import { createLogger } from "@/lib/logger";
import { describeQuestion, findRunningTask, reserveBackgroundTask, runReservedTask } from "@/lib/background-tasks";
import { serializeWrite } from "@/lib/db-write-queue";
import { getAIService } from "@/lib/ai";
import { consumeAiQuota } from "@/lib/ai-quota";
import { withRecoverableResponse } from "@/lib/recoverable-response";
import { geogebraAnalyzeSchema } from "@/lib/schemas/error-items";

const logger = createLogger('api:error-items:geogebra');

type RouteContext = { params: Promise<{ id: string }> };

async function handlePost(
    req: Request,
    { user, params }: RouteContext & AuthenticatedContext
) {
    const { id } = await params;

    try {
        const errorItem = await prisma.errorItem.findUnique({
            where: { id },
            include: { subject: true },
        });

        if (!errorItem) {
            return notFound("Item not found");
        }

        if (errorItem.userId !== user.id) {
            return forbidden("Not authorized to access this item");
        }

        // Only analyze math-related subjects
        const subjectName = errorItem.subject?.name || "";
        const isMathRelated =
            subjectName.includes("数学") ||
            subjectName.toLowerCase().includes("math") ||
            subjectName.includes("物理") ||
            subjectName.toLowerCase().includes("physics");

        if (!isMathRelated) {
            return NextResponse.json({
                suitable: false,
                commands: [],
                description: "仅数学和物理题目支持 GeoGebra 动态演示",
            });
        }

        if (!errorItem.questionText) {
            return NextResponse.json({
                suitable: false,
                commands: [],
                description: "题目文本为空，无法分析",
            });
        }

        // 按目标防重复：同一错题同一时刻只允许一个「GeoGebra 演示」任务（reserve 失败返回 409，不扣额度、不调用 AI）
        const target = `error-item:${id}:geogebra`;
        const handle = reserveBackgroundTask({
            userId: user.id,
            kind: 'geogebra',
            subject: describeQuestion(errorItem),
            link: `/error-items/${id}`,
            target,
        });
        if (!handle) {
            return taskAlreadyRunning(findRunningTask(user.id, target) ?? { id: '', kind: 'geogebra', startedAt: '', target });
        }

        const limited = await serializeWrite(() => consumeAiQuota(user, 'geogebra'));
        if (limited) {
            handle.cancel();
            return limited;
        }

        const aiService = await getAIService({ userId: user.id, kind: 'geogebra' });

        // Use frontend-provided data if available (more up-to-date), fall back to DB
        const parsed = geogebraAnalyzeSchema.safeParse(await req.json().catch(() => ({})));
        if (!parsed.success) {
            handle.cancel();
            return badRequest("Invalid request body");
        }
        const { questionText: bodyQuestionText, answerText: bodyAnswerText, previousErrors } = parsed.data;
        const questionText = bodyQuestionText || errorItem.questionText;
        const answerText = bodyAnswerText || errorItem.answerText || "";

        const result = await runReservedTask(handle, () =>
            aiService.analyzeForGeogebra(questionText, answerText, errorItem.analysis || "", previousErrors)
        );

        // If suitable, save the commands to the database
        if (result.suitable && result.commands.length > 0) {
            await prisma.errorItem.update({
                where: { id },
                data: {
                    geogebraCommands: JSON.stringify(result.commands),
                },
            });
        }

        logger.info({ id, suitable: result.suitable, commandCount: result.commands.length }, 'GeoGebra analysis complete');

        return NextResponse.json(result);
    } catch (error) {
        logger.error({ error }, 'Error during GeoGebra analysis');

        const errorMsg = error instanceof Error ? error.message : String(error);

        // Pass through AI-specific errors
        if (errorMsg.startsWith("AI_")) {
            return NextResponse.json(
                { message: errorMsg },
                { status: 502 }
            );
        }

        return internalError("Failed to analyze for GeoGebra");
    }
}

/**
 * DELETE /api/error-items/:id/geogebra
 * 删除已生成的 GeoGebra 演示命令
 */
export const DELETE = withUser(async (_req: Request, { user, params }: RouteContext & AuthenticatedContext) => {
    const { id } = await params;

    try {
        const errorItem = await prisma.errorItem.findUnique({ where: { id }, select: { userId: true } });
        if (!errorItem) {
            return notFound("Item not found");
        }
        if (errorItem.userId !== user.id) {
            return forbidden("Not authorized to access this item");
        }

        await prisma.errorItem.update({ where: { id }, data: { geogebraCommands: null } });
        logger.info({ id }, 'GeoGebra commands deleted');
        return NextResponse.json({ success: true });
    } catch (error) {
        logger.error({ error }, 'Error deleting GeoGebra commands');
        return internalError("Failed to delete GeoGebra commands");
    }
});

/** 耗时 AI 请求：浏览器中断连接后，前端可通过 /api/requests/:id 取回响应 */
export const POST = withRecoverableResponse(withUser(handlePost));
