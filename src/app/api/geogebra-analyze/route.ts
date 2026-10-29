import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { unauthorized } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { describeQuestion, trackBackgroundTask } from "@/lib/background-tasks";
import { getAIService } from "@/lib/ai";
import { consumeAiQuota } from "@/lib/ai-quota";
import { withRecoverableResponse } from "@/lib/recoverable-response";

const logger = createLogger('api:geogebra-analyze');

/**
 * General-purpose GeoGebra analysis endpoint.
 * Used by the correction editor where the error item hasn't been saved yet.
 * Does NOT require an item ID.
 */
async function handlePost(req: Request) {
    const session = await getServerSession(authOptions);

    try {
        if (!session?.user?.email) {
            return unauthorized("Authentication required");
        }

        const body = await req.json();
        const { questionText, answerText, analysis } = body;

        if (!questionText?.trim()) {
            return NextResponse.json(
                { suitable: false, commands: [], description: "题目文本为空" },
                { status: 400 }
            );
        }

        const limited = await consumeAiQuota(session.user, 'geogebra');
        if (limited) return limited;

        const aiService = getAIService();
        const result = await trackBackgroundTask(
            { userId: session.user.id, kind: 'geogebra', subject: describeQuestion({ questionText }) },
            () => aiService.analyzeForGeogebra(questionText, answerText || "", analysis || "")
        );

        logger.info({ suitable: result.suitable, commandCount: result.commands.length }, 'GeoGebra analysis complete');

        return NextResponse.json(result);
    } catch (error) {
        logger.error({ error }, 'Error during GeoGebra analysis');

        const errorMsg = error instanceof Error ? error.message : String(error);

        if (errorMsg.startsWith("AI_")) {
            return NextResponse.json(
                { message: errorMsg },
                { status: 502 }
            );
        }

        return NextResponse.json(
            { message: "Failed to analyze for GeoGebra" },
            { status: 500 }
        );
    }
}

/** 耗时 AI 请求：浏览器中断连接后，前端可通过 /api/requests/:id 取回响应 */
export const POST = withRecoverableResponse(handlePost);
