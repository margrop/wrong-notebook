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
        // 1. Total Errors
        const totalErrors = await prisma.errorItem.count({
            where: { userId }
        });

        // 2. Mastered Count
        const masteredCount = await prisma.errorItem.count({
            where: { AND: [{ userId }, masteryStatusWhere('mastered', await getMasteryThreshold(userId))] }
        });

        // 3. Mastery Rate
        const masteryRate = totalErrors > 0 ? ((masteredCount / totalErrors) * 100).toFixed(1) : 0;

        // 4. Subject Distribution - Get error items grouped by subject
        // 只取科目名：错题行里有 base64 原图、解答和动画等大字段，不能整行读出
        const errorItemsWithSubject = await prisma.errorItem.findMany({
            where: { userId },
            select: {
                subject: { select: { name: true } },
            },
        });

        const subjectMap = new Map<string, number>();
        errorItemsWithSubject.forEach(item => {
            const subjectName = item.subject?.name || 'Unknown';
            subjectMap.set(subjectName, (subjectMap.get(subjectName) || 0) + 1);
        });

        const subjectStats = Array.from(subjectMap.entries()).map(([name, value]) => ({
            name,
            value
        }));

        // 5. Activity Data (Last 7 days) - Track ErrorItem creation (not practice)
        const activityData = [];
        const timeZone = getAppTimeZone();
        const now = new Date();
        for (let i = 6; i >= 0; i--) {
            const { start, end } = getDayRange(now, timeZone, -i);
            const dateStr = formatDateTime(start, 'MM-dd', timeZone);

            // Count error items created on this day
            const count = await prisma.errorItem.count({
                where: {
                    userId,
                    createdAt: {
                        gte: start,
                        lt: end,
                    }
                }
            });

            activityData.push({
                date: dateStr,
                count
            });
        }

        return NextResponse.json({
            totalErrors,
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
