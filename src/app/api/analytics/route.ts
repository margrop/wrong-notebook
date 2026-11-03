import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "next-auth";
import { getAppTimeZone } from "@/lib/config";
import { formatDateTime, getDayRange } from "@/lib/date-time";
import { unauthorized, internalError } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { getMasteryThreshold } from "@/lib/mastery";
import { masteryStatusWhere } from "@/lib/mastery-status";

const logger = createLogger('api:analytics');

export async function GET() {
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
        return unauthorized();
    }

    const userId = session.user.id;

    try {
        const timeZone = getAppTimeZone();
        const now = new Date();
        const sevenDaysAgo = getDayRange(now, timeZone, -6).start;
        const masteryThreshold = await getMasteryThreshold(userId);

        const [totalErrors, newCount, reviewingCount, masteredCount, subjectGroups, recentCreatedAt] = await Promise.all([
            prisma.errorItem.count({ where: { userId } }),
            prisma.errorItem.count({
                where: { AND: [{ userId }, masteryStatusWhere('new', masteryThreshold)] }
            }),
            prisma.errorItem.count({
                where: { AND: [{ userId }, masteryStatusWhere('reviewing', masteryThreshold)] }
            }),
            prisma.errorItem.count({
                where: { AND: [{ userId }, masteryStatusWhere('mastered', masteryThreshold)] }
            }),
            prisma.errorItem.groupBy({
                by: ['subjectId'],
                where: { userId },
                _count: { id: true },
            }),
            prisma.errorItem.findMany({
                where: {
                    userId,
                    createdAt: { gte: sevenDaysAgo },
                },
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

        // 最近 7 天每日新增：一次查询后在内存里按应用时区分组
        const dayBuckets: { start: Date; end: Date; date: string }[] = [];
        for (let i = 6; i >= 0; i--) {
            const { start, end } = getDayRange(now, timeZone, -i);
            dayBuckets.push({ start, end, date: formatDateTime(start, 'MM-dd', timeZone) });
        }

        const activityData = dayBuckets.map(({ start, end, date }) => ({
            date,
            count: recentCreatedAt.filter(
                item => item.createdAt >= start && item.createdAt < end
            ).length,
        }));

        return NextResponse.json({
            totalErrors,
            newCount,
            reviewingCount,
            masteredCount,
            masteryRate,
            subjectStats,
            activityData
        });

    } catch (error) {
        logger.error({ error }, 'Error fetching analytics');
        return internalError("Failed to fetch analytics");
    }
}
