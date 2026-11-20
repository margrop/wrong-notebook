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
import type { ReviewRecord } from "@/lib/review-schedule";

/** 参与复习计划的作答结果（未作答的记录不影响计划） */
const ANSWERED_RESULTS = ['correct', 'wrong'];
const REVIEW_ITEM_BATCH_SIZE = 500;

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
        const masteryThreshold = await getMasteryThreshold(user.id);
        const due: { id: string; plan: ReturnType<typeof getReviewPlan> }[] = [];
        // 作答记录单独平铺查询，并按错题分批读取，避免一次把所有用户历史和父级 ID 放进内存/SQL 参数。
        for (let skip = 0; ; skip += REVIEW_ITEM_BATCH_SIZE) {
            const candidates = await prisma.errorItem.findMany({
                where: { userId: user.id, ...(subjectId ? { subjectId } : {}) },
                orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
                skip,
                take: REVIEW_ITEM_BATCH_SIZE,
                select: { id: true, createdAt: true },
            });
            if (candidates.length === 0) break;

            const answeredRecords = await prisma.practiceRecord.findMany({
                where: { userId: user.id, errorItemId: { in: candidates.map((item) => item.id) }, result: { in: ANSWERED_RESULTS } },
                select: { errorItemId: true, result: true, createdAt: true },
                orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            });

            const recordsByItem = new Map<string, ReviewRecord[]>();
            for (const { errorItemId, result, createdAt } of answeredRecords) {
                if (!errorItemId) continue;
                const records = recordsByItem.get(errorItemId) ?? [];
                records.push({ result, createdAt });
                recordsByItem.set(errorItemId, records);
            }

            for (const item of candidates) {
                const plan = getReviewPlan(item.createdAt, recordsByItem.get(item.id) ?? [], timeZone);
                if (isReviewDue(plan, timeZone, now)) due.push({ id: item.id, plan });
            }
            if (candidates.length < REVIEW_ITEM_BATCH_SIZE) break;
        }
        due.sort((a, b) => a.plan.nextReviewAt!.getTime() - b.plan.nextReviewAt!.getTime());

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
