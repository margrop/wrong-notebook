import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "next-auth";
import { unauthorized, forbidden, notFound, internalError } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { describeQuestion, trackBackgroundTask } from "@/lib/background-tasks";
import { getAIService } from "@/lib/ai";
import { consumeAiQuota } from "@/lib/ai-quota";
import { withRecoverableResponse } from "@/lib/recoverable-response";

const logger = createLogger('api:error-items:geogebra');

async function handlePost(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    const session = await getServerSession(authOptions);

    try {
        let user;
        if (session?.user?.email) {
            user = await prisma.user.findUnique({
                where: { email: session.user.email },
            });
        }

        if (!user) {
            return unauthorized("Authentication required");
        }

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

        const limited = await consumeAiQuota(user, 'geogebra');
        if (limited) return limited;

        const aiService = getAIService();

        // Use frontend-provided data if available (more up-to-date), fall back to DB
        const body = await req.json().catch(() => ({}));
        const questionText = body.questionText || errorItem.questionText;
        const answerText = body.answerText || errorItem.answerText || "";
        const previousErrors = body.previousErrors || "";

        const result = await trackBackgroundTask(
            { userId: user.id, kind: 'geogebra', subject: describeQuestion(errorItem), link: `/error-items/${id}` },
            () => aiService.analyzeForGeogebra(questionText, answerText, errorItem.analysis || "", previousErrors)
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
export async function DELETE(
    _req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    const session = await getServerSession(authOptions);

    try {
        const user = session?.user?.email
            ? await prisma.user.findUnique({ where: { email: session.user.email } })
            : null;
        if (!user) {
            return unauthorized("Authentication required");
        }

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
}

/** 耗时 AI 请求：浏览器中断连接后，前端可通过 /api/requests/:id 取回响应 */
export const POST = withRecoverableResponse(handlePost);
