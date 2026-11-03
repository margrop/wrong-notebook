import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "next-auth";
import { getAppTimeZone } from "@/lib/config";
import { formatDateTime, getMonthStart } from "@/lib/date-time";
import { unauthorized, internalError } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";

const logger = createLogger('api:stats:practice');

/** 重复导入产生的记录不计入练习统计 */
const EXCLUDE_DUPLICATE_IMPORT = { source: { not: 'duplicate_import' } } satisfies Prisma.PracticeRecordWhereInput;

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

export async function GET() {
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
        return unauthorized();
    }

    const userId = session.user.id;

    try {
        const now = new Date();
        const timeZone = getAppTimeZone();

        const [subjectGroups, activityStats, difficultyGroups, totalRecords, correctRecords, attemptedRecords] = await Promise.all([
            prisma.practiceRecord.groupBy({
                by: ['subject'],
                where: { userId, ...EXCLUDE_DUPLICATE_IMPORT },
                _count: { id: true }
            }),
            prisma.practiceRecord.findMany({
                where: {
                    userId,
                    ...EXCLUDE_DUPLICATE_IMPORT,
                    createdAt: {
                        gte: getMonthStart(now, timeZone, -5),
                    }
                },
                select: {
                    createdAt: true,
                    result: true,
                    isCorrect: true,
                    difficulty: true
                }
            }),
            prisma.practiceRecord.groupBy({
                by: ['difficulty'],
                where: { userId, ...EXCLUDE_DUPLICATE_IMPORT },
                _count: { id: true }
            }),
            prisma.practiceRecord.count({ where: { userId, ...EXCLUDE_DUPLICATE_IMPORT } }),
            prisma.practiceRecord.count({ where: { userId, ...CORRECT_CONDITION, ...EXCLUDE_DUPLICATE_IMPORT } }),
            prisma.practiceRecord.count({ where: { userId, ...ATTEMPTED_CONDITION, ...EXCLUDE_DUPLICATE_IMPORT } }),
        ]);

        // Process activity stats into monthly counts
        const monthlyActivity: Record<string, { total: number, correct: number, [key: string]: number }> = {};

        // Initialize last 6 months
        for (let i = 5; i >= 0; i--) {
            const key = formatDateTime(getMonthStart(now, timeZone, -i), 'yyyy-MM', timeZone);
            monthlyActivity[key] = { total: 0, correct: 0 };
        }

        activityStats.forEach(record => {
            const date = formatDateTime(record.createdAt, 'yyyy-MM', timeZone);
            if (monthlyActivity[date]) {
                monthlyActivity[date].total++;
                const isCorrect = record.result === 'correct' || (record.result === null && record.isCorrect === true);
                if (isCorrect) {
                    monthlyActivity[date].correct++;
                }

                const difficulty = record.difficulty || 'Unknown';
                monthlyActivity[date][difficulty] = (monthlyActivity[date][difficulty] || 0) + 1;
            }
        });

        const chartData = Object.entries(monthlyActivity).map(([date, stats]) => ({
            date,
            ...stats
        })).sort((a, b) => a.date.localeCompare(b.date));

        return NextResponse.json({
            subjectStats: subjectGroups.map(s => ({ name: s.subject || 'Unknown', value: s._count.id })),
            activityStats: chartData,
            difficultyStats: difficultyGroups.map(s => ({ name: s.difficulty || 'Unknown', value: s._count.id })),
            overallStats: {
                total: totalRecords,
                correct: correctRecords,
                attempted: attemptedRecords,
                rate: attemptedRecords > 0 ? (correctRecords / attemptedRecords * 100).toFixed(1) : 0
            }
        });

    } catch (error) {
        logger.error({ error }, 'Error fetching practice stats');
        return internalError("Failed to fetch stats");
    }
}
