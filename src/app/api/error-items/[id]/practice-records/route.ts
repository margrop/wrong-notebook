import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { forbidden, notFound, internalError } from "@/lib/api-errors";
import { withUser } from "@/lib/api-handler";
import type { AuthenticatedContext } from "@/lib/api-handler";
import { createLogger } from "@/lib/logger";
import { masteryStatusOf } from "@/lib/mastery-status";

const logger = createLogger('api:error-items:practice-records');

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/error-items/:id/practice-records
 * 返回错题的掌握概率与举一反三历史（按时间倒序）
 */
export const GET = withUser(async (_req: Request, { user, params }: RouteContext & AuthenticatedContext) => {
    const { id } = await params;

    try {
        const item = await prisma.errorItem.findUnique({
            where: { id },
            select: {
                userId: true,
                masteryLevel: true,
                masteryProbability: true,
                masteryReason: true,
                masterySource: true,
                masteryEvaluatedAt: true,
                practiceRecords: {
                    where: { result: { not: null } },
                    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
                    select: {
                        id: true,
                        result: true,
                        difficulty: true,
                        source: true,
                        questionText: true,
                        answerText: true,
                        analysis: true,
                        wrongAnswerText: true,
                        mistakeAnalysis: true,
                        originalImageUrl: true,
                        figureSvg: true,
                        createdAt: true,
                        examQuestion: { select: { paperId: true, order: true, paper: { select: { title: true } } } },
                    },
                },
            },
        });

        if (!item) {
            return notFound("Item not found");
        }
        if (item.userId !== user.id) {
            return forbidden("Not authorized to access this item");
        }

        const { userId: _userId, practiceRecords, ...mastery } = item;
        return NextResponse.json({
            ...mastery,
            masteryStatus: masteryStatusOf(practiceRecords.length, mastery.masteryProbability, user.masteryThreshold),
            masteryThreshold: user.masteryThreshold,
            records: practiceRecords.map(({ examQuestion, ...record }) => ({
                ...record,
                exam: examQuestion
                    ? { paperId: examQuestion.paperId, order: examQuestion.order, title: examQuestion.paper.title }
                    : null,
            })),
        });
    } catch (error) {
        logger.error({ error }, 'Error fetching practice records');
        return internalError("Failed to fetch practice records");
    }
});
