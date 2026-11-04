import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAppTimeZone } from "@/lib/config";
import { formatDateTime } from "@/lib/date-time";
import { internalError } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { parseStatsRange, resolveStatsRange } from "@/lib/stats/stats-range";
import { resolveStatsSubjectId, practiceSubjectWhere, EXCLUDE_DUPLICATE_IMPORT } from "@/lib/stats/stats-filter";
import { withUser } from "@/lib/api-handler";
import type { AuthenticatedContext } from "@/lib/api-handler";

const logger = createLogger('api:stats:practice');

/** 已作答：result 为 correct 或 wrong；result 为 null 的旧记录以 isCorrect 是否非 null 判断 */
const ATTEMPTED_CONDITION = {
    OR: [
        { result: { in: ['correct', 'wrong'] } },
        { AND: [{ result: null }, { isCorrect: { not: null } }] }
    ]
} satisfies Prisma.PracticeRecordWhereInput;

/** 答对：result 为 correct，或 result 为 null 且 isCorrect 为 true */
const CORRECT_CONDITION = {
    OR: [
        { result: 'correct' },
        { AND: [{ result: null }, { isCorrect: true }] }
    ]
} satisfies Prisma.PracticeRecordWhereInput;

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
        const subjectName = subject?.name ?? null;

        // 构建基础查询条件
        const baseWhere: Prisma.PracticeRecordWhereInput = {
            userId,
            ...EXCLUDE_DUPLICATE_IMPORT,
            ...(subjectId && subjectName ? practiceSubjectWhere(subjectId, subjectName) : {}),
        };

        let earliest: Date | null = null;
        if (range === 'all') {
            // 仅 all 范围需要查最早记录作为分桶起点
            const earliestRecord = await prisma.practiceRecord.findFirst({
                where: baseWhere,
                select: { createdAt: true },
                orderBy: { createdAt: 'asc' },
            });
            earliest = earliestRecord?.createdAt ?? null;
        }

        const rangeInfo = resolveStatsRange(range, earliest, now, timeZone);

        // 时间范围筛选合并进 where
        const scopedWhere: Prisma.PracticeRecordWhereInput = {
            ...baseWhere,
            ...(rangeInfo.start ? { createdAt: { gte: rangeInfo.start } } : {}),
        };

        // CORRECT/ATTEMPTED 自身含 OR，必须用 AND 组合，避免相互覆盖
        const [subjectRecords, rangeRecords, difficultyGroups, totalRecords, correctRecords, attemptedRecords] = await Promise.all([
            // 学科分布：优先取关联错题当前的学科名（学科改名后与错题统计一致），回退到记录里的快照
            prisma.practiceRecord.findMany({
                where: scopedWhere,
                select: {
                    subject: true,
                    errorItem: { select: { subject: { select: { name: true } } } },
                }
            }),
            prisma.practiceRecord.findMany({
                where: scopedWhere,
                select: {
                    createdAt: true,
                    result: true,
                    isCorrect: true,
                    difficulty: true
                }
            }),
            prisma.practiceRecord.groupBy({
                by: ['difficulty'],
                where: scopedWhere,
                _count: { id: true }
            }),
            prisma.practiceRecord.count({ where: scopedWhere }),
            prisma.practiceRecord.count({ where: { AND: [scopedWhere, CORRECT_CONDITION] } }),
            prisma.practiceRecord.count({ where: { AND: [scopedWhere, ATTEMPTED_CONDITION] } }),
        ]);

        const subjectCountMap = new Map<string, number>();
        for (const record of subjectRecords) {
            const name = record.errorItem?.subject?.name || record.subject || 'Unknown';
            subjectCountMap.set(name, (subjectCountMap.get(name) ?? 0) + 1);
        }
        const subjectStats = Array.from(subjectCountMap, ([name, value]) => ({ name, value }));

        // 按分桶统计趋势
        const chartData = rangeInfo.buckets.map(bucket => {
            const bucketRecords = rangeRecords.filter(
                r => r.createdAt >= bucket.start && r.createdAt < bucket.end
            );
            const stats: { date: string; total: number; correct: number;[key: string]: number | string } = {
                date: bucket.label,
                total: bucketRecords.length,
                correct: 0,
            };
            for (const record of bucketRecords) {
                const isCorrect = record.result === 'correct' || (record.result === null && record.isCorrect === true);
                if (isCorrect) {
                    stats.correct++;
                }
                const difficulty = record.difficulty || 'Unknown';
                const current = typeof stats[difficulty] === 'number' ? stats[difficulty] as number : 0;
                stats[difficulty] = current + 1;
            }
            return stats;
        });

        // 活跃天数：范围内有练习的不同日期数（按应用时区）
        const activeDaysSet = new Set<string>();
        for (const record of rangeRecords) {
            const dayKey = formatDateTime(record.createdAt, 'yyyy-MM-dd', timeZone);
            activeDaysSet.add(dayKey);
        }
        const activeDays = activeDaysSet.size;

        return NextResponse.json({
            subjectStats,
            activityStats: chartData,
            difficultyStats: difficultyGroups.map(s => ({ name: s.difficulty || 'Unknown', value: s._count.id })),
            overallStats: {
                total: totalRecords,
                correct: correctRecords,
                attempted: attemptedRecords,
                rate: attemptedRecords > 0 ? (correctRecords / attemptedRecords * 100).toFixed(1) : 0
            },
            activeDays,
            range: rangeInfo.range,
            granularity: rangeInfo.granularity,
            ...(subjectId ? { subjectId, subjectName } : {}),
        });

    } catch (error) {
        logger.error({ error }, 'Error fetching practice stats');
        return internalError("Failed to fetch stats");
    }
});
