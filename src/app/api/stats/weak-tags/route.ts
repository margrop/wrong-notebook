import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAppTimeZone } from "@/lib/config";
import { getDayRange } from "@/lib/date-time";
import { internalError } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { getMasteryThreshold } from "@/lib/mastery";
import { PRACTICE_RECORD_COUNT } from "@/lib/mastery-status";
import { parseStatsRange, getRangeStart } from "@/lib/stats/stats-range";
import { resolveStatsSubjectId } from "@/lib/stats/stats-filter";
import { buildWeakTags, type WeakTagSourceItem } from "@/lib/tags/weak-tags";
import { withUser } from "@/lib/api-handler";
import type { AuthenticatedContext } from "@/lib/api-handler";

const logger = createLogger('api:stats:weak-tags');
const WEAK_TAG_ITEM_BATCH_SIZE = 500;

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

        const sourceItems: WeakTagSourceItem[] = [];
        const where = {
            userId,
            ...(subjectId ? { subjectId } : {}),
            ...(rangeStart ? { createdAt: { gte: rangeStart } } : {}),
        };
        // 分批读取轻字段，避免 Prisma 为大错题本展开一次超大的关系查询。
        for (let skip = 0; ; skip += WEAK_TAG_ITEM_BATCH_SIZE) {
            const items = await prisma.errorItem.findMany({
                where,
                orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
                skip,
                take: WEAK_TAG_ITEM_BATCH_SIZE,
                select: {
                    id: true,
                    subjectId: true,
                    subject: { select: { name: true } },
                    masteryProbability: true,
                    tags: { select: { name: true, tagSet: true } },
                    _count: PRACTICE_RECORD_COUNT,
                    practiceRecords: {
                        where: {
                            result: { in: ['correct', 'wrong', 'not_attempted'] },
                            createdAt: { gte: recentStart, lt: recentEnd },
                        },
                        select: { result: true, source: true },
                    },
                },
            });
            sourceItems.push(...items.map(item => ({
                id: item.id,
                subjectId: item.subjectId,
                subjectName: item.subject?.name ?? null,
                masteryProbability: item.masteryProbability,
                tags: item.tags,
                practiceRecordCount: item._count.practiceRecords,
                recentResults: item.practiceRecords
                    .filter(record => record.source !== 'duplicate_import')
                    .map(record => record.result),
            })));
            if (items.length < WEAK_TAG_ITEM_BATCH_SIZE) break;
        }

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
