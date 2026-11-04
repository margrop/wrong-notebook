import { NextResponse } from "next/server";
import { withUser } from "@/lib/api-handler";
import type { AuthenticatedContext } from "@/lib/api-handler";
import { internalError, badRequest } from "@/lib/api-errors";
import { getAppTimeZone } from "@/lib/config";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, MIN_PAGE_SIZE } from "@/lib/constants/pagination";
import { reviewDueQuerySchema } from "@/lib/schemas/practice";
import { createLogger } from "@/lib/logger";
import { getMasteryThreshold } from "@/lib/mastery";
import { PRACTICE_RECORD_COUNT, masteryStatusOf } from "@/lib/mastery-status";
import { prisma } from "@/lib/prisma";
import { getReviewPlan, isReviewDue } from "@/lib/review-schedule";

const logger = createLogger('api:review:due');

/** 今日待复习：按作答历史推算到期的错题，最早到期的排在前面 */
async function handleGet(req: Request, { user }: AuthenticatedContext) {
    const { searchParams } = new URL(req.url);
    const parsedQuery = reviewDueQuerySchema.safeParse({
        subjectId: searchParams.get("subjectId") ?? undefined,
        page: searchParams.get("page") ?? undefined,
        pageSize: searchParams.get("pageSize") ?? undefined,
    });
    if (!parsedQuery.success) {
        return badRequest("Invalid query parameters");
    }
    const { subjectId } = parsedQuery.data;
    const page = Math.max(1, parsedQuery.data.page ?? 1);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(MIN_PAGE_SIZE, parsedQuery.data.pageSize ?? DEFAULT_PAGE_SIZE));

    try {
        const timeZone = getAppTimeZone();
        const now = new Date();
        // 先只取计算计划所需的字段，到期的再查询完整内容
        const candidates = await prisma.errorItem.findMany({
            where: { userId: user.id, ...(subjectId ? { subjectId } : {}) },
            select: {
                id: true,
                createdAt: true,
                practiceRecords: { where: { result: { not: null } }, select: { result: true, createdAt: true } },
            },
        });

        const masteryThreshold = await getMasteryThreshold(user.id);
        const due = candidates
            .map((item) => ({ id: item.id, plan: getReviewPlan(item.createdAt, item.practiceRecords, timeZone) }))
            .filter(({ plan }) => isReviewDue(plan, timeZone, now))
            .sort((a, b) => a.plan.nextReviewAt!.getTime() - b.plan.nextReviewAt!.getTime());

        const pageEntries = due.slice((page - 1) * pageSize, page * pageSize);
        const items = await prisma.errorItem.findMany({
            where: { id: { in: pageEntries.map(({ id }) => id) } },
            include: {
                subject: true,
                tags: true,
                _count: PRACTICE_RECORD_COUNT,
            },
        });
        const itemById = new Map(items.map((item) => [item.id, item]));

        return NextResponse.json({
            items: pageEntries.flatMap(({ id, plan }) => {
                const found = itemById.get(id);
                if (!found) return [];
                const { _count, ...item } = found;
                return [{
                    ...item,
                    masteryStatus: masteryStatusOf(_count.practiceRecords, item.masteryProbability, masteryThreshold),
                    reviewStage: plan.stage,
                    nextReviewAt: plan.nextReviewAt,
                }];
            }),
            total: due.length,
            page,
            pageSize,
            totalPages: Math.ceil(due.length / pageSize),
        });
    } catch (error) {
        logger.error({ error }, 'Failed to list due reviews');
        return internalError("Failed to list due reviews");
    }
}

export const GET = withUser(handleGet);
