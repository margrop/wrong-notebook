import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withUser } from "@/lib/api-handler";
import type { AuthenticatedContext } from "@/lib/api-handler";
import { internalError, notFound } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";

const logger = createLogger('api:practice:questions:id');

type RouteContext = { params: Promise<{ id: string }> };

/** GET /api/practice/questions/:id：读取一道历史练习题的题干、答案与作答记录，用于重复练习 */
export const GET = withUser(async (_req: Request, { user, params }: AuthenticatedContext & RouteContext) => {
    try {
        const { id } = await params;
        const question = await prisma.practiceQuestion.findUnique({
            where: { id },
            select: {
                id: true,
                userId: true,
                subject: true,
                difficulty: true,
                source: true,
                questionText: true,
                answerText: true,
                analysis: true,
                figureSvg: true,
                generatedAt: true,
                createdAt: true,
                errorItem: {
                    select: {
                        id: true,
                        shortId: true,
                        seqNo: true,
                        questionText: true,
                        subject: { select: { id: true, name: true } },
                    },
                },
                attempts: {
                    select: { id: true, result: true, isCorrect: true, createdAt: true },
                    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
                },
            },
        });
        if (!question || question.userId !== user.id) {
            return notFound("Practice question not found");
        }

        const { userId, ...data } = question;
        return NextResponse.json(data);
    } catch (error) {
        logger.error({ error }, 'Error reading practice question');
        return internalError("Failed to read practice question", { error, scope: "api:practice:questions" });
    }
});
