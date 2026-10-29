import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "next-auth";
import { getAIService } from "@/lib/ai";
import { notFound, internalError, unauthorized } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { describeQuestion, trackBackgroundTask } from "@/lib/background-tasks";
import { parseLastPractice, serializeLastPractice } from "@/lib/last-practice";
import type { LastPractice } from "@/lib/last-practice";
import { consumeAiQuota } from "@/lib/ai-quota";
import { withRecoverableResponse } from "@/lib/recoverable-response";

const logger = createLogger('api:practice:generate');

const DIFFICULTIES = ['easy', 'medium', 'hard', 'harder'] as const;

/**
 * GET /api/practice/generate?errorItemId=xxx
 * 读取该错题最近一次生成的举一反三题目，没有时返回 { practice: null }
 */
export async function GET(req: Request) {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
        return unauthorized("Authentication required");
    }

    try {
        const errorItemId = new URL(req.url).searchParams.get("errorItemId");
        if (!errorItemId) {
            return notFound("Item not found");
        }

        const item = await prisma.errorItem.findUnique({
            where: { id: errorItemId },
            select: { userId: true, lastPractice: true }
        });
        if (!item || item.userId !== session.user.id) {
            return notFound("Item not found");
        }

        return NextResponse.json({ practice: parseLastPractice(item.lastPractice) });
    } catch (error) {
        logger.error({ error }, 'Error loading last practice');
        return internalError("Failed to load last practice question");
    }
}

async function handlePost(req: Request) {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
        return unauthorized("Authentication required");
    }

    try {
        const { errorItemId, language, difficulty } = await req.json();

        const errorItemWithSubject = await prisma.errorItem.findUnique({
            where: { id: errorItemId },
            include: { subject: true }
        });

        // 只能基于自己的错题生成，否则等于间接读取他人题目
        if (!errorItemWithSubject || errorItemWithSubject.userId !== session.user.id) {
            return notFound("Item not found");
        }

        let tags: string[] = [];
        try {
            tags = JSON.parse(errorItemWithSubject.knowledgePoints || "[]");
        } catch {
            tags = [];
        }

        const limited = await consumeAiQuota(session.user, 'practice');
        if (limited) return limited;

        const aiService = getAIService();
        const similarQuestion = await trackBackgroundTask(
            { userId: session.user.id, kind: 'practice', subject: describeQuestion(errorItemWithSubject), link: `/error-items/${errorItemId}` },
            () => aiService.generateSimilarQuestion(
                errorItemWithSubject.questionText || "",
                tags,
                language,
                difficulty || 'medium',
                errorItemWithSubject.gradeSemester,
                errorItemWithSubject.figureSvg
            )
        );

        // Inject the subject from the database with type safety
        const validSubjects = ["数学", "物理", "化学", "生物", "英语", "语文", "历史", "地理", "政治", "其他"] as const;
        const subjectName = errorItemWithSubject.subject?.name || "其他";
        similarQuestion.subject = (validSubjects as readonly string[]).includes(subjectName) ? subjectName as typeof validSubjects[number] : "其他";

        // 暂存本次生成结果，下次进入练习页直接显示；写入失败不影响本次返回
        const lastPractice: LastPractice = {
            questionText: similarQuestion.questionText,
            answerText: similarQuestion.answerText,
            analysis: similarQuestion.analysis,
            subject: similarQuestion.subject,
            figureSvg: similarQuestion.figureSvg ?? null,
            difficulty: DIFFICULTIES.find(d => d === difficulty) ?? 'medium',
            generatedAt: new Date().toISOString(),
        };
        try {
            await prisma.errorItem.update({
                where: { id: errorItemId },
                data: { lastPractice: serializeLastPractice(lastPractice) }
            });
        } catch (error) {
            logger.warn({ error }, 'Failed to cache last practice question');
        }

        return NextResponse.json({ ...similarQuestion, difficulty: lastPractice.difficulty, generatedAt: lastPractice.generatedAt });
    } catch (error) {
        logger.error({ error }, 'Error generating practice');
        const errorMessage = error instanceof Error ? error.message : "Failed to generate practice question";
        return internalError(errorMessage);
    }
}

/** 耗时 AI 请求：浏览器中断连接后，前端可通过 /api/requests/:id 取回响应 */
export const POST = withRecoverableResponse(handlePost);
