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
        // 作答记录单独平铺查询：嵌套关系里带 `result: { not: null }` 这类否定过滤时，
        // Prisma 无法按父级 id 拆分查询，错题超过 999 道会触发 SQLite 参数上限而整条查询失败。
        const [candidates, answeredRecords] = await Promise.all([
            prisma.errorItem.findMany({
                where: { userId: user.id, ...(subjectId ? { subjectId } : {}) },
                select: { id: true, createdAt: true },
            }),
            prisma.practiceRecord.findMany({
                where: { userId: user.id, errorItemId: { not: null }, result: { in: ANSWERED_RESULTS } },
                select: { errorItemId: true, result: true, createdAt: true },
                orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            }),
        ]);

        // 按错题归组，保持作答先后顺序
        const recordsByItem = new Map<string, ReviewRecord[]>();
        for (const { errorItemId, result, createdAt } of answeredRecords) {
            if (!errorItemId) continue;
            const records = recordsByItem.get(errorItemId);
            if (records) {
                records.push({ result, createdAt });
            } else {
                recordsByItem.set(errorItemId, [{ result, createdAt }]);
            }
        }

        const masteryThreshold = await getMasteryThreshold(user.id);
        const due = candidates
            .map((item) => ({ id: item.id, plan: getReviewPlan(item.createdAt, recordsByItem.get(item.id) ?? [], timeZone) }))
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
