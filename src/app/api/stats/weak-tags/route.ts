import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAppTimeZone } from "@/lib/config";
import { getDayRange } from "@/lib/date-time";
import { internalError } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { getMasteryThreshold } from "@/lib/mastery";
import { PRACTICE_RECORD_COUNT } from "@/lib/mastery-status";
import { parseStatsRange, getRangeStart } from "@/lib/stats/stats-range";
import { resolveStatsSubjectId, EXCLUDE_DUPLICATE_IMPORT } from "@/lib/stats/stats-filter";
import { buildWeakTags, type WeakTagSourceItem } from "@/lib/tags/weak-tags";
import { withUser } from "@/lib/api-handler";
import type { AuthenticatedContext } from "@/lib/api-handler";

const logger = createLogger('api:stats:weak-tags');

/**
 * GET /api/stats/weak-tags?range=&subjectId=
 * 错题统计「薄弱知识点」排行：按（学科、体系、标签名）聚合，排序取前 10。
 * 范围指错题创建时间，口径与 /api/analytics 一致。
 */
export const GET = withUser(async (req: Request, { user }: AuthenticatedContext) => {
    const userId = user.id;

    try {
        const now = new Date();
        const timeZone = getAppTimeZone();
        const url = new URL(req.url);
        const range = parseStatsRange(url.searchParams.get('range'));
        const subjectIdParam = url.searchParams.get('subjectId');

        const subject = await resolveStatsSubjectId(userId, subjectIdParam);
        const subjectId = subject?.id ?? null;

        const rangeStart = getRangeStart(range, now, timeZone);
        // 近 30 天窗口：[29 天前的零点, 明日零点)
        const recentStart = getDayRange(now, timeZone, -29).start;
        const recentEnd = getDayRange(now, timeZone, 1).end;

        const masteryThreshold = await getMasteryThreshold(userId);

        const items = await prisma.errorItem.findMany({
            where: {
                userId,
                ...(subjectId ? { subjectId } : {}),
                ...(rangeStart ? { createdAt: { gte: rangeStart } } : {}),
            },
            select: {
                id: true,
                subjectId: true,
                subject: { select: { name: true } },
                masteryProbability: true,
                tags: { select: { name: true, tagSet: true } },
                _count: PRACTICE_RECORD_COUNT,
                practiceRecords: {
                    where: {
                        ...EXCLUDE_DUPLICATE_IMPORT,
                        result: { not: null },
                        createdAt: { gte: recentStart, lt: recentEnd },
                    },
                    select: { result: true },
                },
            },
        });

        const sourceItems: WeakTagSourceItem[] = items.map(item => ({
            id: item.id,
            subjectId: item.subjectId,
            subjectName: item.subject?.name ?? null,
            masteryProbability: item.masteryProbability,
            tags: item.tags,
            practiceRecordCount: item._count.practiceRecords,
            recentResults: item.practiceRecords.map(record => record.result),
        }));

        const weakTags = buildWeakTags(sourceItems, { masteryThreshold });

        return NextResponse.json({
            weakTags,
            range,
            ...(subjectId ? { subjectId, subjectName: subject?.name } : {}),
        });
    } catch (error) {
        logger.error({ error }, 'Error fetching weak tags');
        return internalError("Failed to fetch weak tags");
    }
});
