import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAppTimeZone } from "@/lib/config";
import { formatDateTime } from "@/lib/date-time";
import { internalError } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { resolveStatsSubjectId, practiceSubjectWhere, EXCLUDE_DUPLICATE_IMPORT } from "@/lib/stats/stats-filter";
import { computeStreaks } from "@/lib/stats/stats-streak";
import { addDays } from "date-fns";
import { withUser } from "@/lib/api-handler";
import type { AuthenticatedContext } from "@/lib/api-handler";

const logger = createLogger('api:stats:activity');

/** 热力图展示最近 26 周 */
const WEEKS = 26;
const DAYS_PER_WEEK = 7;

export const GET = withUser(async (req: Request, { user }: AuthenticatedContext) => {
    const userId = user.id;

    try {
        const now = new Date();
        const timeZone = getAppTimeZone();
        const url = new URL(req.url);
        const subjectIdParam = url.searchParams.get('subjectId');

        // 校验 subjectId 是否属于当前用户；非法时当作未筛选
        const subject = await resolveStatsSubjectId(userId, subjectIdParam);
        const subjectId = subject?.id ?? null;
        const subjectName = subject?.name ?? null;

        // 今天的应用时区日期
        const todayStr = formatDateTime(now, 'yyyy-MM-dd', timeZone);
        // 本周一的应用时区日期：基于 UTC 日期计算，避免 date-fns startOfWeek 的本地时区问题
        // 用 UTC 解析 todayStr（视作日历日期），按周一为一周起点对齐
        const todayUtc = new Date(todayStr + 'T00:00:00Z');
        const dayOfWeek = todayUtc.getUTCDay(); // 0=周日
        const daysSinceMonday = (dayOfWeek + DAYS_PER_WEEK - 1) % DAYS_PER_WEEK;
        // 本周一（UTC 日历日期）
        const mondayUtc = new Date(todayUtc);
        mondayUtc.setUTCDate(todayUtc.getUTCDate() - daysSinceMonday);
        // 26 周前的周一
        const startUtc = new Date(mondayUtc);
        startUtc.setUTCDate(mondayUtc.getUTCDate() - (WEEKS - 1) * DAYS_PER_WEEK);
        const startStr = formatDateTime(startUtc, 'yyyy-MM-dd', 'UTC');

        // 学科筛选条件
        const errorWhere: Prisma.ErrorItemWhereInput = {
            userId,
            ...(subjectId ? { subjectId } : {}),
        };
        const practiceWhere: Prisma.PracticeRecordWhereInput = {
            userId,
            ...EXCLUDE_DUPLICATE_IMPORT,
            ...(subjectId && subjectName ? practiceSubjectWhere(subjectId, subjectName) : {}),
        };

        // 只取创建时间：全部历史用于连续天数，热力图从中按日期取最近 26 周
        const [allErrorItems, allPracticeRecords] = await Promise.all([
            prisma.errorItem.findMany({
                where: errorWhere,
                select: { createdAt: true },
            }),
            prisma.practiceRecord.findMany({
                where: practiceWhere,
                select: { createdAt: true },
            }),
        ]);

        // 按应用时区的日期聚合
        const dayMap = new Map<string, { errors: number; practices: number }>();
        for (const item of allErrorItems) {
            const key = formatDateTime(item.createdAt, 'yyyy-MM-dd', timeZone);
            const entry = dayMap.get(key) ?? { errors: 0, practices: 0 };
            entry.errors++;
            dayMap.set(key, entry);
        }
        for (const record of allPracticeRecords) {
            const key = formatDateTime(record.createdAt, 'yyyy-MM-dd', timeZone);
            const entry = dayMap.get(key) ?? { errors: 0, practices: 0 };
            entry.practices++;
            dayMap.set(key, entry);
        }

        // 生成连续 26 周的日期序列（周一对齐）
        const days: { date: string; errors: number; practices: number }[] = [];
        let cursor = new Date(startStr + 'T00:00:00Z');
        for (let i = 0; i < WEEKS * DAYS_PER_WEEK; i++) {
            const dateStr = formatDateTime(cursor, 'yyyy-MM-dd', 'UTC');
            const entry = dayMap.get(dateStr);
            days.push({
                date: dateStr,
                errors: entry?.errors ?? 0,
                practices: entry?.practices ?? 0,
            });
            cursor = addDays(cursor, 1);
        }

        const allActiveDays = new Set(dayMap.keys());
        const streaks = computeStreaks(allActiveDays, todayStr);

        return NextResponse.json({
            days,
            currentStreak: streaks.currentStreak,
            longestStreak: streaks.longestStreak,
            totalActiveDays: streaks.totalActiveDays,
            ...(subjectId ? { subjectId, subjectName } : {}),
        });
    } catch (error) {
        logger.error({ error }, 'Error fetching activity stats');
        return internalError("Failed to fetch activity stats");
    }
});
