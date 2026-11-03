import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "next-auth";
import { getAppTimeZone } from "@/lib/config";
import { unauthorized, internalError } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { getMasteryThreshold } from "@/lib/mastery";
import { masteryStatusWhere } from "@/lib/mastery-status";
import { parseStatsRange, resolveStatsRange } from "@/lib/stats-range";
import { resolveStatsSubjectId } from "@/lib/stats-filter";

const logger = createLogger('api:analytics');

export async function GET(req: Request) {
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
        return unauthorized();
    }

    const userId = session.user.id;

    try {
        const timeZone = getAppTimeZone();
        const now = new Date();
        const url = new URL(req.url);
        const range = parseStatsRange(url.searchParams.get('range'));
        const subjectIdParam = url.searchParams.get('subjectId');

        // 校验 subjectId 是否属于当前用户；非法时当作未筛选
        const subject = await resolveStatsSubjectId(userId, subjectIdParam);
        const subjectId = subject?.id ?? null;
        const subjectName = subject?.name ?? null;

        // 构建基础查询条件
        const baseWhere = {
            userId,
            ...(subjectId ? { subjectId } : {}),
        };

        let earliest: Date | null = null;
        if (range === 'all') {
            // 仅 all 范围需要查最早错题作为分桶起点
            const earliestItem = await prisma.errorItem.findFirst({
                where: baseWhere,
                select: { createdAt: true },
                orderBy: { createdAt: 'asc' },
            });
            earliest = earliestItem?.createdAt ?? null;
        }

        const rangeInfo = resolveStatsRange(range, earliest, now, timeZone);

        const masteryThreshold = await getMasteryThreshold(userId);

        // 时间范围筛选合并进 where
        const scopedWhere = {
            ...baseWhere,
            ...(rangeInfo.start ? { createdAt: { gte: rangeInfo.start } } : {}),
        };

        const [totalErrors, newCount, reviewingCount, masteredCount, subjectGroups, rangeItems] = await Promise.all([
            prisma.errorItem.count({ where: scopedWhere }),
            prisma.errorItem.count({
                where: { AND: [scopedWhere, masteryStatusWhere('new', masteryThreshold)] }
            }),
            prisma.errorItem.count({
                where: { AND: [scopedWhere, masteryStatusWhere('reviewing', masteryThreshold)] }
            }),
            prisma.errorItem.count({
                where: { AND: [scopedWhere, masteryStatusWhere('mastered', masteryThreshold)] }
            }),
            prisma.errorItem.groupBy({
                by: ['subjectId'],
                where: scopedWhere,
                _count: { id: true },
            }),
            prisma.errorItem.findMany({
                where: scopedWhere,
                select: { createdAt: true },
            }),
        ]);

        // 掌握率
        const masteryRate = totalErrors > 0 ? ((masteredCount / totalErrors) * 100).toFixed(1) : 0;

        // 学科分布：groupBy 结果一次性查学科名，subjectId 为空归为 Unknown
        const subjectIds = subjectGroups
            .map(g => g.subjectId)
            .filter((id): id is string => id !== null);
        const subjects = await prisma.subject.findMany({
            where: { id: { in: subjectIds } },
            select: { id: true, name: true },
        });
        const subjectNameMap = new Map(subjects.map(s => [s.id, s.name]));

        const subjectStats = subjectGroups.map(g => ({
            name: g.subjectId !== null ? (subjectNameMap.get(g.subjectId) ?? 'Unknown') : 'Unknown',
            value: g._count.id,
        }));

        // 按分桶统计每日/每月新增
        const activityData = rangeInfo.buckets.map(bucket => ({
            date: bucket.label,
            count: rangeItems.filter(
                item => item.createdAt >= bucket.start && item.createdAt < bucket.end
            ).length,
        }));

        return NextResponse.json({
            totalErrors,
            newCount,
            reviewingCount,
            masteredCount,
            masteryRate,
            subjectStats,
            activityData,
            range: rangeInfo.range,
            granularity: rangeInfo.granularity,
            ...(subjectId ? { subjectId, subjectName } : {}),
        });

    } catch (error) {
        logger.error({ error }, 'Error fetching analytics');
        return internalError("Failed to fetch analytics");
    }
}
