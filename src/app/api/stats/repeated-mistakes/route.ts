import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAppTimeZone } from "@/lib/config";
import { formatDateTime } from "@/lib/date-time";
import { internalError } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { getMasteryThreshold } from "@/lib/mastery";
import { masteryStatusOf } from "@/lib/mastery-status";
import { parseStatsRange, getRangeStart } from "@/lib/stats/stats-range";
import { resolveStatsSubjectId } from "@/lib/stats/stats-filter";
import { truncateQuestionPreview } from "@/lib/question/question-preview";
import { withUser } from "@/lib/api-handler";
import type { AuthenticatedContext } from "@/lib/api-handler";

const logger = createLogger('api:stats:repeated-mistakes');

export const GET = withUser(async (req: Request, { user }: AuthenticatedContext) => {
    const userId = user.id;

    try {
        const now = new Date();
        const timeZone = getAppTimeZone();
        const url = new URL(req.url);
        const range = parseStatsRange(url.searchParams.get('range'));
        const subjectIdParam = url.searchParams.get('subjectId');

        // 校验 subjectId 是否属于当前用户；非法时当作未筛选
        const subject = await resolveStatsSubjectId(userId, subjectIdParam);
        const subjectId = subject?.id ?? null;

        const rangeStart = getRangeStart(range, now, timeZone);
        const masteryThreshold = await getMasteryThreshold(userId);

        // 时间范围与学科筛选（学科按错题的 subjectId）
        const scopedWhere: Prisma.PracticeRecordWhereInput = {
            userId,
            result: 'wrong',
            errorItemId: { not: null },
            ...(rangeStart ? { createdAt: { gte: rangeStart } } : {}),
            ...(subjectId ? { errorItem: { subjectId } } : {}),
        };

        // 先按错题分组统计出错次数，只取前 10
        const groups = await prisma.practiceRecord.groupBy({
            by: ['errorItemId'],
            where: scopedWhere,
            _count: { id: true },
            having: { id: { _count: { gte: 2 } } },
            orderBy: { _count: { id: 'desc' } },
            take: 10,
        });

        const errorItemIds = groups.map(g => g.errorItemId).filter((id): id is string => id !== null);
        if (errorItemIds.length === 0) {
            return NextResponse.json({ items: [] });
        }

        // 再查询错题的必要字段，不读图片、动画等大字段
        const [errorItems, lastWrongRecords] = await Promise.all([
            prisma.errorItem.findMany({
                where: { id: { in: errorItemIds } },
                select: {
                    id: true,
                    shortId: true,
                    questionText: true,
                    masteryProbability: true,
                    subject: { select: { name: true } },
                    _count: { select: { practiceRecords: { where: { result: { not: null } } } } },
                },
            }),
            // 每题最近一次做错的时间
            prisma.practiceRecord.groupBy({
                by: ['errorItemId'],
                where: { userId, errorItemId: { in: errorItemIds }, result: 'wrong' },
                _max: { createdAt: true },
            }),
        ]);

        const lastWrongAtMap = new Map<string, Date>();
        for (const record of lastWrongRecords) {
            if (record.errorItemId && record._max.createdAt) {
                lastWrongAtMap.set(record.errorItemId, record._max.createdAt);
            }
        }

        const items = errorItems.map(item => ({
            id: item.id,
            shortId: item.shortId,
            subjectName: item.subject?.name ?? null,
            preview: truncateQuestionPreview(item.questionText),
            wrongCount: groups.find(g => g.errorItemId === item.id)?._count.id ?? 0,
            lastWrongAt: formatDateTime(lastWrongAtMap.get(item.id) ?? now, 'yyyy-MM-dd', timeZone),
            masteryStatus: masteryStatusOf(item._count.practiceRecords, item.masteryProbability, masteryThreshold),
        }));

        // 保持出错次数降序
        items.sort((a, b) => b.wrongCount - a.wrongCount);

        return NextResponse.json({ items });
    } catch (error) {
        logger.error({ error }, 'Error fetching repeated mistakes');
        return internalError("Failed to fetch repeated mistakes");
    }
});
